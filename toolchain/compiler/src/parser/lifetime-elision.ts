import { assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type {
  Block,
  FunctionDecl,
  Item,
  LetStatement,
  Lifetime,
  Param,
  Program,
  Statement,
  StructBody,
  StructDecl,
  Type,
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
 */
function createSynthesizer(
  usedNames: ReadonlySet<string>,
): (anchorTokenId: number) => Lifetime {
  const seen = new Set(usedNames);
  let counter = 0;
  return (anchorTokenId: number): Lifetime => {
    let name = `_${counter}`;
    while (seen.has(name)) {
      counter += 1;
      name = `_${counter}`;
    }
    seen.add(name);
    counter += 1;
    return { kind: "Lifetime", tokenId: anchorTokenId, name };
  };
}

/** Collects every explicit lifetime name reachable from `type`, recursing
 * through `referent` chains - the full set a synthesizer must avoid. */
function collectTypeLifetimeNames(type: Type, names: Set<string>): void {
  if (type.kind !== "ReferenceType") {
    return;
  }
  if (isSome(type.lifetime)) {
    names.add(type.lifetime.value.name);
  }
  collectTypeLifetimeNames(type.referent, names);
}

/**
 * Resolves every `ReferenceType` reachable from `type`, including `type`
 * itself. None of these positions have an elision rule - the spec's three
 * rules only speak to a function's own top-level parameter/return
 * positions - so any elided reference found here (a struct field, a `let`
 * annotation, or a reference nested inside another reference) is rejected
 * with a diagnostic and given a synthesized placeholder lifetime, keeping
 * the invariant that every `ReferenceType` in the returned `Program` has a
 * resolved (`some(...)`) lifetime.
 */
function resolveNestedReferenceTypes(
  type: Type,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  synth: (anchorTokenId: number) => Lifetime,
): Type {
  if (type.kind !== "ReferenceType") {
    return type;
  }
  const referent = resolveNestedReferenceTypes(
    type.referent,
    tokens,
    diagnostics,
    synth,
  );
  if (isSome(type.lifetime)) {
    return { ...type, referent };
  }
  diagnostics.push({
    severity: "error",
    message: NO_ELISION_RULE_MESSAGE,
    span: spanOf(tokens, type.tokenId),
  });
  return { ...type, lifetime: some(synth(type.tokenId)), referent };
}

/**
 * Elides every statement in `block`, in place at this nesting level - used
 * both for a function's own body and for a `Block` expression used directly
 * as a `let` initializer (see `elideLetStatement`), so a locally-declared
 * `fn`/`struct` inside either gets the same treatment. Does not descend into
 * any other expression position (an `if`-expression's branches, a call
 * argument, ...) - see the out-of-scope note on `elideLifetimes` below.
 */
function elideBlockStatements(
  block: Block,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): Block {
  return {
    ...block,
    statements: block.statements.map((stmt: Statement): Statement =>
      elideStatement(stmt, tokens, diagnostics),
    ),
  };
}

function elideLetStatement(
  stmt: LetStatement,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): LetStatement {
  const type = isSome(stmt.type)
    ? some(
        resolveNestedReferenceTypes(
          stmt.type.value,
          tokens,
          diagnostics,
          createSynthesizer(collectNamesFromType(stmt.type.value)),
        ),
      )
    : stmt.type;
  const initializer =
    isSome(stmt.initializer) && stmt.initializer.value.kind === "Block"
      ? some(elideBlockStatements(stmt.initializer.value, tokens, diagnostics))
      : stmt.initializer;
  return { ...stmt, type, initializer };
}

function collectNamesFromType(type: Type): Set<string> {
  const names = new Set<string>();
  collectTypeLifetimeNames(type, names);
  return names;
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
  const names = new Set<string>(decl.generics.map((param) => param.name));
  for (const type of structBodyFieldTypes(decl.body)) {
    collectTypeLifetimeNames(type, names);
  }
  const synth = createSynthesizer(names);
  return {
    ...decl,
    body: elideStructBody(decl.body, tokens, diagnostics, synth),
  };
}

function elideFunctionDecl(
  decl: FunctionDecl,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): FunctionDecl {
  const names = new Set<string>(decl.generics.map((param) => param.name));
  for (const param of decl.params) {
    collectTypeLifetimeNames(param.type, names);
  }
  if (isSome(decl.returnType)) {
    collectTypeLifetimeNames(decl.returnType.value, names);
  }
  const synth = createSynthesizer(names);

  // Rule 1: each unannotated top-level reference parameter gets its own
  // fresh lifetime. Track whether exactly one reference parameter exists,
  // and if so its lifetime, for rule 2 below.
  let referenceParamCount = 0;
  let theSoleReferenceParamLifetime: Option<Lifetime> = none();
  const newParams = decl.params.map((param: Param): Param => {
    if (param.type.kind !== "ReferenceType") {
      return param;
    }
    const lifetime = isSome(param.type.lifetime)
      ? param.type.lifetime.value
      : synth(param.type.tokenId);
    referenceParamCount += 1;
    theSoleReferenceParamLifetime =
      referenceParamCount === 1 ? some(lifetime) : none();
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

  let newReturnType = decl.returnType;
  if (
    isSome(decl.returnType) &&
    decl.returnType.value.kind === "ReferenceType"
  ) {
    const returnRef = decl.returnType.value;
    let lifetime: Lifetime;
    if (isSome(returnRef.lifetime)) {
      lifetime = returnRef.lifetime.value;
    } else if (
      referenceParamCount === 1 &&
      isSome(theSoleReferenceParamLifetime)
    ) {
      lifetime = theSoleReferenceParamLifetime.value;
    } else {
      diagnostics.push({
        severity: "error",
        message: ambiguousReturnLifetimeMessage(referenceParamCount),
        span: spanOf(tokens, returnRef.tokenId),
      });
      lifetime = synth(returnRef.tokenId);
    }
    const referent = resolveNestedReferenceTypes(
      returnRef.referent,
      tokens,
      diagnostics,
      synth,
    );
    newReturnType = some({ ...returnRef, lifetime: some(lifetime), referent });
  }

  const newBody = elideBlockStatements(decl.body, tokens, diagnostics);

  return {
    ...decl,
    params: newParams,
    returnType: newReturnType,
    body: newBody,
  };
}

function elideStatement(
  stmt: Statement,
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
): Statement {
  switch (stmt.kind) {
    case "LetStatement":
      return elideLetStatement(stmt, tokens, diagnostics);
    case "ExpressionStatement":
      return stmt;
    case "Function":
      return elideFunctionDecl(stmt, tokens, diagnostics);
    case "Struct":
      return elideStructDecl(stmt, tokens, diagnostics);
    default:
      return assertNever(stmt, `Unexpected statement: ${JSON.stringify(stmt)}`);
  }
}

/**
 * Only `FunctionDecl`/`StructDecl`/`LetStatement` carry `Type` fields that
 * can hold a `ReferenceType` - every other `Item` kind is a bare expression
 * or `ExpressionStatement`, neither of which does. Narrowing to this subset
 * up front (rather than giving `elideStatement` a `default: return item`
 * branch over the full `Item` union) keeps `elideStatement`'s own switch
 * genuinely exhaustive: `Item` includes every `Expression` variant, so a
 * catch-all default there would either need ~20 no-op cases or silently
 * accept kinds nobody's checked.
 *
 * This also means elision deliberately does not descend into arbitrary
 * expression subtrees (an `if`-expression's branches, a call argument, ...)
 * - only a `Block` used directly as a `let` initializer gets walked (via
 * `elideLetStatement`/`elideBlockStatements`). A locally-declared `fn`/
 * `struct` nested inside some other expression position is not reached; see
 * the plan's documented out-of-scope note for this narrower remaining gap.
 */
function isTypeBearingItem(
  item: Item,
): item is FunctionDecl | StructDecl | LetStatement {
  return (
    item.kind === "Function" ||
    item.kind === "Struct" ||
    item.kind === "LetStatement"
  );
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
      isTypeBearingItem(item)
        ? elideStatement(item, tokens, diagnostics)
        : item,
    ),
  };
}
