import { assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics/index.js";
import { errorDiagnostic } from "../diagnostics/index.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type {
  Block,
  ConstDecl,
  EnumDecl,
  FunctionDef,
  FunctionSignature,
  GenericParam,
  ImplDecl,
  Item,
  LetStatement,
  Lifetime,
  NamedFieldsBody,
  Param,
  Program,
  StaticDecl,
  Statement,
  StructBody,
  StructDecl,
  TraitDecl,
  TraitItem,
  TupleFieldsBody,
  Type,
  TypeAliasDecl,
  Variant,
  LifetimeParam,
} from "./ast.js";

const NO_ELISION_RULE_MESSAGE =
  "missing lifetime specifier: a reference with no applicable elision rule " +
  "needs an explicit lifetime annotation (this applies to struct fields, " +
  "let annotations, and references nested inside another reference)";

function ambiguousReturnLifetimeMessage(referenceParamCount: number): string {
  return (
    "missing lifetime specifier: the return type borrows a reference, but " +
    `the signature has ${referenceParamCount} reference parameters, so the ` +
    "compiler cannot infer which one it borrows from; add explicit " +
    "lifetime parameters (e.g. fn f<'a>(x: &'a T) -> &'a T)"
  );
}

function spanOf(tokens: readonly Token[], tokenId: number): Option<Span> {
  const token = tokens[tokenId];
  return token !== undefined ? some(token.span) : none();
}

/**
 * Builds a fresh-lifetime generator seeded with every name already in use in
 * the enclosing signature/type (declared generics + every explicit lifetime
 * anywhere in the params/return type or struct fields), so a synthesized
 * name (`_0`, `_1`, ...) never collides with a user-written one - mirroring
 * this codebase's `$k`-suffix convention for alpha-rename collision
 * avoidance in JSIM.
 *
 * Mutates `usedNames` in place as it synthesizes, rather than cloning it,
 * so a caller holding the same set reference (e.g. `elideFunction`'s
 * `names`, threaded down to nested `let` statements as `outerNames`) sees
 * every synthesized name too - not just the explicit ones the set started
 * with. Without this, two independent placeholders synthesized from the
 * same otherwise-empty starting set would both pick `_0`.
 */
function createSynthesizer(
  usedNames: Set<string>,
): (anchorTokenId: number) => Lifetime {
  let counter = 0;
  return (anchorTokenId: number): Lifetime => {
    let name = `_${counter}`;
    while (usedNames.has(name)) {
      counter += 1;
      name = `_${counter}`;
    }
    usedNames.add(name);
    counter += 1;
    return { kind: "Lifetime", tokenId: anchorTokenId, name };
  };
}

/** Collects declared lifetime names from a generics list - a `TypeParam`
 * contributes nothing, since only lifetime collisions matter here. */
function declaredLifetimeNames(generics: readonly GenericParam[]): string[] {
  return generics
    .filter((param): param is LifetimeParam => param.kind === "LifetimeParam")
    .map((param) => param.lifetime.name);
}

/** Collects every explicit lifetime name reachable from `type` - the full
 * set a synthesizer must avoid. */
function collectTypeLifetimeNames(type: Type, names: Set<string>): void {
  switch (type.kind) {
    case "ReferenceType":
      if (isSome(type.lifetime)) {
        names.add(type.lifetime.value.name);
      }
      collectTypeLifetimeNames(type.referent, names);
      return;
    case "NamedType":
      for (const typeArgument of type.typeArguments) {
        collectTypeLifetimeNames(typeArgument, names);
      }
      return;
    case "ArrayType":
      collectTypeLifetimeNames(type.elementType, names);
      return;
    case "UnitType":
      return;
    case "DynType":
      for (const typeArgument of type.bound.typeArguments) {
        collectTypeLifetimeNames(typeArgument, names);
      }
      return;
    default:
      assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

/**
 * Resolves every `ReferenceType` reachable from `type`, including `type`
 * itself. None of these positions have an elision rule - the spec's three
 * rules only speak to a function's own top-level parameter/return
 * positions - so any elided reference found here is rejected with a
 * diagnostic and given a synthesized placeholder lifetime, keeping the
 * invariant that every `ReferenceType` in the returned `Program` has a
 * resolved (`some(...)`) lifetime.
 */
function resolveNestedReferenceTypes(
  type: Type,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  synth: (anchorTokenId: number) => Lifetime,
): Type {
  switch (type.kind) {
    case "ReferenceType": {
      const referent = resolveNestedReferenceTypes(
        type.referent,
        tokens,
        diagnostics,
        synth,
      );
      if (isSome(type.lifetime)) {
        return { ...type, referent };
      }
      diagnostics.push(
        errorDiagnostic(
          "HEDGE-LIFETIME-001",
          NO_ELISION_RULE_MESSAGE,
          spanOf(tokens, type.tokenId),
        ),
      );
      return { ...type, lifetime: some(synth(type.tokenId)), referent };
    }
    case "NamedType":
      return {
        ...type,
        typeArguments: type.typeArguments.map((typeArgument) =>
          resolveNestedReferenceTypes(typeArgument, tokens, diagnostics, synth),
        ),
      };
    case "ArrayType":
      return {
        ...type,
        elementType: resolveNestedReferenceTypes(
          type.elementType,
          tokens,
          diagnostics,
          synth,
        ),
      };
    case "UnitType":
      return type;
    case "DynType":
      return {
        ...type,
        bound: {
          ...type.bound,
          typeArguments: type.bound.typeArguments.map((typeArgument) =>
            resolveNestedReferenceTypes(
              typeArgument,
              tokens,
              diagnostics,
              synth,
            ),
          ),
        },
      };
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

/**
 * Elides every statement in `block`, in place at this nesting level - used
 * both for a function's own body and for a `Block` expression used directly
 * as a `let` initializer (see `elideLetStatement`), so a locally-declared
 * `fn`/`struct` inside either gets the same treatment. Does not descend into
 * any other expression position (an `if`-expression's branches, a call
 * argument, ...) - see the out-of-scope note on `elideLifetimes` below.
 *
 * `outerNames` is every lifetime name already bound in the enclosing
 * function's own signature (declared generics + its params/return type) -
 * threaded down purely so a nested `let` annotation's synthesized
 * placeholder can avoid colliding with it (see `elideLetStatement`). A
 * nested `fn`/`struct` declaration ignores it: per Rust's own scoping
 * rules, a nested declaration is a fresh, independent lifetime scope, not
 * a continuation of its enclosing function's.
 */
function elideBlockStatements(
  block: Block,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  outerNames: ReadonlySet<string>,
): Block {
  return {
    ...block,
    statements: block.statements.map((stmt: Statement): Statement =>
      elideStatement(stmt, tokens, diagnostics, outerNames),
    ),
  };
}

function elideLetStatement(
  stmt: LetStatement,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  outerNames: ReadonlySet<string>,
): LetStatement {
  // A fresh copy, not a reference to `outerNames` - each `let` gets its own
  // local scope, but that scope always includes everything already bound
  // above it (see `createSynthesizer`'s note on why this must be mutated
  // in place, not read-only, as elision proceeds).
  const localNames = new Set(outerNames);
  if (isSome(stmt.type)) {
    collectTypeLifetimeNames(stmt.type.value, localNames);
  }
  const type = isSome(stmt.type)
    ? some(
        resolveNestedReferenceTypes(
          stmt.type.value,
          tokens,
          diagnostics,
          createSynthesizer(localNames),
        ),
      )
    : stmt.type;
  const initializer =
    isSome(stmt.initializer) && stmt.initializer.value.kind === "Block"
      ? some(
          elideBlockStatements(
            stmt.initializer.value,
            tokens,
            diagnostics,
            localNames,
          ),
        )
      : stmt.initializer;
  return { ...stmt, type, initializer };
}

function elideFieldTypes<F extends { readonly type: Type }>(
  fields: readonly F[],
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  synth: (anchorTokenId: number) => Lifetime,
): F[] {
  return fields.map((field) => ({
    ...field,
    type: resolveNestedReferenceTypes(field.type, tokens, diagnostics, synth),
  }));
}

function elideStructBody(
  body: StructBody,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  synth: (anchorTokenId: number) => Lifetime,
): StructBody {
  switch (body.kind) {
    case "NamedFields":
      return {
        ...body,
        fields: elideFieldTypes(body.fields, tokens, diagnostics, synth),
      };
    case "TupleFields":
      return {
        ...body,
        fields: elideFieldTypes(body.fields, tokens, diagnostics, synth),
      };
    case "Unit":
      return body;
    default:
      return assertNever(
        body,
        `Unexpected struct body: ${JSON.stringify(body)}`,
      );
  }
}

function structBodyFieldTypes(body: StructBody): readonly Type[] {
  switch (body.kind) {
    case "NamedFields":
    case "TupleFields":
      return body.fields.map((field) => field.type);
    case "Unit":
      return [];
    default:
      return assertNever(
        body,
        `Unexpected struct body: ${JSON.stringify(body)}`,
      );
  }
}

function elideStructDecl(
  decl: StructDecl,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): StructDecl {
  const names = new Set<string>(declaredLifetimeNames(decl.generics));
  for (const type of structBodyFieldTypes(decl.body)) {
    collectTypeLifetimeNames(type, names);
  }
  const synth = createSynthesizer(names);
  return {
    ...decl,
    body: elideStructBody(decl.body, tokens, diagnostics, synth),
  };
}

/**
 * Elides rules 1/2 across a signature's params/return type, shared by both a
 * bodiless `FunctionSignature` and a bodied `FunctionDef`'s own signature. The
 * returned `names` set (declared generics plus every lifetime name already
 * used in the signature) is what a bodied function's body elision must also
 * avoid colliding with.
 */
function elideFunctionSignature(
  decl: FunctionSignature,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): { signature: FunctionSignature; names: Set<string> } {
  const names = new Set<string>(declaredLifetimeNames(decl.generics));
  for (const param of decl.params) {
    collectTypeLifetimeNames(param.type, names);
  }
  if (isSome(decl.returnType)) {
    collectTypeLifetimeNames(decl.returnType.value, names);
  }
  const synth = createSynthesizer(names);

  // Rule 1: each unannotated top-level reference parameter gets its own
  // fresh lifetime. Resolve every param's type first, as a pure per-element
  // transform, then derive rule 2's "is there exactly one reference
  // parameter, and if so what's its lifetime" from the resolved result -
  // rather than counting via a mutable outer variable from inside the map.
  const newParams = decl.params.map((param: Param): Param => {
    if (param.type.kind !== "ReferenceType") {
      // Rule 1 doesn't reach a reference nested here (Vec<&T>, [&T; 3]).
      return {
        ...param,
        type: resolveNestedReferenceTypes(
          param.type,
          tokens,
          diagnostics,
          synth,
        ),
      };
    }
    const lifetime = isSome(param.type.lifetime)
      ? param.type.lifetime.value
      : synth(param.type.tokenId);
    const referent = resolveNestedReferenceTypes(
      param.type.referent,
      tokens,
      diagnostics,
      synth,
    );
    return {
      ...param,
      type: { ...param.type, lifetime: some(lifetime), referent },
    };
  });
  const referenceParamLifetimes = newParams.flatMap((param) =>
    param.type.kind === "ReferenceType" && isSome(param.type.lifetime)
      ? [param.type.lifetime.value]
      : [],
  );
  const referenceParamCount = referenceParamLifetimes.length;
  const soleReferenceParamLifetime = referenceParamLifetimes[0];

  let newReturnType = decl.returnType;
  if (isSome(decl.returnType)) {
    const returnType = decl.returnType.value;
    if (returnType.kind !== "ReferenceType") {
      // Rule 2 doesn't reach a reference nested here (Vec<&T>, [&T; 3]).
      newReturnType = some(
        resolveNestedReferenceTypes(returnType, tokens, diagnostics, synth),
      );
    } else {
      let lifetime: Lifetime;
      if (isSome(returnType.lifetime)) {
        lifetime = returnType.lifetime.value;
      } else if (
        referenceParamCount === 1 &&
        soleReferenceParamLifetime !== undefined
      ) {
        lifetime = soleReferenceParamLifetime;
      } else {
        diagnostics.push(
          errorDiagnostic(
            "HEDGE-LIFETIME-001",
            ambiguousReturnLifetimeMessage(referenceParamCount),
            spanOf(tokens, returnType.tokenId),
          ),
        );
        lifetime = synth(returnType.tokenId);
      }
      const referent = resolveNestedReferenceTypes(
        returnType.referent,
        tokens,
        diagnostics,
        synth,
      );
      newReturnType = some({
        ...returnType,
        lifetime: some(lifetime),
        referent,
      });
    }
  }

  return {
    signature: { ...decl, params: newParams, returnType: newReturnType },
    names,
  };
}

function elideFunctionSignatureItem(
  decl: FunctionSignature,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): FunctionSignature {
  return elideFunctionSignature(decl, tokens, diagnostics).signature;
}

function elideFunction(
  decl: FunctionDef,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): FunctionDef {
  const { signature, names } = elideFunctionSignature(
    decl.signature,
    tokens,
    diagnostics,
  );
  return {
    ...decl,
    signature,
    body: elideBlockStatements(decl.body, tokens, diagnostics, names),
  };
}

/** Mirrors `elideStructBody`. */
function elideVariantBody(
  body: NamedFieldsBody | TupleFieldsBody,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  synth: (anchorTokenId: number) => Lifetime,
): NamedFieldsBody | TupleFieldsBody {
  switch (body.kind) {
    case "NamedFields":
      return {
        ...body,
        fields: elideFieldTypes(body.fields, tokens, diagnostics, synth),
      };
    case "TupleFields":
      return {
        ...body,
        fields: elideFieldTypes(body.fields, tokens, diagnostics, synth),
      };
    default:
      return assertNever(
        body,
        `Unexpected variant body: ${JSON.stringify(body)}`,
      );
  }
}

function elideVariant(
  variant: Variant,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  synth: (anchorTokenId: number) => Lifetime,
): Variant {
  if (!isSome(variant.body)) {
    return variant;
  }
  return {
    ...variant,
    body: some(
      elideVariantBody(variant.body.value, tokens, diagnostics, synth),
    ),
  };
}

function enumVariantFieldTypes(variants: readonly Variant[]): readonly Type[] {
  return variants.flatMap((variant) =>
    isSome(variant.body)
      ? variant.body.value.fields.map((field) => field.type)
      : [],
  );
}

/** Mirrors `elideStructDecl`: variant field types can hold a `ReferenceType`
 * just like struct fields, seeded from the same lifetime-only generics. */
function elideEnumDecl(
  decl: EnumDecl,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): EnumDecl {
  const names = new Set<string>(declaredLifetimeNames(decl.generics));
  for (const type of enumVariantFieldTypes(decl.variants)) {
    collectTypeLifetimeNames(type, names);
  }
  const synth = createSynthesizer(names);
  return {
    ...decl,
    variants: decl.variants.map((variant) =>
      elideVariant(variant, tokens, diagnostics, synth),
    ),
  };
}

/**
 * `Const`/`Static` items have their own, standalone `type` field (not
 * optional, unlike `LetStatement`'s) that can hold a `ReferenceType` just
 * like a `let`'s annotation can - elides it the same way, but doesn't walk
 * into `value` (an initializer `Block` isn't given the same special-cased
 * elision `LetStatement`'s own initializer gets; see this file's own note on
 * that being a deliberate, narrow scope boundary).
 */
function elideConstOrStaticDecl<T extends { readonly type: Type }>(
  decl: T,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): T {
  const names = new Set<string>();
  collectTypeLifetimeNames(decl.type, names);
  return {
    ...decl,
    type: resolveNestedReferenceTypes(
      decl.type,
      tokens,
      diagnostics,
      createSynthesizer(names),
    ),
  };
}

/**
 * A type alias's own value isn't a function signature, so no rule 1/2
 * pairing applies to it - an elided reference anywhere in it is resolved
 * the same no-rule-applies way a struct field's or const's own type is.
 */
function elideTypeAliasDecl(
  decl: TypeAliasDecl,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): TypeAliasDecl {
  if (!isSome(decl.value)) {
    return decl;
  }
  const names = new Set<string>(declaredLifetimeNames(decl.generics));
  collectTypeLifetimeNames(decl.value.value, names);
  const synth = createSynthesizer(names);
  return {
    ...decl,
    value: some(
      resolveNestedReferenceTypes(decl.value.value, tokens, diagnostics, synth),
    ),
  };
}

/**
 * Each trait item builds its own independent lifetime scope, exactly like a
 * nested `fn`/`struct` already does - the trait's own generics aren't
 * threaded down to its items.
 */
function elideTraitItem(
  item: TraitItem,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): TraitItem {
  switch (item.kind) {
    case "Function":
      return elideFunction(item, tokens, diagnostics);
    case "FunctionSignature":
      return elideFunctionSignatureItem(item, tokens, diagnostics);
    case "TypeAlias":
      return elideTypeAliasDecl(item, tokens, diagnostics);
    case "Const":
      return elideConstOrStaticDecl(item, tokens, diagnostics);
    default:
      return assertNever(
        item,
        `Unexpected trait item: ${JSON.stringify(item)}`,
      );
  }
}

function elideTraitDecl(
  decl: TraitDecl,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): TraitDecl {
  return {
    ...decl,
    items: decl.items.map((item) => elideTraitItem(item, tokens, diagnostics)),
  };
}

/**
 * An impl's own target `Type` (and any trait-ref type arguments) isn't a
 * function signature either, so it gets the same no-rule-applies treatment
 * as a type alias's value. Each item in the body still builds its own
 * independent scope via {@link elideItem}, same as `elideTraitItem`.
 */
function elideImplDecl(
  decl: ImplDecl,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): ImplDecl {
  const names = new Set<string>(declaredLifetimeNames(decl.generics));
  collectTypeLifetimeNames(decl.type, names);
  if (isSome(decl.traitRef)) {
    for (const typeArgument of decl.traitRef.value.typeArguments) {
      collectTypeLifetimeNames(typeArgument, names);
    }
  }
  const synth = createSynthesizer(names);
  const type = resolveNestedReferenceTypes(
    decl.type,
    tokens,
    diagnostics,
    synth,
  );
  const traitRef = isSome(decl.traitRef)
    ? some({
        ...decl.traitRef.value,
        typeArguments: decl.traitRef.value.typeArguments.map((typeArgument) =>
          resolveNestedReferenceTypes(typeArgument, tokens, diagnostics, synth),
        ),
      })
    : decl.traitRef;
  return {
    ...decl,
    type,
    traitRef,
    items: decl.items.map((item) => elideItem(item, tokens, diagnostics)),
  };
}

/**
 * `outerNames` is only ever consulted by the `LetStatement` case (see
 * `elideLetStatement`) - a nested `FunctionDef`/`Struct` builds its own,
 * independent name scope and ignores it, matching Rust's own scoping rules
 * for a nested item declaration.
 */
function elideStatement(
  stmt: Statement,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  outerNames: ReadonlySet<string>,
): Statement {
  switch (stmt.kind) {
    case "LetStatement":
      return elideLetStatement(stmt, tokens, diagnostics, outerNames);
    case "ExpressionStatement":
      return stmt;
    case "Function":
      return elideFunction(stmt, tokens, diagnostics);
    case "FunctionSignature":
      return elideFunctionSignatureItem(stmt, tokens, diagnostics);
    case "Struct":
      return elideStructDecl(stmt, tokens, diagnostics);
    case "Enum":
      return elideEnumDecl(stmt, tokens, diagnostics);
    case "Const":
    case "Static":
      return elideConstOrStaticDecl(stmt, tokens, diagnostics);
    case "Trait":
      return elideTraitDecl(stmt, tokens, diagnostics);
    case "Impl":
      return elideImplDecl(stmt, tokens, diagnostics);
    default:
      return assertNever(stmt, `Unexpected statement: ${JSON.stringify(stmt)}`);
  }
}

/**
 * Only `FunctionDef`/`FunctionSignature`/`StructDecl`/`EnumDecl`/`TraitDecl`/
 * `ImplDecl`/`LetStatement`/`ConstDecl`/`StaticDecl` carry `Type` fields that
 * can hold a `ReferenceType` (`TraitDecl`/`ImplDecl` transitively, through
 * their own items) - every other `Item` kind is a bare expression or
 * `ExpressionStatement`, neither of which does. Narrowing to this subset up
 * front (rather than giving `elideStatement` a `default: return item` branch
 * over the full `Item` union) keeps `elideStatement`'s own switch genuinely
 * exhaustive: `Item` includes every `Expression` variant, so a catch-all
 * default there would either need ~20 no-op cases or silently accept kinds
 * nobody's checked.
 *
 * This also means elision deliberately does not descend into arbitrary
 * expression subtrees (an `if`-expression's branches, a call argument, ...)
 * - only a `Block` used directly as a `let` initializer gets walked (via
 * `elideLetStatement`/`elideBlockStatements`). A locally-declared `fn`/
 * `struct`/`enum` nested inside some other expression position is not
 * reached; see the plan's documented out-of-scope note for this narrower
 * remaining gap.
 */
function isTypeBearingItem(
  item: Item,
): item is
  | FunctionDef
  | FunctionSignature
  | StructDecl
  | EnumDecl
  | TraitDecl
  | ImplDecl
  | LetStatement
  | ConstDecl
  | StaticDecl {
  return (
    item.kind === "Function" ||
    item.kind === "FunctionSignature" ||
    item.kind === "Struct" ||
    item.kind === "Enum" ||
    item.kind === "Trait" ||
    item.kind === "Impl" ||
    item.kind === "LetStatement" ||
    item.kind === "Const" ||
    item.kind === "Static"
  );
}

/**
 * Entry point for eliding any one `Item` - used both for `program.items`
 * and, recursively, for an `ImplDecl`'s own general `Item*` body. `TypeAlias`
 * is handled here rather than in `elideStatement` because it's an `Item`
 * variant only, not a `Statement` one - a top-level (or impl-nested) type
 * alias, unlike a trait's own associated `type`, has no enclosing
 * `TraitItem` dispatch to reach it through.
 */
function elideItem(
  item: Item,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): Item {
  if (item.kind === "TypeAlias") {
    return elideTypeAliasDecl(item, tokens, diagnostics);
  }
  return isTypeBearingItem(item)
    ? elideStatement(item, tokens, diagnostics, new Set())
    : item;
}

/**
 * Resolves every reference type's lifetime across the whole `Program`,
 * applying the three-rule elision algorithm (rules 1 and 2 - rule 3, the
 * self-receiver case, is out of scope; see the plan) to function
 * parameters/return types, and rejecting elided references anywhere else
 * (struct fields, `let` annotations, nested references) since no elision
 * rule applies there. Pushes diagnostics onto `diagnostics` for any
 * ambiguous or rule-less elided reference; the returned `Program` is always
 * structurally complete (every `ReferenceType.lifetime` is `some(...)`),
 * even when diagnostics were pushed, so downstream passes don't need their
 * own `none()` handling for a case this pass already normalizes away.
 */
export function elideLifetimes(
  program: Program,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): Program {
  return {
    ...program,
    items: program.items.map((item: Item): Item =>
      elideItem(item, tokens, diagnostics),
    ),
  };
}
