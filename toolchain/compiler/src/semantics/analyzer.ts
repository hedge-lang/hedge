import { assert, assertNever } from "../assert.js";
import {
  errorDiagnostic,
  warningDiagnostic,
  type Diagnostic,
  type DiagnosticCode,
  type RelatedSpan,
} from "../diagnostics/index.js";
import type { IntSuffix, Token } from "../lexer/token.js";
import {
  isNone,
  isSome,
  mapSome,
  none,
  some,
  type Option,
  unwrapSomeOr,
} from "../option.js";
import type * as Parser from "../parser/ast.js";
import type * as Semantics from "./ast.js";
import {
  foldConstExpression,
  intLiteralValue,
  type ConstFoldOutcome,
  type FoldWidth,
} from "./const-eval.js";
import { hasCapability, type TypeCapability } from "./type-capabilities.js";

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly program: Semantics.Program;
  /** Every resolved trait bound at every generic call site, keyed by the
   * call's own `tokenId` - one entry per declared generic parameter's bound
   * that resolved, in the same order the callee declares them, for codegen
   * to turn into a hidden witness argument later. A call with unresolved
   * bounds carries no entry (analysis already reported the diagnostic). */
  readonly witnesses: ReadonlyMap<number, readonly WitnessRef[]>;
}

/** One trait method a witness carries, and where its implementation comes
 * from: the impl's own override, or the trait's own default body when the
 * impl doesn't override it. */
interface WitnessMethod {
  readonly name: string;
  readonly source: "impl" | "default";
}

/**
 * How one generic call site's declared bound resolved. `Impl` names the
 * registered impl (concrete or blanket) that satisfies it, plus its own
 * method list. `Forwarded` covers a still-abstract argument (the enclosing
 * declaration's own generic parameter) - there is no impl to reference yet,
 * since the concrete type isn't known until whatever calls the enclosing
 * function supplies it; codegen forwards the enclosing function's own
 * received witness for `paramName` instead of resolving a new one.
 */
type WitnessRef =
  | {
      readonly kind: "Impl";
      readonly traitName: string;
      readonly typeName: string;
      readonly implTokenId: number;
      readonly methods: readonly WitnessMethod[];
    }
  | {
      readonly kind: "Forwarded";
      readonly traitName: string;
      readonly paramName: string;
    };

/**
 * Everything one lexical scope owns, in a single object so a scope is pushed
 * and popped as one unit. Frame *indices* are compared across these maps
 * (`scopeFrameIndexOf` against `findConstFrameIndex`,
 * `resolvedNameIsStatic`), so they must stay aligned; separate per-kind
 * stacks made that a convention rather than a guarantee.
 */
interface ScopeFrame {
  readonly vars: Map<string, ScopedVariable>;
  readonly constDecls: Map<string, Parser.ConstDecl>;
  readonly constValues: Map<string, ConstEntry>;
  readonly staticTypes: Map<string, Semantics.Type>;
  readonly types: Map<string, Semantics.StructDecl>;
  readonly enums: Map<string, Semantics.EnumDecl>;
  /** Trait name -> its declaration's name tokenId, so a reference resolves
   * to the lexically-visible declaration and `traitRegistry` (keyed by
   * `scopedTypeName`) is looked up by identity, not bare name. */
  readonly traits: Map<string, number>;
}

/**
 * Mutable analysis context threaded explicitly through every pass function.
 * Maps onto `struct AnalysisContext { scopes: ..., diagnostics: ... }` in Hedge.
 */
interface AnalysisContext {
  /** Innermost scope last. Frame 0 is the top-level program. */
  readonly frames: ScopeFrame[];
  readonly diagnostics: Diagnostic[];
  readonly tokens: readonly Token[];
  /**
   * Flat, not scoped - only tracks names currently mid-resolution on the
   * call stack for cycle detection, which never spans scopes (an outer
   * const's fold can't recurse into an inner block that hasn't been entered
   * yet).
   */
  readonly constResolving: Set<string>;
  /**
   * The currently-open item's own type-parameter names, pushed/popped per
   * `fn`/`struct`/`enum`. Only the top is ever consulted - a nested local
   * item is its own independent scope, not a closure, so it no more
   * inherits an enclosing item's generics than it would its locals.
   */
  readonly genericParamStack: ReadonlySet<string>[];
  /** Same lifecycle as `genericParamStack`, keyed the same way - each
   * declared type parameter's own inline trait bounds, so a call inside a
   * generic body can check a still-abstract argument's bound against the
   * enclosing declaration's own bound list instead of searching
   * `implRegistry` for a concrete impl that doesn't exist yet. */
  readonly genericParamBoundStack: ReadonlyMap<string, readonly string[]>[];
  /**
   * Every trait impl registered anywhere in the program, flat and
   * program-wide rather than scoped to a frame - an impl's existence is a
   * fact needed by any generic call that resolves its bound, regardless of
   * how deeply the impl itself is nested, so scoping it like a type name
   * would make coherence checking depend on textual position.
   */
  readonly implRegistry: RegisteredImpl[];
  /** Every trait's own supertraits and required methods, keyed by trait
   * name - flat and program-wide for the same reason `implRegistry` is:
   * these are facts about the trait itself, not about where it happens to
   * be declared. */
  readonly traitRegistry: Map<string, RegisteredTrait>;
  /** Mutable build-up of `AnalysisResult.witnesses`, keyed by call-site
   * `tokenId`. */
  readonly witnessTable: Map<number, WitnessRef[]>;
  /**
   * What `Self` means at the innermost currently-open trait or impl body -
   * only the top is ever consulted, same lifecycle as `genericParamStack`. A
   * nested item inside a method body would be its own independent scope
   * (never populated today, since method bodies aren't analyzed), not a
   * closure over the enclosing trait/impl.
   */
  readonly selfContextStack: SelfContext[];
}

/**
 * `Trait`: `Self` is abstract (this trait's own name plus its directly
 * declared associated-type names - a `Self::X` reference searches this set
 * and each supertrait's own, transitively). `Impl`: `Self` is concrete (the
 * impl's own target type), and `associatedTypes` is this impl's own
 * `type Name = Value;` definitions, already resolved - a `Self::X` reference
 * inside an impl substitutes directly against this map rather than staying a
 * `ProjectionType`, since the target is no longer abstract.
 */
type SelfContext =
  | {
      readonly kind: "Trait";
      readonly traitName: string;
      readonly associatedTypes: readonly string[];
    }
  | {
      readonly kind: "Impl";
      readonly targetType: Semantics.Type;
      readonly traitName: Option<string>;
      readonly associatedTypes: ReadonlyMap<string, Semantics.Type>;
    };

/** The trait method that stops a `dyn` object from being formed: one that
 * takes `Self` in a non-receiver argument position. `declaringTrait` is the
 * trait that declares it - the `dyn`'d trait itself, or one of its
 * supertraits. A generic method and a `Self` return type both stay safe,
 * unlike in Rust. */
interface SelfArgMethod {
  readonly methodName: string;
  readonly declaringTrait: string;
}

/** One registered trait's own supertrait and required-method names, for
 * checking an impl of it against both, plus its own directly declared
 * associated-type names for projection resolution. */
interface RegisteredTrait {
  readonly supertraits: readonly string[];
  readonly methods: readonly Semantics.TraitMethod[];
  readonly associatedTypes: readonly string[];
  /** `none()` when the trait is object-safe, accounting for its supertraits
   * (see `propagateSupertraitObjectSafety`). */
  readonly notObjectSafe: Option<SelfArgMethod>;
}

/** One registered trait impl, extracted just far enough for coherence and
 * bound checking. */
interface RegisteredImpl {
  readonly traitName: string;
  readonly targetTypeName: string;
  readonly isBlanket: boolean;
  readonly blanketBounds: readonly string[];
  readonly providedMethods: readonly string[];
  /** Every `type Name = Value;` this impl defines, resolved eagerly during
   * registration (not left for `analyzeImplDecl`'s own real pass) so a
   * *different* impl - of a supertrait, for the same target - can look this
   * one up regardless of which of the two gets analyzed first. */
  readonly associatedTypeDefs: ReadonlyMap<string, Semantics.Type>;
  readonly tokenId: number;
}

function newScopeFrame(): ScopeFrame {
  return {
    vars: new Map(),
    constDecls: new Map(),
    constValues: new Map(),
    staticTypes: new Map(),
    types: new Map(),
    enums: new Map(),
    traits: new Map(),
  };
}

function pushFrame(ctx: AnalysisContext): void {
  ctx.frames.push(newScopeFrame());
}

function popFrame(ctx: AnalysisContext): void {
  ctx.frames.pop();
}

/** The innermost frame. An empty stack is an internal invariant violation. */
function currentFrame(ctx: AnalysisContext): ScopeFrame {
  const frame = ctx.frames.at(-1);
  assert(frame !== undefined, "no active scope frame");
  return frame;
}

/** `TypeParam` names only, in declaration order - a `LifetimeParam` carries
 * no type identity a signature or field type could ever reference. */
function genericParamNames(
  generics: readonly Parser.GenericParam[],
): readonly string[] {
  return generics
    .filter((param): param is Parser.TypeParam => param.kind === "TypeParam")
    .map((param) => param.name.text);
}

/** Each `TypeParam`'s own inline trait-bound names (`T: Draw`), keyed by
 * parameter name - a `LifetimeTraitBound` (`T: 'a`) contributes nothing,
 * since it names no trait. Merges in any matching `where`-clause predicate
 * too (`where T: Draw`), since a bound written there is exactly as binding
 * as one written inline - only a `where` predicate whose own type is a bare
 * name matching a declared parameter is recognized, the same scope inline
 * bounds are already limited to. */
function genericParamBoundNames(
  generics: readonly Parser.GenericParam[],
  whereClause: Option<Parser.WhereClause> = none(),
): ReadonlyMap<string, readonly string[]> {
  const bounds = new Map<string, readonly string[]>();
  for (const param of generics) {
    if (param.kind !== "TypeParam") continue;
    bounds.set(param.name.text, traitBoundNames(param.bounds));
  }
  for (const predicate of isSome(whereClause)
    ? whereClause.value.predicates
    : []) {
    if (
      predicate.type.kind !== "NamedType" ||
      predicate.type.path.segments.length !== 1
    ) {
      continue;
    }
    const name = predicate.type.path.segments[0];
    const existing = name === undefined ? undefined : bounds.get(name);
    if (name === undefined || existing === undefined) continue;
    bounds.set(name, [...existing, ...traitBoundNames(predicate.bounds)]);
  }
  return bounds;
}

/** Resolves every bound name in a `param -> bound names` map to its
 * scope-qualified `traitRegistry` key, against the scope in effect now -
 * used when building a signature's persisted `genericParamBounds`, so a
 * later call site checks the trait visible where the callee was declared,
 * not where it's called. */
function resolveBoundNames(
  ctx: AnalysisContext,
  bounds: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    [...bounds].map(([param, names]) => [
      param,
      names.map((name) => lookupTrait(ctx, name) ?? name),
    ]),
  );
}

/** Extracts the trait names from a list of `TraitBound`s - a
 * `LifetimeTraitBound` (`T: 'a`) contributes nothing, since it names no
 * trait. Shared by inline (`T: Draw`) and `where`-clause (`where T: Draw`)
 * bound lists alike. */
function traitBoundNames(
  bounds: readonly Parser.TraitBound[],
): readonly string[] {
  return bounds
    .filter(
      (bound): bound is Parser.PathTraitBound =>
        bound.kind === "PathTraitBound",
    )
    .map((bound) => bound.path.segments.at(-1) ?? "");
}

/** Whether any registered trait carries this bare name, regardless of the
 * scope it was declared in - an existence check, not identity resolution
 * (which happens at the reference's own use site). */
function traitNameIsRegistered(ctx: AnalysisContext, name: string): boolean {
  const suffix = `::${name}`;
  for (const key of ctx.traitRegistry.keys()) {
    if (key === name || key.endsWith(suffix)) return true;
  }
  return false;
}

/** Rejects any trait bound naming a trait that isn't declared - a sibling
 * of `traitBoundNames`, which only extracts names and never checks them.
 * Callers run this once `ctx.traitRegistry` is known to be fully populated
 * for whatever it's checking against (immediately for a bound list that
 * can't forward-reference anything still being registered, or after a
 * dedicated first pass when it can, as trait supertraits do). */
function validateTraitBoundNames(
  ctx: AnalysisContext,
  bounds: readonly Parser.TraitBound[],
): void {
  for (const bound of bounds) {
    if (bound.kind !== "PathTraitBound") continue;
    const name = bound.path.segments.at(-1) ?? "";
    if (traitNameIsRegistered(ctx, name)) continue;
    emitError(
      ctx,
      `cannot find trait \`${name}\` in this scope`,
      bound.tokenId,
      "HEDGE-NAME-001",
    );
  }
}

/** Validates every trait bound named across `generics`' own inline bounds
 * and `whereClause`'s predicates - the same two sources
 * `genericParamBoundNames` merges names from, checked here instead of
 * silently trusted. `ctx.traitRegistry` must already be fully populated
 * when this runs. */
function validateGenericParamBounds(
  ctx: AnalysisContext,
  generics: readonly Parser.GenericParam[],
  whereClause: Option<Parser.WhereClause>,
): void {
  for (const param of generics) {
    if (param.kind !== "TypeParam") continue;
    validateTraitBoundNames(ctx, param.bounds);
  }
  for (const predicate of isSome(whereClause)
    ? whereClause.value.predicates
    : []) {
    validateTraitBoundNames(ctx, predicate.bounds);
  }
}

function pushGenericParams(
  ctx: AnalysisContext,
  generics: readonly Parser.GenericParam[],
  whereClause: Option<Parser.WhereClause> = none(),
): void {
  ctx.genericParamStack.push(new Set(genericParamNames(generics)));
  ctx.genericParamBoundStack.push(
    genericParamBoundNames(generics, whereClause),
  );
}

function popGenericParams(ctx: AnalysisContext): void {
  ctx.genericParamStack.pop();
  ctx.genericParamBoundStack.pop();
}

/** Only the innermost open item's own type parameters are visible. */
function isDeclaredGenericParam(ctx: AnalysisContext, name: string): boolean {
  const innermost = ctx.genericParamStack.at(-1);
  return innermost?.has(name) ?? false;
}

/** The innermost open item's own declared bounds for one of its type
 * parameters, each resolved to its scope-qualified `traitRegistry` key -
 * empty for a parameter with no bounds, or one not declared by the innermost
 * item at all. */
function declaredGenericParamBounds(
  ctx: AnalysisContext,
  name: string,
): readonly string[] {
  const innermost = ctx.genericParamBoundStack.at(-1);
  return (innermost?.get(name) ?? []).map(
    (bound) => lookupTrait(ctx, bound) ?? bound,
  );
}

function pushSelfContext(ctx: AnalysisContext, self: SelfContext): void {
  ctx.selfContextStack.push(self);
}

function popSelfContext(ctx: AnalysisContext): void {
  ctx.selfContextStack.pop();
}

function currentSelfContext(ctx: AnalysisContext): SelfContext | undefined {
  return ctx.selfContextStack.at(-1);
}

/**
 * Every trait among `seedTraitNames` or reachable from one through a
 * supertrait chain that declares an associated type named `assocName`,
 * preserving first-seen order so a caller can report a deterministic
 * ambiguity list. Shared by `Self::X` inside a trait's own declaration
 * (`seedTraitNames` is just that trait's own name) and `T::X` for a bound
 * generic parameter (`seedTraitNames` is every trait `T` is directly bound
 * to) - both are the same question: which of a known set of traits (plus
 * their own supertraits) declares this name.
 */
function collectAssociatedTypeTraits(
  ctx: AnalysisContext,
  seedTraitNames: readonly string[],
  assocName: string,
  visiting: ReadonlySet<string> = new Set(),
): readonly string[] {
  const found: string[] = [];
  for (const traitName of seedTraitNames) {
    if (visiting.has(traitName)) continue;
    const trait = ctx.traitRegistry.get(traitName);
    if (trait === undefined) continue;
    if (trait.associatedTypes.includes(assocName)) found.push(traitName);
    const nextVisiting = new Set(visiting).add(traitName);
    for (const viaSupertrait of collectAssociatedTypeTraits(
      ctx,
      trait.supertraits,
      assocName,
      nextVisiting,
    )) {
      if (!found.includes(viaSupertrait)) found.push(viaSupertrait);
    }
  }
  return found;
}

/** Which trait among a searched set declares an associated type - shared
 * result shape for every `Self::X`/`T::X` resolution site, so each caller
 * handles "found"/"ambiguous"/"not found" the same way instead of
 * re-deriving them from `collectAssociatedTypeTraits`'s own match list. */
type AssociatedTypeSearchResult =
  | { readonly kind: "Found"; readonly traitName: string }
  | { readonly kind: "Ambiguous"; readonly matches: readonly string[] }
  | { readonly kind: "NotFound" };

function resolveAssociatedTypeTrait(
  ctx: AnalysisContext,
  seedTraitNames: readonly string[],
  assocName: string,
): AssociatedTypeSearchResult {
  const matches = collectAssociatedTypeTraits(ctx, seedTraitNames, assocName);
  if (matches.length > 1) return { kind: "Ambiguous", matches };
  const match = matches[0];
  return match === undefined
    ? { kind: "NotFound" }
    : { kind: "Found", traitName: match };
}

/**
 * Warns when a generic parameter's name collides with an outer struct or
 * enum - the parameter still wins; this only flags the ambiguity for
 * the reader.
 */
function resolveDeclaredGenericParam(
  ctx: AnalysisContext,
  name: string,
  tokenId: number,
  path: Parser.Path,
): Semantics.Type {
  if (
    lookupStruct(ctx, name) !== undefined ||
    lookupEnum(ctx, name) !== undefined
  ) {
    emitWarning(
      ctx,
      `generic parameter \`${name}\` shadows an existing type of the same name`,
      tokenId,
      "HEDGE-LINT-002",
    );
  }
  return { kind: "NamedType", tokenId, path };
}

/**
 * Syntactic, not semantic: walks every named-type mention in a field's own
 * declared type, regardless of whether that position type-checks. A generic
 * parameter mentioned only inside an array's element type or another type's
 * argument list still counts as used, so a position that isn't resolvable
 * yet (see `NamedType`'s own resolution above) doesn't also get flagged as
 * an unused-parameter error on top of its own rejection.
 */
function collectNamedTypeMentions(type: Parser.Type, names: Set<string>): void {
  switch (type.kind) {
    case "NamedType": {
      if (type.path.segments.length === 1) {
        const name = type.path.segments[0];
        if (name !== undefined) names.add(name);
      }
      for (const arg of type.typeArguments) {
        collectNamedTypeMentions(arg, names);
      }
      return;
    }
    case "ReferenceType":
      collectNamedTypeMentions(type.referent, names);
      return;
    case "ArrayType":
      collectNamedTypeMentions(type.elementType, names);
      return;
    case "UnitType":
      return;
    case "DynType":
      for (const arg of type.bound.typeArguments) {
        collectNamedTypeMentions(arg, names);
      }
      return;
    default:
      assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function structFieldUsedNames(body: Parser.StructBody): Set<string> {
  const names = new Set<string>();
  if (body.kind === "NamedFields" || body.kind === "TupleFields") {
    for (const field of body.fields) {
      collectNamedTypeMentions(field.type, names);
    }
  }
  return names;
}

function enumVariantUsedNames(
  variants: readonly Parser.Variant[],
): Set<string> {
  const names = new Set<string>();
  for (const variant of variants) {
    if (!isSome(variant.body)) continue;
    for (const field of variant.body.value.fields) {
      collectNamedTypeMentions(field.type, names);
    }
  }
  return names;
}

/**
 * Struct/enum only - a function's own type parameter is exempt (never
 * called from `analyzeFunctionDecl`), since a function has no type-identity
 * concern an unused parameter could leave unresolved, unlike a struct or
 * enum field. A bound alone (`T: Draw`) does not count as usage, since only
 * `usedNames` (collected from real field/variant types) is consulted here,
 * never `param.bounds`.
 */
function checkUnusedGenericParams(
  ctx: AnalysisContext,
  generics: readonly Parser.GenericParam[],
  usedNames: ReadonlySet<string>,
): void {
  for (const param of generics) {
    if (param.kind !== "TypeParam") continue;
    if (usedNames.has(param.name.text)) continue;
    emitError(
      ctx,
      `type parameter \`${param.name.text}\` is declared but never used`,
      param.tokenId,
      "HEDGE-TYPE-009",
    );
  }
}

/** Innermost frame index whose `select`ed map declares `name`, or -1. */
function frameIndexOf(
  ctx: AnalysisContext,
  name: string,
  select: (frame: ScopeFrame) => ReadonlyMap<string, unknown>,
): number {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const frame = ctx.frames[i];
    if (frame !== undefined && select(frame).has(name)) {
      return i;
    }
  }
  return -1;
}

/** Innermost-first: an inner declaration shadows an outer one. */
function lookupStruct(
  ctx: AnalysisContext,
  name: string,
): Semantics.StructDecl | undefined {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const decl = ctx.frames[i]?.types.get(name);
    if (decl !== undefined) return decl;
  }
  return undefined;
}

/** Innermost-first: an inner declaration shadows an outer one. */
function lookupEnum(
  ctx: AnalysisContext,
  name: string,
): Semantics.EnumDecl | undefined {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const decl = ctx.frames[i]?.enums.get(name);
    if (decl !== undefined) return decl;
  }
  return undefined;
}

/** Innermost-first: the scope-qualified `traitRegistry` key a bare trait
 * name resolves to in the current scope, or `undefined` if no trait of that
 * name is visible. */
function lookupTrait(ctx: AnalysisContext, name: string): string | undefined {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const tokenId = ctx.frames[i]?.traits.get(name);
    if (tokenId !== undefined) return scopedTypeName(tokenId, name);
  }
  return undefined;
}

/** A bare name's own resolved type if it names a struct or enum in scope -
 * `undefined` for anything else, leaving the caller to decide what "not a
 * struct or enum" means for it (an error, a further fallback, ...). */
function lookupStructOrEnumType(
  ctx: AnalysisContext,
  name: string,
): Semantics.Type | undefined {
  const structDecl = lookupStruct(ctx, name);
  if (structDecl !== undefined) return structDecl.type;
  const enumDecl = lookupEnum(ctx, name);
  if (enumDecl !== undefined) return enumDecl.type;
  return undefined;
}

interface ConstEntry {
  readonly declaredType: Semantics.Type;
  readonly value: Option<Semantics.ConstValue>;
}

interface ScopedVariable {
  readonly type: Semantics.Type;
  readonly mutable: boolean;
}

/** Synthetic unit type used for nodes that produce no value. */
const UNIT: Semantics.UnitType = { kind: "UnitType", tokenId: 0 };

function getType(expr: Semantics.Expression): Semantics.Type {
  return expr.type;
}

/**
 * Names and types available before any user code - Slice 1 prelude.
 *
 * TODO(Hedge-64): `print`'s declared parameter list is a stand-in, not its
 * real signature. Its runtime shim accepts any value and stringifies it,
 * and there is no conversion facility in the language yet, so a strict
 * `str` parameter would make it impossible to print a number at all. Once
 * `Display` exists, this should become a bound on it and
 * `paramsArePlaceholder` should go back to false so calls are checked like
 * any other.
 */
const BUILTIN_SCOPE: [string, ScopedVariable][] = [
  [
    "print",
    {
      type: {
        kind: "FunctionType",
        params: [{ kind: "PrimitiveStringType" }],
        returnType: UNIT,
        paramsArePlaceholder: true,
        genericParams: [],
        genericParamBounds: new Map(),
      },
      mutable: false,
    },
  ],
];

/**
 * Binds a given {@link name} to a specific {@link type} within the current scope of the analysis context.
 *
 * @param ctx - The analysis context containing the scope stack.
 * @param name - The identifier to bind within the current scope.
 * @param scopedVariable - The type associated with the identifier.
 */
function bind(
  ctx: AnalysisContext,
  name: string,
  scopedVariable: ScopedVariable,
): void {
  currentFrame(ctx).vars.set(name, scopedVariable);
}

const REFUTABLE_LET_OR_PARAM_PATTERN_MESSAGE =
  "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match";

/**
 * Analyzes a `let`/parameter pattern exactly like a match arm's own pattern
 * (via `analyzePattern`, which binds every name the pattern structurally
 * contains - a destructuring pattern kind (struct/tuple-struct/slice/etc.)
 * is real syntax as of Slice 3, see `parser/pattern.ts`), then rejects it if
 * it's refutable - a `let`/parameter position has no "didn't match" branch
 * to fall back to, unlike `match`/`if let`/`while let` (spec 0016). The
 * rejection is layered on top of, not instead of, the real analysis: every
 * name the pattern binds is still in scope afterward, so a reference to one
 * of them doesn't cascade into a second, unrelated "cannot find name"
 * diagnostic on top of this one. `analyzePattern` itself still guardrails
 * `TuplePattern` and a dynamic-length `SlicePattern` (no real tuple/slice
 * value type exists yet) and an `@`-subpattern binding - those keep hitting
 * `analyzePatternGuardrail`'s own "not yet supported" diagnostic instead of
 * this one, unchanged.
 */
function analyzeLetOrParamPattern(
  ctx: AnalysisContext,
  pattern: Parser.Pattern,
  type: Semantics.Type,
  rootExpression: Option<Semantics.Expression>,
): Semantics.Pattern {
  const { mode, effectiveType } = defaultBindingModeForScrutinee(type);
  // A parameter has no initializer expression to check root place
  // mutability against at all (`rootExpression` is `none()`) - the only way
  // to make a &mut field override legal there is the pattern's own `mut`
  // marker, applied by `analyzePattern` itself once it reaches a
  // `mutable: true` struct/tuple-struct pattern node.
  const rootMutable = isSome(rootExpression)
    ? !isSome(placeMutabilityViolation(ctx, rootExpression.value, true))
    : false;
  const result = analyzePattern(ctx, pattern, effectiveType, mode, rootMutable);
  if (!isIrrefutablePattern(ctx, result)) {
    emitError(
      ctx,
      REFUTABLE_LET_OR_PARAM_PATTERN_MESSAGE,
      pattern.tokenId,
      "HEDGE-PATTERN-001",
    );
  }
  return result;
}

/**
 * Resolves the semantic type associated with a given {@link name} within the context's scopes.
 *
 * @param ctx - The analysis context containing scoped information.
 * @param name - The name of the entity to resolve within the context's scopes.
 * @return An optional semantic type if the name is found, or none if it is not.
 */
function resolve(ctx: AnalysisContext, name: string): Option<ScopedVariable> {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const scopedVariable = ctx.frames[i]?.vars.get(name);
    if (scopedVariable !== undefined) return some(scopedVariable);
  }
  return none();
}

/**
 * Emits an error diagnostic message for a given token in the analysis context.
 *
 * @param ctx - The analysis context where the error will be recorded.
 * @param message - The error message to emit.
 * @param tokenId - The identifier of the token associated with the error.
 * @param code - Stable identifier for this diagnostic, if it has one.
 * @param relatedSpans - Secondary source locations, e.g. the site a
 *   conflicting value was first bound at.
 */
function emitError(
  ctx: AnalysisContext,
  message: string,
  tokenId: number,
  code: DiagnosticCode,
  relatedSpans?: readonly RelatedSpan[],
): void {
  const token = ctx.tokens[tokenId];
  const diagnostic = errorDiagnostic(
    code,
    message,
    token !== undefined ? some(token.span) : none(),
  );
  ctx.diagnostics.push(
    relatedSpans !== undefined ? { ...diagnostic, relatedSpans } : diagnostic,
  );
}

function emitWarning(
  ctx: AnalysisContext,
  message: string,
  tokenId: number,
  code: DiagnosticCode,
  relatedSpans?: readonly RelatedSpan[],
): void {
  const token = ctx.tokens[tokenId];
  const diagnostic = warningDiagnostic(
    code,
    message,
    token !== undefined ? some(token.span) : none(),
  );
  ctx.diagnostics.push(
    relatedSpans !== undefined ? { ...diagnostic, relatedSpans } : diagnostic,
  );
}

// eslint-disable-next-line complexity -- Routing function
function namedTypeToPrimitive(name: string): Option<Semantics.PrimitiveType> {
  switch (name) {
    case "bool":
      return some({ kind: "PrimitiveBooleanType" });
    case "str":
      return some({ kind: "PrimitiveStringType" });
    case "char":
      return some({ kind: "PrimitiveCharType" });
    case "i8":
      return some({ kind: "PrimitiveI8Type" });
    case "i16":
      return some({ kind: "PrimitiveI16Type" });
    case "i32":
      return some({ kind: "PrimitiveI32Type" });
    case "i64":
      return some({ kind: "PrimitiveI64Type" });
    case "u8":
      return some({ kind: "PrimitiveU8Type" });
    case "u16":
      return some({ kind: "PrimitiveU16Type" });
    case "u32":
      return some({ kind: "PrimitiveU32Type" });
    case "u64":
      return some({ kind: "PrimitiveU64Type" });
    case "usize":
      return some({ kind: "PrimitiveUsizeType" });
    case "isize":
      return some({ kind: "PrimitiveIsizeType" });
    case "f32":
      return some({ kind: "PrimitiveF32Type" });
    case "f64":
      return some({ kind: "PrimitiveF64Type" });
    default:
      return none();
  }
}

function intSuffixToPrimitive(suffix: IntSuffix): Semantics.PrimitiveType {
  switch (suffix) {
    case "i8":
      return { kind: "PrimitiveI8Type" };
    case "i16":
      return { kind: "PrimitiveI16Type" };
    case "i32":
      return { kind: "PrimitiveI32Type" };
    case "i64":
      return { kind: "PrimitiveI64Type" };
    case "isize":
      return { kind: "PrimitiveIsizeType" };
    case "u8":
      return { kind: "PrimitiveU8Type" };
    case "u16":
      return { kind: "PrimitiveU16Type" };
    case "u32":
      return { kind: "PrimitiveU32Type" };
    case "u64":
      return { kind: "PrimitiveU64Type" };
    case "usize":
      return { kind: "PrimitiveUsizeType" };
    default:
      return assertNever(suffix, `Unexpected int suffix: ${String(suffix)}`);
  }
}

/**
 * Const-folds an array type's length, or an array-repeat expression's
 * count, to a resolved `number` - `none()` if it isn't a compile-time
 * integer constant (after emitting the appropriate diagnostic; a
 * dependency-already-failed `AlreadyDiagnosed` outcome emits nothing new,
 * matching `resolveConstDecl`'s own cascade suppression). Folds unbounded
 * (no wrap) rather than at any fixed width - an array length has no
 * runtime width of its own, and wrapping an oversized value would turn it
 * into a deceptively "valid" small one instead of rejecting it. This
 * function range-checks the exact unwrapped result itself, before
 * `Number(bigint)` has a chance to silently produce `Infinity` or an
 * imprecise value - which would otherwise surface far from the mistake, as
 * a confusing runtime `RangeError` from `new Array(Infinity)` in the
 * *compiled* program rather than here.
 */
function foldArrayLength(
  ctx: AnalysisContext,
  length: Parser.Expression,
): Option<number> {
  const outcome = foldConstExpression(
    length,
    some({ kind: "unbounded" }),
    (name, tokenId) => resolveConstRef(ctx, name, tokenId),
  );
  switch (outcome.kind) {
    case "NotFoldable":
      emitError(
        ctx,
        "array length must be a compile-time constant expression",
        outcome.tokenId,
        "HEDGE-CONST-004",
      );
      return none();
    case "Undeclared":
      emitError(
        ctx,
        `Cannot find name "${outcome.name}" in this scope.`,
        outcome.tokenId,
        "HEDGE-NAME-001",
      );
      return none();
    case "DivideByZero":
      emitError(
        ctx,
        "attempt to divide by zero in a constant expression",
        outcome.tokenId,
        "HEDGE-CONST-003",
      );
      return none();
    case "InvalidShift":
      emitError(
        ctx,
        "shift amount must be between 0 and 63 in a constant expression",
        outcome.tokenId,
        "HEDGE-CONST-003",
      );
      return none();
    case "AlreadyDiagnosed":
      return none();
    case "Ok":
      break;
    default:
      assertNever(
        outcome,
        `Unexpected fold outcome: ${JSON.stringify(outcome)}`,
      );
  }
  if (outcome.value.kind !== "Int") {
    emitError(
      ctx,
      "array length must be an integer",
      length.tokenId,
      "HEDGE-CONST-004",
    );
    return none();
  }
  if (outcome.value.value < 0n) {
    emitError(
      ctx,
      "array length cannot be negative",
      length.tokenId,
      "HEDGE-CONST-004",
    );
    return none();
  }
  // An index is a `usize`, so a longer array could not be indexed by the type
  // that describes its own length. Derived from `usize`'s own bounds rather
  // than restating a literal, so the two cannot drift apart.
  const usizeMax = INT_BOUNDS.get("PrimitiveUsizeType")?.[1];
  assert(usizeMax !== undefined, "usize has no declared bounds");
  if (outcome.value.value > usizeMax) {
    emitError(
      ctx,
      `array length ${outcome.value.value} exceeds the maximum ${usizeMax}`,
      length.tokenId,
      "HEDGE-CONST-004",
    );
    return none();
  }
  return some(Number(outcome.value.value));
}

/**
 * True for `Self`, or `Self` under any number of `&`/`&mut` wrappers - used
 * to suppress a second, downstream type-mismatch diagnostic against
 * `validateSlice1Type`'s `UnitType` error-recovery placeholder for `Self`
 * (the placeholder is indistinguishable from a genuine unit type once
 * resolved, so a non-unit body/initializer would otherwise cascade a
 * spurious mismatch on top of `HEDGE-NAME-006`).
 */
function isSelfType(type: Parser.Type): boolean {
  if (type.kind === "ReferenceType") {
    return isSelfType(type.referent);
  }
  return (
    type.kind === "NamedType" &&
    type.path.segments.length === 1 &&
    type.path.segments[0] === "Self"
  );
}

/** Shared by both `validateProjectionType` branches that search a set of
 * bound traits for one declaring `assocName` - two or more matches is
 * ambiguous either way, worded identically regardless of whether the search
 * came from `Self`'s own trait or a generic parameter's bounds. */
function emitAmbiguousAssociatedType(
  ctx: AnalysisContext,
  tokenId: number,
  assocName: string,
  matches: readonly string[],
): Semantics.Type {
  const matchList = matches.map((n) => `\`${bareTypeName(n)}\``).join(", ");
  emitError(
    ctx,
    `associated type \`${assocName}\` is ambiguous between traits ${matchList}`,
    tokenId,
    "HEDGE-TRAIT-006",
  );
  return { kind: "UnitType", tokenId };
}

/** `HEDGE-TRAIT-005` plus the `UnitType` error-recovery placeholder - no
 * trait in the searched set declares the associated type. `message` is
 * caller-supplied because the phrasing depends on what the search was rooted
 * in (a concrete impl, a trait, a generic parameter's bounds). */
function emitUnresolvedAssociatedType(
  ctx: AnalysisContext,
  tokenId: number,
  message: string,
): Semantics.Type {
  emitError(ctx, message, tokenId, "HEDGE-TRAIT-005");
  return { kind: "UnitType", tokenId };
}

/** The shared tail of the two abstract projection paths (`Self::X` in a
 * trait, `T::X` for a bound parameter): search `seedTraitNames` and their
 * supertraits for the one declaring `assocName` - a lone match becomes a
 * projection node named after `projectionBaseName`, several are ambiguous,
 * none emits `notFoundMessage`. Callers differ only in the seed set and the
 * two diagnostic wordings. Never called with an empty seed set - that falls
 * through to the "unsupported qualified path" diagnostic instead. */
function resolveAbstractProjection(
  ctx: AnalysisContext,
  search: {
    readonly seedTraitNames: readonly string[];
    readonly projectionBaseName: string;
    readonly assocName: string;
    readonly tokenId: number;
    readonly notFoundMessage: string;
  },
): Semantics.Type {
  const { assocName, tokenId } = search;
  const result = resolveAssociatedTypeTrait(
    ctx,
    search.seedTraitNames,
    assocName,
  );
  switch (result.kind) {
    case "Ambiguous":
      return emitAmbiguousAssociatedType(
        ctx,
        tokenId,
        assocName,
        result.matches,
      );
    case "Found":
      return makeProjectionType(
        tokenId,
        result.traitName,
        assocName,
        search.projectionBaseName,
      );
    case "NotFound":
      return emitUnresolvedAssociatedType(ctx, tokenId, search.notFoundMessage);
    default:
      return assertNever(result, "Unexpected associated-type search result");
  }
}

/** Builds the unresolved-projection node itself - shared by every site that
 * reaches a `Found` `AssociatedTypeSearchResult`, so the `NamedType`-shaped
 * `selfType` (see `ProjectionType`'s own doc comment) is only ever
 * constructed in one place. */
function makeProjectionType(
  tokenId: number,
  traitName: string,
  assocName: string,
  selfBaseName: string,
): Semantics.Type {
  return {
    kind: "Projection",
    tokenId,
    traitName,
    assocName,
    selfType: {
      kind: "NamedType",
      tokenId,
      path: { absolute: false, segments: [selfBaseName] },
    },
  };
}

/** `Self::assocName` when `self` is a concrete impl - direct hit on this
 * impl's own definitions, else a supertrait's own separate impl (see
 * `resolveAssociatedTypeViaSupertrait`), else the "not found" error. Split
 * out of `validateProjectionType` purely to keep that function's own
 * branching under the complexity cap - no shared behavior with anything
 * else. */
function validateSelfProjectionInImpl(
  ctx: AnalysisContext,
  self: SelfContext & { kind: "Impl" },
  assocName: string,
  tokenId: number,
): Semantics.Type {
  const resolved =
    self.associatedTypes.get(assocName) ??
    (isSome(self.traitName)
      ? resolveAssociatedTypeViaSupertrait(
          ctx,
          self.traitName.value,
          self.targetType,
          assocName,
        )
      : undefined);
  return (
    resolved ??
    emitUnresolvedAssociatedType(
      ctx,
      tokenId,
      `cannot find associated type \`${assocName}\` on \`${describeType(self.targetType)}\``,
    )
  );
}

function emitUnsupportedQualifiedPath(
  ctx: AnalysisContext,
  tokenId: number,
): Semantics.Type {
  emitError(
    ctx,
    "qualified type paths are not supported yet",
    tokenId,
    "HEDGE-UNSUPPORTED-001",
  );
  return { kind: "UnitType", tokenId };
}

/** `Self::assocName`, resolved against whichever trait or impl body is open
 * (`HEDGE-NAME-006` when none is). An impl that concretely defines the
 * associated type substitutes straight to it (`validateSelfProjectionInImpl`);
 * an abstract trait `Self` goes through the same trait-set search
 * `paramName::assocName` does. */
function validateSelfProjection(
  ctx: AnalysisContext,
  assocName: string,
  tokenId: number,
): Semantics.Type {
  const self = currentSelfContext(ctx);
  if (self === undefined) {
    emitError(
      ctx,
      "`Self` can only be used inside a trait or impl block",
      tokenId,
      "HEDGE-NAME-006",
    );
    return { kind: "UnitType", tokenId };
  }
  if (self.kind === "Impl") {
    return validateSelfProjectionInImpl(ctx, self, assocName, tokenId);
  }
  return resolveAbstractProjection(ctx, {
    seedTraitNames: [self.traitName],
    projectionBaseName: "Self",
    assocName,
    tokenId,
    notFoundMessage: `cannot find associated type \`${assocName}\` on trait \`${bareTypeName(self.traitName)}\``,
  });
}

/** `Self::assocName` or `paramName::assocName` - a projection. Only ever
 * reached from `validateNamedType` for a real 2-segment path. A base that is
 * neither `Self` nor a bound generic parameter falls through to the same
 * "unsupported qualified path" diagnostic a concrete `Foo::Bar` gets. */
function validateProjectionType(
  ctx: AnalysisContext,
  type: Parser.NamedType,
  tokenId: number,
): Semantics.Type {
  const baseName = type.path.segments[0];
  const assocName = type.path.segments[1];
  assert(
    baseName !== undefined && assocName !== undefined,
    "Projection path missing a segment",
  );

  if (baseName === "Self") {
    return validateSelfProjection(ctx, assocName, tokenId);
  }

  const bounds = isDeclaredGenericParam(ctx, baseName)
    ? declaredGenericParamBounds(ctx, baseName)
    : [];
  if (bounds.length === 0) {
    return emitUnsupportedQualifiedPath(ctx, tokenId);
  }
  return resolveAbstractProjection(ctx, {
    seedTraitNames: bounds,
    projectionBaseName: baseName,
    assocName,
    tokenId,
    notFoundMessage: `cannot find associated type \`${assocName}\` among the trait bounds of \`${baseName}\``,
  });
}

/** Validates each of a struct/enum reference's own type arguments, purely
 * for their diagnostics - `Semantics.StructType`/`EnumType` carry no
 * argument list of their own yet, so nothing here can substitute a struct's
 * declared generic fields against the concrete arguments; this only makes a
 * projection (or any other malformed type) nested inside one, e.g.
 * `Option<Self::Item>`, actually get visited instead of silently skipped. */
function validateTypeArguments(
  ctx: AnalysisContext,
  typeArguments: readonly Parser.Type[],
): void {
  for (const arg of typeArguments) {
    validateSlice1Type(ctx, arg, arg.tokenId);
  }
}

function validateNamedType(
  ctx: AnalysisContext,
  type: Parser.NamedType,
  tokenId: number,
): Semantics.Type {
  if (type.path.segments.length === 2) {
    return validateProjectionType(ctx, type, tokenId);
  }
  if (type.path.segments.length !== 1) {
    emitError(
      ctx,
      "qualified type paths are not supported yet",
      tokenId,
      "HEDGE-UNSUPPORTED-001",
    );
    return { kind: "UnitType", tokenId };
  }
  const name = type.path.segments[0];
  assert(name !== undefined, "Name segment missing");
  if (name === "Self") {
    const self = currentSelfContext(ctx);
    if (self === undefined) {
      emitError(
        ctx,
        "`Self` can only be used inside a trait or impl block",
        tokenId,
        "HEDGE-NAME-006",
      );
      return { kind: "UnitType", tokenId };
    }
    return self.kind === "Impl"
      ? self.targetType
      : {
          kind: "NamedType",
          tokenId,
          path: { absolute: false, segments: ["Self"] },
        };
  }
  if (isDeclaredGenericParam(ctx, name)) {
    if (type.typeArguments.length > 0) {
      emitError(
        ctx,
        `generic type parameter \`${name}\` does not accept type arguments`,
        tokenId,
        "HEDGE-UNSUPPORTED-001",
      );
      return { kind: "UnitType", tokenId };
    }
    return resolveDeclaredGenericParam(ctx, name, tokenId, type.path);
  }
  const prim = namedTypeToPrimitive(name);
  if (isSome(prim)) {
    return prim.value;
  }
  const resolved = lookupStructOrEnumType(ctx, name);
  if (resolved !== undefined) {
    validateTypeArguments(ctx, type.typeArguments);
    return resolved;
  }
  emitError(
    ctx,
    `cannot find type \`${name}\` in this scope`,
    tokenId,
    "HEDGE-NAME-001",
  );
  return { kind: "UnitType", tokenId };
}

function validateSlice1Type(
  ctx: AnalysisContext,
  type: Parser.Type,
  tokenId: number,
): Semantics.Type {
  switch (type.kind) {
    case "NamedType":
      return validateNamedType(ctx, type, tokenId);
    case "UnitType":
      return type;
    case "ReferenceType":
      return {
        kind: "ReferenceType",
        tokenId,
        mutable: type.mutable,
        referent: validateSlice1Type(ctx, type.referent, type.referent.tokenId),
      };
    case "ArrayType": {
      const elementType = validateSlice1Type(
        ctx,
        type.elementType,
        type.elementType.tokenId,
      );
      const length = foldArrayLength(ctx, type.length);
      return isSome(length)
        ? { kind: "ArrayType", elementType, length: length.value }
        : { kind: "UnitType", tokenId };
    }
    case "DynType":
      return validateDynType(ctx, type, tokenId);
    default:
      assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function validateDynType(
  ctx: AnalysisContext,
  type: Parser.DynType,
  tokenId: number,
): Semantics.Type {
  const bareName = type.bound.path.segments.at(-1) ?? "";
  const traitId = lookupTrait(ctx, bareName);
  const registered =
    traitId === undefined ? undefined : ctx.traitRegistry.get(traitId);
  if (registered === undefined || traitId === undefined) {
    const namesSomethingElse =
      isSome(namedTypeToPrimitive(bareName)) ||
      lookupStructOrEnumType(ctx, bareName) !== undefined;
    emitError(
      ctx,
      namesSomethingElse
        ? `\`${bareName}\` is not a trait`
        : `cannot find trait \`${bareName}\` in this scope`,
      tokenId,
      "HEDGE-NAME-001",
    );
    return { kind: "UnitType", tokenId };
  }
  if (isSome(registered.notObjectSafe)) {
    emitError(
      ctx,
      notObjectSafeMessage(bareName, registered.notObjectSafe.value),
      tokenId,
      "HEDGE-TRAIT-008",
    );
    return { kind: "UnitType", tokenId };
  }
  return { kind: "DynType", tokenId, traitId };
}

function notObjectSafeMessage(
  traitName: string,
  offender: SelfArgMethod,
): string {
  const method =
    offender.declaringTrait === traitName
      ? `method \`${offender.methodName}\``
      : `supertrait \`${offender.declaringTrait}\`'s method \`${offender.methodName}\``;
  return `trait \`${traitName}\` cannot be made into a \`dyn\` object: ${method} takes \`Self\` as a non-receiver argument`;
}

/** Maps a resolved declared type to the width const-folding wraps/rounds at; `none()` for a non-numeric type. */
// eslint-disable-next-line complexity -- This is a routing function
function foldWidthOf(type: Semantics.Type): Option<FoldWidth> {
  switch (type.kind) {
    case "PrimitiveI8Type":
      return some({ kind: "signed", bits: 8 });
    case "PrimitiveI16Type":
      return some({ kind: "signed", bits: 16 });
    case "PrimitiveI32Type":
    case "PrimitiveIsizeType":
      return some({ kind: "signed", bits: 32 });
    case "PrimitiveU8Type":
      return some({ kind: "unsigned", bits: 8 });
    case "PrimitiveU16Type":
      return some({ kind: "unsigned", bits: 16 });
    case "PrimitiveU32Type":
    case "PrimitiveUsizeType":
      return some({ kind: "unsigned", bits: 32 });
    case "PrimitiveI64Type":
      return some({ kind: "bigint", signed: true });
    case "PrimitiveU64Type":
      return some({ kind: "bigint", signed: false });
    case "PrimitiveF32Type":
      return some({ kind: "float", bits: 32 });
    case "PrimitiveF64Type":
      return some({ kind: "float", bits: 64 });
    case "PrimitiveBooleanType":
    case "PrimitiveCharType":
    case "PrimitiveStringType":
    case "NamedType":
    case "UnitType":
    case "StructType":
    case "EnumType":
    case "FunctionType":
    case "ReferenceType":
    case "ArrayType":
    case "Projection":
    case "DynType":
      return none();
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function valueMatchesDeclaredType(
  value: Semantics.ConstValue,
  declaredType: Semantics.Type,
): boolean {
  const width = foldWidthOf(declaredType);
  switch (value.kind) {
    case "Int":
      return isSome(width) && width.value.kind !== "float";
    case "Float":
      return isSome(width) && width.value.kind === "float";
    case "Bool":
      return declaredType.kind === "PrimitiveBooleanType";
    case "Char":
      return declaredType.kind === "PrimitiveCharType";
    case "Str":
      return declaredType.kind === "PrimitiveStringType";
    default:
      return assertNever(
        value,
        `Unexpected const value: ${JSON.stringify(value)}`,
      );
  }
}

/**
 * Builds the literal `Semantics.Expression` a const reference is inlined to
 * - a non-pub const has no runtime storage (spec 0008), so every reference
 * site becomes this literal directly rather than a `PathExpression`. Also
 * reused by `jsim.ts` for a `pub const`'s own exported JS value - unlike a
 * reference site, a `pub const` still needs one real runtime binding, since
 * a plain-JS (non-Hedge) consumer importing it has no inlining of its own.
 */
export function constValueToLiteralExpression(
  value: Semantics.ConstValue,
  type: Semantics.Type,
  tokenId: number,
): Semantics.Expression {
  switch (value.kind) {
    case "Int": {
      const negative = value.value < 0n;
      const literal: Semantics.IntLiteral = {
        kind: "IntLiteral",
        tokenId,
        value: (negative ? -value.value : value.value).toString(),
        base: 10,
        suffix: none(),
        type,
      };
      return negative
        ? {
            kind: "UnaryExpression",
            tokenId,
            operator: "Neg",
            operand: literal,
            type,
          }
        : literal;
    }
    case "Float": {
      const negative = value.value < 0 || Object.is(value.value, -0);
      const literal: Semantics.FloatLiteral = {
        kind: "FloatLiteral",
        tokenId,
        value: String(Math.abs(value.value)),
        suffix: none(),
        type,
      };
      return negative
        ? {
            kind: "UnaryExpression",
            tokenId,
            operator: "Neg",
            operand: literal,
            type,
          }
        : literal;
    }
    case "Bool":
      return { kind: "BoolLiteral", tokenId, value: value.value, type };
    case "Char":
      return { kind: "CharLiteral", tokenId, value: value.value, type };
    case "Str":
      return { kind: "StringLiteral", tokenId, value: value.value, type };
    default:
      return assertNever(
        value,
        `Unexpected const value: ${JSON.stringify(value)}`,
      );
  }
}

/** Innermost-to-outermost frame index declaring `name`, or -1 if none does. */
function findConstFrameIndex(ctx: AnalysisContext, name: string): number {
  return frameIndexOf(ctx, name, (frame) => frame.constDecls);
}

/**
 * Innermost frame index where `name` resolves as an ordinary binding
 * (let/param/function/static), or -1. Comparing this against
 * `findConstFrameIndex`'s result tells `analyzeConstReference` whether a
 * closer ordinary binding shadows an outer const of the same name - a
 * const's own name is never `bind()`-ed into `vars`, so without this check
 * a same-named parameter or local `let` would be silently ignored in favor
 * of the const's inlined value. Both indices address the same `frames`
 * stack, so they are directly comparable by construction.
 */
function scopeFrameIndexOf(ctx: AnalysisContext, name: string): number {
  return frameIndexOf(ctx, name, (frame) => frame.vars);
}

function findStaticFrameIndex(ctx: AnalysisContext, name: string): number {
  return frameIndexOf(ctx, name, (frame) => frame.staticTypes);
}

/** The declared type `registerConstsAndStatics` already resolved for a static - avoids re-validating it (and re-diagnosing a bad type) in `analyzeStaticDecl`. */
function resolveStaticType(ctx: AnalysisContext, name: string): Semantics.Type {
  const frameIndex = findStaticFrameIndex(ctx, name);
  assert(
    frameIndex >= 0,
    `resolveStaticType called for undeclared static \`${name}\``,
  );
  const type = ctx.frames[frameIndex]?.staticTypes.get(name);
  assert(
    type !== undefined,
    `resolveStaticType found no type for \`${name}\` in its own frame`,
  );
  return type;
}

/**
 * Resolves a bare-identifier reference inside a const-folded expression to
 * another const's value, a "references a static" rejection, or "undeclared"
 * - cycle-safe via `ctx.constResolving`. Shared by `resolveConstDecl`'s own
 * initializer fold and, later, array-length const-folding for `[T; N]`.
 */
function resolveConstRef(
  ctx: AnalysisContext,
  name: string,
  tokenId: number,
): ConstFoldOutcome {
  if (ctx.constResolving.has(name)) {
    emitError(
      ctx,
      `const \`${name}\` cannot be defined in terms of itself`,
      tokenId,
      "HEDGE-CONST-002",
    );
    return { kind: "AlreadyDiagnosed", tokenId };
  }
  const constFrameIndex = findConstFrameIndex(ctx, name);
  const scopeFrameIndex = scopeFrameIndexOf(ctx, name);
  if (constFrameIndex >= 0 && scopeFrameIndex <= constFrameIndex) {
    const entry = resolveConstDecl(ctx, name);
    return isSome(entry.value)
      ? { kind: "Ok", value: entry.value.value }
      : { kind: "AlreadyDiagnosed", tokenId };
  }
  if (scopeFrameIndex >= 0) {
    // Shadowed by (or resolves only to) an ordinary binding - a function,
    // parameter, or `let` - none of which is usable in a constant
    // expression.
    return { kind: "NotFoldable", tokenId };
  }
  if (findStaticFrameIndex(ctx, name) >= 0) {
    return { kind: "NotFoldable", tokenId };
  }
  return { kind: "Undeclared", tokenId, name };
}

/**
 * Resolves (and memoizes) a const's folded value, in whichever scope frame
 * innermost-shadows `name`. Safe to call in any order - forward references
 * and const-to-const chains resolve recursively via `resolveConstRef`, with
 * `ctx.constResolving` guarding against cycles. Emits exactly one diagnostic
 * for a genuinely broken const, at the point the problem actually is;
 * anything that transitively depends on a broken const inherits
 * `value: none()` silently (no cascade).
 */
function resolveConstDecl(ctx: AnalysisContext, name: string): ConstEntry {
  const frameIndex = findConstFrameIndex(ctx, name);
  assert(
    frameIndex >= 0,
    `resolveConstDecl called for undeclared const \`${name}\``,
  );
  const valueFrame = ctx.frames[frameIndex]?.constValues;
  assert(valueFrame !== undefined, "const value scope frame missing");

  const cached = valueFrame.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const decl = ctx.frames[frameIndex]?.constDecls.get(name);
  assert(
    decl !== undefined,
    `resolveConstDecl found no decl for \`${name}\` in its own frame`,
  );

  // A local const is its own item, not a closure - it doesn't inherit an
  // enclosing function's generics any more than a nested fn/struct/enum
  // does (see genericParamStack's own doc comment).
  pushGenericParams(ctx, []);
  const declaredType = validateSlice1Type(ctx, decl.type, decl.type.tokenId);
  popGenericParams(ctx);
  const width = foldWidthOf(declaredType);
  ctx.constResolving.add(name);
  const outcome = foldConstExpression(
    decl.value,
    width,
    (refName, refTokenId) => resolveConstRef(ctx, refName, refTokenId),
  );
  ctx.constResolving.delete(name);

  let value: Option<Semantics.ConstValue> = none();
  switch (outcome.kind) {
    case "Ok":
      if (valueMatchesDeclaredType(outcome.value, declaredType)) {
        value = some(outcome.value);
      } else {
        emitError(
          ctx,
          `const \`${name}\`'s initializer does not match its declared type ${describeType(declaredType)}`,
          decl.value.tokenId,
          "HEDGE-TYPE-001",
        );
      }
      break;
    case "NotFoldable":
      emitError(
        ctx,
        `const \`${name}\`'s initializer must be a compile-time constant expression`,
        outcome.tokenId,
        "HEDGE-CONST-001",
      );
      break;
    case "DivideByZero":
      emitError(
        ctx,
        "attempt to divide by zero in a constant expression",
        outcome.tokenId,
        "HEDGE-CONST-003",
      );
      break;
    case "InvalidShift":
      emitError(
        ctx,
        "shift amount must be between 0 and 63 in a constant expression",
        outcome.tokenId,
        "HEDGE-CONST-003",
      );
      break;
    case "Undeclared":
      emitError(
        ctx,
        `Cannot find name "${outcome.name}" in this scope.`,
        outcome.tokenId,
        "HEDGE-NAME-001",
      );
      break;
    case "AlreadyDiagnosed":
      // The failure was already reported where it actually happened (the
      // cycle's own reference, or a broken dependency) - no new diagnostic.
      break;
    default:
      assertNever(
        outcome,
        `Unexpected fold outcome: ${JSON.stringify(outcome)}`,
      );
  }

  const entry: ConstEntry = { declaredType, value };
  valueFrame.set(name, entry);
  return entry;
}

/**
 * If `path` is a single-segment reference to a declared const, resolves and
 * inlines it - `none()` for anything else (a static, a function, an
 * undeclared name, a multi-segment path), so the caller falls back to
 * ordinary `analyzePath` scope resolution.
 */
function analyzeConstReference(
  ctx: AnalysisContext,
  path: Parser.PathExpression,
): Option<Semantics.Expression> {
  if (path.path.absolute || path.path.segments.length !== 1) {
    return none();
  }
  const name = path.path.segments[0];
  if (name === undefined) {
    return none();
  }
  const constFrameIndex = findConstFrameIndex(ctx, name);
  if (constFrameIndex < 0) {
    return none();
  }
  const scopeFrameIndex = scopeFrameIndexOf(ctx, name);
  if (scopeFrameIndex > constFrameIndex) {
    // A closer let/param/function shadows the const - fall back to
    // ordinary scope resolution instead of inlining the const's value.
    return none();
  }
  const entry = resolveConstDecl(ctx, name);
  return isSome(entry.value)
    ? some(
        constValueToLiteralExpression(
          entry.value.value,
          entry.declaredType,
          path.tokenId,
        ),
      )
    : some({ ...path, type: { kind: "UnitType", tokenId: path.tokenId } });
}

/**
 * Whether `name` resolves (innermost-first, matching `resolve()`'s own
 * search order) to a static's binding specifically, not a same-named local
 * variable shadowing it. `vars` and `staticTypes` live in the same frame, so
 * the frame where `name` is first found in `vars` has a `staticTypes` entry
 * if and only if that binding actually came from a static rather than a
 * shadowing `let`/param.
 */
function resolvedNameIsStatic(ctx: AnalysisContext, name: string): boolean {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const frame = ctx.frames[i];
    if (frame?.vars.has(name) === true) {
      return frame.staticTypes.has(name);
    }
  }
  return false;
}

/**
 * If `path` is a single-segment reference to a static (and not shadowed by
 * a same-named local), rewrites it into a zero-argument call to the
 * static's own name - a static has no plain-value JS binding (it's a
 * lazily-initialized accessor function, see `codegen/generator.ts`), so
 * every reference site needs to *call* it. Reuses the ordinary
 * `CallExpression` lowering/codegen path entirely; no new AST node needed.
 * `none()` for anything else, so the caller falls back to `analyzePath`.
 */
function analyzeStaticReference(
  ctx: AnalysisContext,
  path: Parser.PathExpression,
): Option<Semantics.Expression> {
  if (path.path.absolute || path.path.segments.length !== 1) {
    return none();
  }
  const name = path.path.segments[0];
  if (name === undefined || !resolvedNameIsStatic(ctx, name)) {
    return none();
  }
  const resolved = resolve(ctx, name);
  if (!isSome(resolved)) {
    return none();
  }
  const type = resolved.value.type;
  const callee: Semantics.PathExpression = {
    kind: "PathExpression",
    tokenId: path.tokenId,
    path: path.path,
    type,
  };
  return some({
    kind: "CallExpression",
    tokenId: path.tokenId,
    callee,
    arguments: [],
    type,
  });
}

/**
 * A type's scope-qualified name. The declaring identifier's own `tokenId`
 * disambiguates two same-named declarations - a purely structural identity
 * assigned at parse time, so it distinguishes shadowed declarations at any
 * depth *and* same-depth siblings alike (frame depth alone conflated two
 * sibling blocks each declaring their own same-named local type, since both
 * see the same `ctx.frames.length` at declaration time).
 */
function scopedTypeName(nameTokenId: number, name: string): string {
  return `scoped(${nameTokenId})::${name}`;
}

/** Warns when a new struct/enum declaration shadows an outer one already
 * visible in an enclosing frame - matching `HEDGE-LINT-002`'s existing
 * precedent for a shadowed generic parameter. `relatedSpans` names the
 * shadowed declaration and any impl already registered against the
 * shadowing one, since that combination is exactly what makes shadowing
 * easy to get wrong (a value of the shadowing type carries a different
 * trait impl set than a same-named value from the outer scope would). */
function warnIfShadowsOuterDeclaration(
  ctx: AnalysisContext,
  kindLabel: "struct" | "enum",
  name: string,
  tokenId: number,
  ownIdentity: string,
  outerTokenId: number | undefined,
): void {
  if (outerTokenId === undefined) return;
  const relatedSpans = [
    ...relatedSpanAt(ctx, outerTokenId, "shadowed declaration"),
    ...ctx.implRegistry
      .filter((impl) => impl.targetTypeName === ownIdentity)
      .flatMap((impl) =>
        relatedSpanAt(ctx, impl.tokenId, "impl for this declaration"),
      ),
  ];
  emitWarning(
    ctx,
    `${kindLabel} \`${name}\` shadows an outer declaration of the same name`,
    tokenId,
    "HEDGE-LINT-004",
    relatedSpans,
  );
}

/**
 * Names first, then bodies. Resolving a type reference needs only the
 * declaration's own `type`, which its name alone determines, so the split is
 * what lets types be declared in any order and refer to each other.
 */
function declareStructName(
  ctx: AnalysisContext,
  frame: ScopeFrame,
  item: Parser.StructDecl,
): void {
  if (frame.types.has(item.name.text)) {
    emitError(
      ctx,
      `struct \`${item.name.text}\` is defined more than once`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
    return;
  }
  const type: Semantics.Type = {
    kind: "StructType",
    name: scopedTypeName(item.name.tokenId, item.name.text),
  };
  warnIfShadowsOuterDeclaration(
    ctx,
    "struct",
    item.name.text,
    item.name.tokenId,
    type.name,
    lookupStruct(ctx, item.name.text)?.name.tokenId,
  );
  frame.types.set(item.name.text, {
    ...item,
    name: { ...item.name, type },
    generics: genericParamNames(item.generics),
    attributes: [],
    body: { kind: "Unit" },
    type,
  });
}

function declareEnumName(
  ctx: AnalysisContext,
  frame: ScopeFrame,
  item: Parser.EnumDecl,
): void {
  if (frame.enums.has(item.name.text)) {
    emitError(
      ctx,
      `enum \`${item.name.text}\` is defined more than once`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
    return;
  }
  const type: Semantics.Type = {
    kind: "EnumType",
    name: scopedTypeName(item.name.tokenId, item.name.text),
  };
  warnIfShadowsOuterDeclaration(
    ctx,
    "enum",
    item.name.text,
    item.name.tokenId,
    type.name,
    lookupEnum(ctx, item.name.text)?.name.tokenId,
  );
  frame.enums.set(item.name.text, {
    ...item,
    name: { ...item.name, type },
    generics: genericParamNames(item.generics),
    variants: [],
    attributes: [],
    type,
  });
}

function declareTraitName(
  ctx: AnalysisContext,
  frame: ScopeFrame,
  item: Parser.TraitDecl,
): void {
  if (frame.traits.has(item.name.text)) {
    emitError(
      ctx,
      `trait \`${item.name.text}\` is defined more than once`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
    return;
  }
  frame.traits.set(item.name.text, item.name.tokenId);
}

function registerTypeDecls(
  ctx: AnalysisContext,
  items: readonly (Parser.Item | Parser.Statement)[],
): void {
  const frame = currentFrame(ctx);
  for (const item of items) {
    if (item.kind === "Struct") {
      declareStructName(ctx, frame, item);
    } else if (item.kind === "Enum") {
      declareEnumName(ctx, frame, item);
    } else if (item.kind === "Trait") {
      declareTraitName(ctx, frame, item);
    }
  }
  // A declaration that lost the duplicate check is skipped rather than
  // overwriting the one that won it; `tokenId` distinguishes them, since
  // they share a name.
  for (const item of items) {
    if (item.kind === "Struct") {
      if (frame.types.get(item.name.text)?.name.tokenId === item.name.tokenId) {
        frame.types.set(item.name.text, analyzeStruct(ctx, item));
      }
    } else if (item.kind === "Enum") {
      if (frame.enums.get(item.name.text)?.name.tokenId === item.name.tokenId) {
        frame.enums.set(item.name.text, analyzeEnum(ctx, item));
      }
    }
  }
}

/** Every `type Name;` (no value) declared directly in an item list - a
 * trait's own required associated types. Shared with `providedAssociatedTypes`
 * below, which instead wants the `some(value)` half of the same filter. */
function requiredAssociatedTypeNames(
  items: readonly Parser.Item[],
): readonly string[] {
  return items.flatMap((decl) =>
    decl.kind === "TypeAlias" && !isSome(decl.value) ? [decl.name.text] : [],
  );
}

/** Extracts an `impl`'s trait/target identity from the parse tree, without
 * emitting any diagnostic - duplicate/coherence checking happens once, in
 * `registerImpls`, against the whole program's impl set. `resolvedMethods`/
 * `associatedTypeDefs` are left empty here - real resolution happens only in
 * `analyzeImplDecl`, once this impl reaches its own analysis pass with a
 * real `SelfContext` to resolve against. */
function buildImplDecl(item: Parser.ImplDecl): Semantics.ImplDecl {
  const targetTypeName: Option<string> =
    item.type.kind === "NamedType"
      ? some(item.type.path.segments.at(-1) ?? "")
      : none();
  return {
    kind: "Impl",
    tokenId: item.tokenId,
    traitRef: mapSome(item.traitRef, (traitRef) => ({
      name: traitRef.path.segments.at(-1) ?? "",
      tokenId: traitRef.tokenId,
    })),
    targetTypeName,
    isBlanket:
      isSome(targetTypeName) &&
      genericParamNames(item.generics).includes(targetTypeName.value),
    blanketBounds: isSome(targetTypeName)
      ? (genericParamBoundNames(item.generics, item.whereClause).get(
          targetTypeName.value,
        ) ?? [])
      : [],
    providedMethods: item.items
      .filter((decl): decl is Parser.FunctionDef => decl.kind === "Function")
      .map((decl) => decl.signature.name.text),
    providedAssociatedTypes: item.items.flatMap((decl) =>
      decl.kind === "TypeAlias" && isSome(decl.value) ? [decl.name.text] : [],
    ),
    resolvedMethods: [],
    associatedTypeDefs: new Map(),
  };
}

/** Extracts a `trait`'s name, its own supertrait names, its required
 * (bodiless) vs. default (bodied) method names, and its own directly
 * declared associated-type names from the parse tree - a `LifetimeTraitBound`
 * supertrait contributes nothing, since it names no trait. `methods`' own
 * `params`/`returnType` are left as unit placeholders here - real resolution
 * happens only in `analyzeTraitDecl`, once this trait reaches its own
 * analysis pass with a real `SelfContext` to resolve `Self`/`Self::Assoc`
 * against. */
function buildTraitDecl(item: Parser.TraitDecl): Semantics.TraitDecl {
  const unitType: Semantics.Type = { kind: "UnitType", tokenId: item.tokenId };
  return {
    kind: "Trait",
    tokenId: item.tokenId,
    name: item.name.text,
    traitId: scopedTypeName(item.name.tokenId, item.name.text),
    supertraits: item.supertraits
      .filter(
        (bound): bound is Parser.PathTraitBound =>
          bound.kind === "PathTraitBound",
      )
      .map((bound) => bound.path.segments.at(-1) ?? ""),
    methods: item.items.flatMap((decl): readonly Semantics.TraitMethod[] => {
      if (decl.kind === "FunctionSignature") {
        return [
          {
            name: decl.name.text,
            isDefault: false,
            params: [],
            returnType: unitType,
          },
        ];
      }
      if (decl.kind === "Function") {
        return [
          {
            name: decl.signature.name.text,
            isDefault: true,
            params: [],
            returnType: unitType,
          },
        ];
      }
      return [];
    }),
    associatedTypes: requiredAssociatedTypeNames(item.items),
  };
}

/** Combines an enclosing trait/impl's own generics with one of its own
 * methods' own - a method's type parameters need to be visible alongside
 * the enclosing item's while resolving that one method's signature, but
 * `genericParamStack` only ever consults its top frame (a deliberate
 * scoping choice elsewhere - a nested item doesn't inherit an enclosing
 * one's generics), so pushing the item's own generics once and the
 * method's own separately would just have the second push shadow the
 * first. One merged push, scoped to a single method's own resolution,
 * makes both visible together instead. */
function mergedGenericScope(
  outerGenerics: readonly Parser.GenericParam[],
  outerWhereClause: Option<Parser.WhereClause>,
  innerGenerics: readonly Parser.GenericParam[],
  innerWhereClause: Option<Parser.WhereClause>,
): {
  generics: readonly Parser.GenericParam[];
  whereClause: Option<Parser.WhereClause>;
} {
  const predicates = [
    ...(isSome(outerWhereClause) ? outerWhereClause.value.predicates : []),
    ...(isSome(innerWhereClause) ? innerWhereClause.value.predicates : []),
  ];
  return {
    generics: [...outerGenerics, ...innerGenerics],
    whereClause:
      predicates.length > 0
        ? some({ kind: "WhereClause", predicates })
        : none(),
  };
}

/** Shared by `resolveTraitMethodSignature`/`resolveImplMethodSignature` -
 * both need exactly this pair, resolved the same way (against the merged
 * outer-item/method generic scope), differing only in which other fields
 * their own `Semantics` shape carries alongside it. */
function resolveMethodSignatureTypes(
  ctx: AnalysisContext,
  outerGenerics: readonly Parser.GenericParam[],
  outerWhereClause: Option<Parser.WhereClause>,
  signature: Parser.FunctionSignature,
): { params: readonly Semantics.Type[]; returnType: Semantics.Type } {
  const merged = mergedGenericScope(
    outerGenerics,
    outerWhereClause,
    signature.generics,
    signature.whereClause,
  );
  pushGenericParams(ctx, merged.generics, merged.whereClause);
  const result: {
    params: readonly Semantics.Type[];
    returnType: Semantics.Type;
  } = {
    params: signature.params.map((p) =>
      validateSlice1Type(ctx, p.type, p.type.tokenId),
    ),
    returnType: isSome(signature.returnType)
      ? validateSlice1Type(
          ctx,
          signature.returnType.value,
          signature.returnType.value.tokenId,
        )
      : { kind: "UnitType", tokenId: signature.tokenId },
  };
  popGenericParams(ctx);
  return result;
}

function resolveTraitMethodSignature(
  ctx: AnalysisContext,
  outerGenerics: readonly Parser.GenericParam[],
  outerWhereClause: Option<Parser.WhereClause>,
  signature: Parser.FunctionSignature,
  isDefault: boolean,
): Semantics.TraitMethod {
  return {
    name: signature.name.text,
    isDefault,
    ...resolveMethodSignatureTypes(
      ctx,
      outerGenerics,
      outerWhereClause,
      signature,
    ),
  };
}

/** The real, diagnostic-emitting counterpart to `buildTraitDecl` - resolves
 * every method's own `params`/`returnType` for real, with `Self`/
 * `Self::Assoc` resolving against this trait's own abstract `SelfContext`,
 * and each method's own generics merged alongside the trait's own (see
 * `mergedGenericScope`). */
function analyzeTraitDecl(
  ctx: AnalysisContext,
  item: Parser.TraitDecl,
): Semantics.TraitDecl {
  const shallow = buildTraitDecl(item);
  pushSelfContext(ctx, {
    kind: "Trait",
    traitName: shallow.traitId,
    associatedTypes: shallow.associatedTypes,
  });
  const methods = item.items.flatMap(
    (decl): readonly Semantics.TraitMethod[] => {
      if (decl.kind === "FunctionSignature") {
        return [
          resolveTraitMethodSignature(
            ctx,
            item.generics,
            item.whereClause,
            decl,
            false,
          ),
        ];
      }
      if (decl.kind === "Function") {
        return [
          resolveTraitMethodSignature(
            ctx,
            item.generics,
            item.whereClause,
            decl.signature,
            true,
          ),
        ];
      }
      return [];
    },
  );
  popSelfContext(ctx);
  return { ...shallow, methods };
}

/** The impl's own concrete `Self` type - a blanket impl's target is its own
 * type parameter, represented the same abstract way a declared generic
 * parameter is (see `ProjectionType`'s own doc comment); a concrete impl's
 * target resolves through ordinary struct/enum lookup, the same path
 * `validateNamedType` itself would take for the same bare name. */
function resolveImplSelfTargetType(
  ctx: AnalysisContext,
  shallow: Semantics.ImplDecl,
): Semantics.Type {
  const bareTargetTypeName = shallow.targetTypeName;
  if (!isSome(bareTargetTypeName)) {
    return { kind: "UnitType", tokenId: shallow.tokenId };
  }
  if (shallow.isBlanket) {
    return {
      kind: "NamedType",
      tokenId: shallow.tokenId,
      path: { absolute: false, segments: [bareTargetTypeName.value] },
    };
  }
  return (
    lookupStructOrEnumType(ctx, bareTargetTypeName.value) ?? {
      kind: "UnitType",
      tokenId: shallow.tokenId,
    }
  );
}

function resolveImplMethodSignature(
  ctx: AnalysisContext,
  outerGenerics: readonly Parser.GenericParam[],
  outerWhereClause: Option<Parser.WhereClause>,
  signature: Parser.FunctionSignature,
): Semantics.ImplMethod {
  return {
    name: signature.name.text,
    ...resolveMethodSignatureTypes(
      ctx,
      outerGenerics,
      outerWhereClause,
      signature,
    ),
  };
}

/** The real, diagnostic-emitting counterpart to `buildImplDecl` - resolves
 * each `type Name = Value;` definition first (against a concrete `Self` but
 * no associated types yet, since one definition referencing a sibling isn't
 * supported), then resolves every method's own signature against the now-
 * complete associated-type map, so `Self::Item` inside a method substitutes
 * directly to the concrete definition rather than staying a `ProjectionType`
 * - each method's own generics merged alongside the impl's own (see
 * `mergedGenericScope`). */
function analyzeImplDecl(
  ctx: AnalysisContext,
  item: Parser.ImplDecl,
): Semantics.ImplDecl {
  const shallow = buildImplDecl(item);
  const targetType = resolveImplSelfTargetType(ctx, shallow);
  const traitName = mapSome(
    shallow.traitRef,
    (t) => lookupTrait(ctx, t.name) ?? t.name,
  );

  pushGenericParams(ctx, item.generics, item.whereClause);
  pushSelfContext(ctx, {
    kind: "Impl",
    targetType,
    traitName,
    associatedTypes: new Map(),
  });
  const declaredNames = isSome(traitName)
    ? declaredAssociatedTypeNames(ctx, traitName.value)
    : undefined;
  const associatedTypeDefs = new Map<string, Semantics.Type>();
  for (const decl of item.items) {
    if (decl.kind !== "TypeAlias" || !isSome(decl.value)) continue;
    const resolvedValue = validateSlice1Type(
      ctx,
      decl.value.value,
      decl.value.value.tokenId,
    );
    if (
      declaredNames !== undefined &&
      !declaredNames.includes(decl.name.text)
    ) {
      continue;
    }
    associatedTypeDefs.set(decl.name.text, resolvedValue);
  }
  popSelfContext(ctx);
  popGenericParams(ctx);

  pushSelfContext(ctx, {
    kind: "Impl",
    targetType,
    traitName,
    associatedTypes: associatedTypeDefs,
  });
  const resolvedMethods = item.items.flatMap(
    (decl): readonly Semantics.ImplMethod[] =>
      decl.kind === "Function"
        ? [
            resolveImplMethodSignature(
              ctx,
              item.generics,
              item.whereClause,
              decl.signature,
            ),
          ]
        : [],
  );
  popSelfContext(ctx);

  return { ...shallow, resolvedMethods, associatedTypeDefs };
}

/**
 * Two impls of the same trait overlap when either is blanket (a blanket
 * impl claims the trait for every type, regardless of its own bound - the
 * bound is a well-formedness constraint on the impl body, not something
 * overlap-checking consults) or when they target the exact same concrete
 * type.
 */
function implsOverlap(a: RegisteredImpl, b: RegisteredImpl): boolean {
  return a.isBlanket || b.isBlanket || a.targetTypeName === b.targetTypeName;
}

function implOverlapMessage(
  traitId: string,
  incoming: RegisteredImpl,
  existing: RegisteredImpl,
): string {
  const traitName = bareTypeName(traitId);
  if (incoming.isBlanket && existing.isBlanket) {
    return `conflicting implementations of trait \`${traitName}\``;
  }
  if (incoming.isBlanket || existing.isBlanket) {
    const concrete = incoming.isBlanket ? existing : incoming;
    return `conflicting implementations of trait \`${traitName}\` for type \`${bareTypeName(concrete.targetTypeName)}\``;
  }
  return `trait \`${traitName}\` is already implemented for type \`${bareTypeName(incoming.targetTypeName)}\``;
}

/**
 * Resolves `type: traitName` to the witness that satisfies it, or `none()`
 * if nothing does. A still-abstract type (the enclosing declaration's own
 * generic parameter) resolves against that declaration's own bound list,
 * since no concrete impl can exist for a type that isn't concrete yet -
 * codegen forwards the enclosing function's own received witness for it
 * instead of looking one up here.
 */
function resolveTraitBound(
  ctx: AnalysisContext,
  type: Semantics.Type,
  traitName: string,
): Option<WitnessRef> {
  if (type.kind === "NamedType" && type.path.segments.length === 1) {
    const paramName = type.path.segments[0];
    if (paramName !== undefined && isDeclaredGenericParam(ctx, paramName)) {
      return boundsImplyTrait(
        ctx,
        declaredGenericParamBounds(ctx, paramName),
        traitName,
      )
        ? some({
            kind: "Forwarded",
            traitName: bareTypeName(traitName),
            paramName,
          })
        : none();
    }
  }
  return resolveTraitBoundForTypeName(ctx, typeIdentity(type), traitName);
}

/**
 * Whether `requiredTrait` is satisfied by `declaredBounds`, directly or
 * transitively through a supertrait chain - `trait Ord: Eq` means a
 * directly-declared `T: Ord` bound already implies `T: Eq`, so an abstract
 * parameter's own bound list alone isn't enough to check against.
 */
function boundsImplyTrait(
  ctx: AnalysisContext,
  declaredBounds: readonly string[],
  requiredTrait: string,
  visiting: ReadonlySet<string> = new Set(),
): boolean {
  return declaredBounds.some((bound) => {
    if (bound === requiredTrait) return true;
    if (visiting.has(bound)) return false;
    const supertraits = ctx.traitRegistry.get(bound)?.supertraits ?? [];
    return boundsImplyTrait(
      ctx,
      supertraits,
      requiredTrait,
      new Set(visiting).add(bound),
    );
  });
}

/**
 * A concrete type's own real identity for registry lookup - the full
 * scoped name for a struct/enum (matching what `resolveStructOrEnumIdentity`
 * independently produces for the same declaration, so a call site's
 * resolved argument type and an impl's own resolved target always compare
 * equal when they mean the same declaration), or the same as `describeType`
 * for anything else, which carries no shadowing ambiguity to begin with.
 */
function typeIdentity(type: Semantics.Type): string {
  return type.kind === "StructType" || type.kind === "EnumType"
    ? type.name
    : describeType(type);
}

/**
 * Finds the registered impl satisfying `typeName: traitName` - a concrete
 * registered impl, or a blanket impl whose own bound is satisfied (checked
 * recursively, since a blanket impl's own `A` in `impl<T: A> B for T` may
 * itself be satisfied only through another blanket impl). `typeName` is
 * always concrete here, so this never revisits `resolveTraitBound`'s
 * abstract-parameter case. Shared by `resolveTraitBoundForTypeName` (builds
 * a witness from the result) and `resolveAssociatedTypeViaSupertrait`
 * (reads the impl's own associated-type definitions instead).
 */
function findRegisteredImpl(
  ctx: AnalysisContext,
  typeName: string,
  traitName: string,
  visiting: ReadonlySet<string> = new Set(),
): RegisteredImpl | undefined {
  const key = `${typeName}::${traitName}`;
  if (visiting.has(key)) return undefined;
  const nextVisiting = new Set(visiting).add(key);
  return ctx.implRegistry.find((impl) => {
    if (impl.traitName !== traitName) return false;
    if (!impl.isBlanket) return impl.targetTypeName === typeName;
    return impl.blanketBounds.every(
      (bound) =>
        findRegisteredImpl(ctx, typeName, bound, nextVisiting) !== undefined,
    );
  });
}

function resolveTraitBoundForTypeName(
  ctx: AnalysisContext,
  typeName: string,
  traitName: string,
): Option<WitnessRef> {
  const impl = findRegisteredImpl(ctx, typeName, traitName);
  if (impl === undefined) return none();
  return some({
    kind: "Impl",
    traitName: bareTypeName(traitName),
    typeName: bareTypeName(typeName),
    implTokenId: impl.tokenId,
    methods: witnessMethods(ctx, impl),
  });
}

/** `Self::assocName` inside an impl, when the impl's own definitions don't
 * have it directly - searches `traitName`'s own supertraits for the one
 * that actually declares `assocName`, then reads *that* trait's own
 * separately registered impl for the same `targetType` (not this impl -
 * a supertrait's associated type is defined wherever the supertrait itself
 * is implemented, never required to be repeated in a subtrait's own impl
 * body, the same way a supertrait's methods aren't). `undefined` covers
 * every way this can fail to resolve (no declaring trait, ambiguous, or no
 * such impl registered) - the caller's existing "not found" error already
 * covers all of them without needing to tell them apart. */
function resolveAssociatedTypeViaSupertrait(
  ctx: AnalysisContext,
  traitName: string,
  targetType: Semantics.Type,
  assocName: string,
): Semantics.Type | undefined {
  const result = resolveAssociatedTypeTrait(ctx, [traitName], assocName);
  if (result.kind !== "Found") return undefined;
  const impl = findRegisteredImpl(
    ctx,
    typeIdentity(targetType),
    result.traitName,
  );
  return impl?.associatedTypeDefs.get(assocName);
}

/** An impl's own witness method list: every one of its trait's methods, in
 * the trait's own interleaved declaration order (source order, not grouped
 * by required-vs-default), each marked `"impl"` when this impl provides or
 * overrides it and `"default"` when it falls back to the trait's own
 * default body. */
function witnessMethods(
  ctx: AnalysisContext,
  impl: RegisteredImpl,
): readonly WitnessMethod[] {
  const trait = ctx.traitRegistry.get(impl.traitName);
  if (trait === undefined) return [];
  return trait.methods.map((method): WitnessMethod => ({
    name: method.name,
    source:
      !method.isDefault || impl.providedMethods.includes(method.name)
        ? "impl"
        : "default",
  }));
}

function traitBoundNotSatisfiedMessage(
  typeName: string,
  traitName: string,
): string {
  return `the trait bound \`${bareTypeName(typeName)}: ${bareTypeName(traitName)}\` is not satisfied`;
}

/**
 * Every struct/enum/trait name visible at one point in the program, each
 * mapped to its declaring identifier's own `tokenId` - a purely structural,
 * shadowing-aware resolution computed directly from the AST's own shape
 * (mirroring `registerTypeDecls`'s per-block pre-registration and
 * `ScopeFrame`'s innermost-shadows-outer lookup), with no dependency on
 * live `ctx.frames` state. This is what lets an impl's target type and
 * trait reference resolve to the *specific* declaration in scope - two
 * shadowed same-named local structs never collide, since each keeps its
 * own tokenId all the way through.
 */
interface StructuralScope {
  readonly structs: ReadonlyMap<string, number>;
  readonly enums: ReadonlyMap<string, number>;
  readonly traits: ReadonlyMap<string, number>;
}

const EMPTY_STRUCTURAL_SCOPE: StructuralScope = {
  structs: new Map(),
  enums: new Map(),
  traits: new Map(),
};

/** Extends `scope` with every struct/enum/trait declared directly in
 * `items` (not recursing into nested bodies) - shadowing whatever the
 * enclosing scope already bound for the same name, the same way a real
 * nested block's own type declarations shadow an outer one. A same-name
 * duplicate is reported by `declareStructName`/`declareEnumName`/
 * `declareTraitName` in the live-frame pass, not here. */
function extendStructuralScope(
  scope: StructuralScope,
  items: readonly (Parser.Item | Parser.Statement)[],
): StructuralScope {
  const structs = new Map(scope.structs);
  const enums = new Map(scope.enums);
  const traits = new Map(scope.traits);
  for (const item of items) {
    if (item.kind === "Struct") structs.set(item.name.text, item.name.tokenId);
    else if (item.kind === "Enum") enums.set(item.name.text, item.name.tokenId);
    else if (item.kind === "Trait")
      traits.set(item.name.text, item.name.tokenId);
  }
  return { structs, enums, traits };
}

/** One item found anywhere in the program by `collectAllItems`, alongside
 * how deeply nested it is (0 = a top-level program item) and the
 * `StructuralScope` visible at that exact point. Impl/trait registration
 * needs every declaration regardless of nesting - a value can flow out of
 * the scope it was constructed in and still need its trait impl resolved
 * far from where either was declared. */
interface DepthedItem {
  readonly item: Parser.Item | Parser.Statement;
  readonly depth: number;
  readonly scope: StructuralScope;
}

/**
 * Walks the whole program looking for every item, including one nested
 * inside a function body, an `impl`/`trait` body, or an `if`/`match`/
 * `while` block - not just top-level items, since `impl`/`trait` are valid
 * statements and take program-wide effect regardless of where they're
 * declared. Does not descend into an arbitrary expression position beyond
 * these (a call argument's own block-valued sub-expression, for instance) -
 * a known, narrow gap, matching `parser/lifetime-elision.ts`'s own
 * similarly-scoped walk.
 */
function collectAllItems(
  items: readonly (Parser.Item | Parser.Statement)[],
  depth: number,
  enclosingScope: StructuralScope = EMPTY_STRUCTURAL_SCOPE,
): readonly DepthedItem[] {
  const scope = extendStructuralScope(enclosingScope, items);
  return collectItemsWithScope(items, depth, scope);
}

/** Walks `items` against an already-extended `scope`, shared by
 * `collectAllItems` (which extends the scope itself) and `collectBlockItems`
 * (which extends it once and reuses the result for the trailing expression
 * too - extending twice over the same statements would double-report a
 * same-scope duplicate trait). */
function collectItemsWithScope(
  items: readonly (Parser.Item | Parser.Statement)[],
  depth: number,
  scope: StructuralScope,
): readonly DepthedItem[] {
  return items.flatMap((item): readonly DepthedItem[] => {
    const self: DepthedItem = { item, depth, scope };
    if (item.kind === "Function") {
      return [self, ...collectBlockItems(item.body, depth + 1, scope)];
    }
    if (item.kind === "Impl" || item.kind === "Trait") {
      return [self, ...collectAllItems(item.items, depth + 1, scope)];
    }
    if (item.kind === "ExpressionStatement") {
      return [self, ...collectExpressionItems(item.expression, depth, scope)];
    }
    if (item.kind === "LetStatement" && isSome(item.initializer)) {
      return [
        self,
        ...collectExpressionItems(item.initializer.value, depth, scope),
      ];
    }
    return [self];
  });
}

function collectBlockItems(
  block: Parser.Block,
  depth: number,
  enclosingScope: StructuralScope,
): readonly DepthedItem[] {
  const scope = extendStructuralScope(enclosingScope, block.statements);
  const inner = collectItemsWithScope(block.statements, depth, scope);
  return isSome(block.trailingExpression)
    ? [
        ...inner,
        ...collectExpressionItems(block.trailingExpression.value, depth, scope),
      ]
    : inner;
}

function collectExpressionItems(
  expr: Parser.Expression,
  depth: number,
  scope: StructuralScope,
): readonly DepthedItem[] {
  switch (expr.kind) {
    case "Block":
      return collectBlockItems(expr, depth + 1, scope);
    case "IfExpression": {
      const thenItems = collectBlockItems(expr.thenBranch, depth + 1, scope);
      if (!isSome(expr.elseBranch)) return thenItems;
      const elseBranch = expr.elseBranch.value;
      return [
        ...thenItems,
        ...(elseBranch.kind === "IfExpression"
          ? collectExpressionItems(elseBranch, depth, scope)
          : collectBlockItems(elseBranch, depth + 1, scope)),
      ];
    }
    case "WhileExpression":
      return collectBlockItems(expr.body, depth + 1, scope);
    case "MatchExpression":
      return expr.arms.flatMap((arm) =>
        collectExpressionItems(arm.body, depth + 1, scope),
      );
    default:
      return [];
  }
}

/** True when `Self` names the trait's own implementing type here (`Self`,
 * not `Self::Assoc`), at any depth a `dyn` argument type can nest one. */
function typeMentionsSelf(type: Parser.Type): boolean {
  switch (type.kind) {
    case "NamedType":
      return (
        (type.path.segments.length === 1 && type.path.segments[0] === "Self") ||
        type.typeArguments.some(typeMentionsSelf)
      );
    case "ReferenceType":
      return typeMentionsSelf(type.referent);
    case "ArrayType":
      return typeMentionsSelf(type.elementType);
    case "DynType":
      return type.bound.typeArguments.some(typeMentionsSelf);
    case "UnitType":
      return false;
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

/** The trait's own first method taking `Self` in a non-receiver argument
 * position - `none()` when the trait's own methods are all object-safe
 * (supertraits are folded in later by `propagateSupertraitObjectSafety`). A
 * `Receiver` carries no type of its own, so every `Self` reachable through a
 * method's `params` is necessarily non-receiver. */
function ownSelfArgMethod(item: Parser.TraitDecl): Option<SelfArgMethod> {
  for (const member of item.items) {
    if (member.kind !== "Function" && member.kind !== "FunctionSignature") {
      continue;
    }
    const signature = member.kind === "Function" ? member.signature : member;
    if (signature.params.some((param) => typeMentionsSelf(param.type))) {
      return some({
        methodName: signature.name.text,
        declaringTrait: item.name.text,
      });
    }
  }
  return none();
}

/** After every trait is registered with its own object-safety verdict, a
 * trait with an object-safe body still isn't object-safe if any trait in its
 * supertrait chain isn't. */
function propagateSupertraitObjectSafety(ctx: AnalysisContext): void {
  for (const [name, trait] of ctx.traitRegistry) {
    if (isSome(trait.notObjectSafe)) continue;
    const viaSupertrait = firstNonObjectSafeSupertrait(
      ctx,
      trait.supertraits,
      new Set([name]),
    );
    if (isSome(viaSupertrait)) {
      ctx.traitRegistry.set(name, { ...trait, notObjectSafe: viaSupertrait });
    }
  }
}

function firstNonObjectSafeSupertrait(
  ctx: AnalysisContext,
  supertraitNames: readonly string[],
  visiting: ReadonlySet<string>,
): Option<SelfArgMethod> {
  for (const supertraitName of supertraitNames) {
    if (visiting.has(supertraitName)) continue;
    const supertrait = ctx.traitRegistry.get(supertraitName);
    if (supertrait === undefined) continue;
    if (isSome(supertrait.notObjectSafe)) return supertrait.notObjectSafe;
    const viaChain = firstNonObjectSafeSupertrait(
      ctx,
      supertrait.supertraits,
      new Set(visiting).add(supertraitName),
    );
    if (isSome(viaChain)) return viaChain;
  }
  return none();
}

/**
 * Registers every `trait`'s own name and supertraits into `ctx.traitRegistry`
 * first, then validates every supertrait reference in a second pass over
 * only the traits just registered - so `trait A: B {}` declared before
 * `trait B {}` still resolves (both are registered before either's
 * supertraits are checked), while a genuinely undeclared supertrait is
 * still rejected. Supertrait object safety is folded in last, once every
 * trait's own verdict is known.
 */
function registerTraits(
  ctx: AnalysisContext,
  allItems: readonly DepthedItem[],
): void {
  const traitItems: Parser.TraitDecl[] = [];
  for (const { item, scope } of allItems) {
    if (item.kind !== "Trait") continue;
    const decl = buildTraitDecl(item);
    ctx.traitRegistry.set(decl.traitId, {
      supertraits: decl.supertraits.map((name) =>
        resolveTraitIdentity(name, scope),
      ),
      methods: decl.methods,
      associatedTypes: decl.associatedTypes,
      notObjectSafe: ownSelfArgMethod(item),
    });
    traitItems.push(item);
  }
  for (const item of traitItems) {
    validateTraitBoundNames(ctx, item.supertraits);
  }
  propagateSupertraitObjectSafety(ctx);
}

/**
 * Warns when a non-top-level `impl` still takes program-wide effect despite
 * living in a nested scope - the common, unsurprising case (both the impl
 * and its target type are local to the same nested scope, so nothing
 * outside that scope could construct a value needing the impl anyway) is
 * deliberately not flagged: `targetTypeName` only appears here when it was
 * itself declared at the program's top level, so a value of that type can
 * always reach code outside the impl's own declaring scope. A blanket impl
 * always warns when nested, since it can affect any external type
 * satisfying its bound, not just one named locally.
 */
function warnIfSurprisinglyVisible(
  ctx: AnalysisContext,
  item: Parser.ImplDecl,
  incoming: RegisteredImpl,
  topLevelStructEnumNames: ReadonlySet<string>,
): void {
  if (incoming.isBlanket) {
    emitWarning(
      ctx,
      `blanket impl of trait \`${bareTypeName(incoming.traitName)}\` takes effect everywhere in the program, not just this scope`,
      item.tokenId,
      "HEDGE-LINT-003",
    );
    return;
  }
  if (!topLevelStructEnumNames.has(incoming.targetTypeName)) return;
  emitWarning(
    ctx,
    `impl of trait \`${bareTypeName(incoming.traitName)}\` for \`${bareTypeName(incoming.targetTypeName)}\` takes effect everywhere in the program, not just this scope`,
    item.tokenId,
    "HEDGE-LINT-003",
  );
}

/** Every top-level struct/enum's own real identity - what
 * `warnIfSurprisinglyVisible` checks a nested impl's resolved target type
 * against. */
function collectTopLevelStructEnumNames(
  allItems: readonly DepthedItem[],
): ReadonlySet<string> {
  return new Set(
    allItems.flatMap(({ item, depth }) =>
      depth === 0 && (item.kind === "Struct" || item.kind === "Enum")
        ? [scopedTypeName(item.name.tokenId, item.name.text)]
        : [],
    ),
  );
}

/**
 * Resolves a bare struct/enum name against `scope`'s own shadowing-aware
 * bindings to the real, collision-free identity `scopedTypeName` will
 * independently produce for that exact declaration - `none()` when the
 * name isn't a struct/enum in scope at all (a blanket impl's own type
 * parameter, or a genuinely unresolved name).
 */
function resolveStructOrEnumIdentity(
  name: string,
  scope: StructuralScope,
): Option<string> {
  const structTokenId = scope.structs.get(name);
  if (structTokenId !== undefined) {
    return some(scopedTypeName(structTokenId, name));
  }
  const enumTokenId = scope.enums.get(name);
  if (enumTokenId !== undefined) {
    return some(scopedTypeName(enumTokenId, name));
  }
  return none();
}

/** `resolveStructOrEnumIdentity`'s trait counterpart, for the prepass sites
 * that resolve a trait reference against a `StructuralScope` rather than
 * live frames - falls back to the bare name so a genuinely undeclared
 * reference still fails the `traitRegistry` lookup and gets reported. */
function resolveTraitIdentity(name: string, scope: StructuralScope): string {
  const tokenId = scope.traits.get(name);
  return tokenId === undefined ? name : scopedTypeName(tokenId, name);
}

/** Strips a struct/enum's real scoped identity back to its bare,
 * user-facing name for a diagnostic message - the same stripping
 * `describeType`'s own `StructType`/`EnumType` case applies. */
function bareTypeName(identity: string): string {
  return identity.split("::").pop() ?? identity;
}

function reportMissingRequiredMethods(
  ctx: AnalysisContext,
  item: Parser.ImplDecl,
  traitName: string,
  targetTypeName: string,
  providedMethods: readonly string[],
): void {
  const methods = ctx.traitRegistry.get(traitName)?.methods ?? [];
  for (const method of methods) {
    if (method.isDefault || providedMethods.includes(method.name)) continue;
    emitError(
      ctx,
      `impl of trait \`${bareTypeName(traitName)}\` for \`${bareTypeName(targetTypeName)}\` is missing method \`${method.name}\``,
      item.tokenId,
      "HEDGE-TRAIT-003",
    );
  }
}

/** Mirrors `reportMissingRequiredMethods` for a trait's own required
 * associated types (`type Name;`, no value) - every required one absent
 * from this impl's own `type Name = Value;` definitions is a separate
 * diagnostic. */
function reportMissingAssociatedTypes(
  ctx: AnalysisContext,
  item: Parser.ImplDecl,
  traitName: string,
  targetTypeName: string,
  providedAssociatedTypes: readonly string[],
): void {
  const required = ctx.traitRegistry.get(traitName)?.associatedTypes ?? [];
  for (const name of required) {
    if (providedAssociatedTypes.includes(name)) continue;
    emitError(
      ctx,
      `impl of trait \`${bareTypeName(traitName)}\` for \`${bareTypeName(targetTypeName)}\` is missing associated type \`${name}\``,
      item.tokenId,
      "HEDGE-TRAIT-004",
    );
  }
}

/** `traitName`'s own directly declared associated-type names (empty for an
 * unregistered or associated-type-free trait) - shared by the completeness
 * check above and the two places that build an impl's own resolved
 * `associatedTypeDefs` map, so a definition the trait doesn't declare is
 * excluded from both consistently, not just flagged in one of them. */
function declaredAssociatedTypeNames(
  ctx: AnalysisContext,
  traitName: string,
): readonly string[] {
  return ctx.traitRegistry.get(traitName)?.associatedTypes ?? [];
}

/** The mirror image of `reportMissingAssociatedTypes`: a `type Name =
 * Value;` this impl defines that the trait doesn't declare at all (as
 * opposed to omitting one the trait requires) - reported once here, in the
 * same prepass, rather than in `analyzeImplDecl`'s own real pass, so it
 * isn't double-reported once per pass. */
function reportExtraAssociatedTypes(
  ctx: AnalysisContext,
  item: Parser.ImplDecl,
  traitName: string,
  targetTypeName: string,
  providedAssociatedTypes: readonly string[],
): void {
  const declared = declaredAssociatedTypeNames(ctx, traitName);
  for (const name of providedAssociatedTypes) {
    if (declared.includes(name)) continue;
    emitError(
      ctx,
      `impl of trait \`${bareTypeName(traitName)}\` for \`${bareTypeName(targetTypeName)}\` defines associated type \`${name}\`, which trait \`${bareTypeName(traitName)}\` does not declare`,
      item.tokenId,
      "HEDGE-TRAIT-007",
    );
  }
}

/** Registers one `impl`'s coherence/completeness/visibility facts, or
 * `undefined` for a not-yet-handled shape (no trait, or a target that
 * doesn't resolve to any struct/enum in scope). Split out of `registerImpls`
 * to keep that loop itself simple. A concrete (non-blanket) target resolves
 * through `scope` to its real, shadowing-aware identity - the bare source
 * spelling alone would conflate two same-named structs in different
 * scopes. A blanket impl's target is its own type parameter name (`T`),
 * never a struct/enum, so it keeps the bare spelling unchanged. */
function registerOneImpl(
  ctx: AnalysisContext,
  item: Parser.ImplDecl,
  depth: number,
  scope: StructuralScope,
  topLevelStructEnumNames: ReadonlySet<string>,
): RegisteredImpl | undefined {
  const decl = buildImplDecl(item);
  validateGenericParamBounds(ctx, item.generics, item.whereClause);
  const traitRef = decl.traitRef;
  const bareTargetTypeName = decl.targetTypeName;
  if (!isSome(traitRef) || !isSome(bareTargetTypeName)) return undefined;
  const targetTypeName = decl.isBlanket
    ? some(bareTargetTypeName.value)
    : resolveStructOrEnumIdentity(bareTargetTypeName.value, scope);
  if (!isSome(targetTypeName)) return undefined;
  const bareTraitName = traitRef.value.name;
  const traitName = resolveTraitIdentity(bareTraitName, scope);
  if (!ctx.traitRegistry.has(traitName)) {
    emitError(
      ctx,
      `cannot find trait \`${bareTraitName}\` in this scope`,
      traitRef.value.tokenId,
      "HEDGE-NAME-001",
    );
    return undefined;
  }
  const declaredNames = declaredAssociatedTypeNames(ctx, traitName);
  pushGenericParams(ctx, item.generics, item.whereClause);
  const associatedTypeDefs = new Map<string, Semantics.Type>();
  for (const alias of item.items) {
    if (alias.kind !== "TypeAlias" || !isSome(alias.value)) continue;
    if (!declaredNames.includes(alias.name.text)) continue;
    associatedTypeDefs.set(
      alias.name.text,
      resolveSlice1Type(ctx, alias.value.value, alias.value.value.tokenId),
    );
  }
  popGenericParams(ctx);
  const incoming: RegisteredImpl = {
    traitName,
    targetTypeName: targetTypeName.value,
    isBlanket: decl.isBlanket,
    blanketBounds: decl.blanketBounds.map((bound) =>
      resolveTraitIdentity(bound, scope),
    ),
    providedMethods: decl.providedMethods,
    associatedTypeDefs,
    tokenId: item.tokenId,
  };
  const existing = ctx.implRegistry.find(
    (registered) =>
      registered.traitName === traitName && implsOverlap(registered, incoming),
  );
  if (existing !== undefined) {
    emitError(
      ctx,
      implOverlapMessage(traitName, incoming, existing),
      item.tokenId,
      "HEDGE-TRAIT-001",
      relatedSpanAt(ctx, existing.tokenId, "first implemented here"),
    );
  }
  ctx.implRegistry.push(incoming);
  if (depth > 0) {
    warnIfSurprisinglyVisible(ctx, item, incoming, topLevelStructEnumNames);
  }
  reportMissingRequiredMethods(
    ctx,
    item,
    traitName,
    incoming.targetTypeName,
    decl.providedMethods,
  );
  reportMissingAssociatedTypes(
    ctx,
    item,
    traitName,
    incoming.targetTypeName,
    decl.providedAssociatedTypes,
  );
  reportExtraAssociatedTypes(
    ctx,
    item,
    traitName,
    incoming.targetTypeName,
    decl.providedAssociatedTypes,
  );
  return incoming;
}

/** A concrete impl missing one of its trait's own supertrait
 * implementations - deferred until every impl is registered, so
 * declaration order within the program doesn't matter. */
function checkSupertraitCompleteness(
  ctx: AnalysisContext,
  concreteImpls: readonly RegisteredImpl[],
): void {
  for (const impl of concreteImpls) {
    for (const supertrait of ctx.traitRegistry.get(impl.traitName)
      ?.supertraits ?? []) {
      if (
        isSome(
          resolveTraitBoundForTypeName(ctx, impl.targetTypeName, supertrait),
        )
      ) {
        continue;
      }
      emitError(
        ctx,
        traitBoundNotSatisfiedMessage(
          bareTypeName(impl.targetTypeName),
          supertrait,
        ),
        impl.tokenId,
        "HEDGE-TRAIT-002",
      );
    }
  }
}

/**
 * Registers every trait impl into `ctx.implRegistry`, flat and
 * program-wide, reports two overlapping impls of the same trait as a
 * coherence error, and reports a concrete impl missing one of its trait's
 * own supertrait implementations. Supertrait completeness is not checked
 * for a blanket impl: proving its own type parameter's bound implies the
 * supertrait needs impl-definition-time bound implication checking this
 * ticket doesn't attempt.
 */
function registerImpls(
  ctx: AnalysisContext,
  allItems: readonly DepthedItem[],
): void {
  const topLevelStructEnumNames = collectTopLevelStructEnumNames(allItems);
  const concreteImpls: RegisteredImpl[] = [];
  for (const { item, depth, scope } of allItems) {
    if (item.kind !== "Impl") continue;
    const incoming = registerOneImpl(
      ctx,
      item,
      depth,
      scope,
      topLevelStructEnumNames,
    );
    if (incoming !== undefined && !incoming.isBlanket) {
      concreteImpls.push(incoming);
    }
  }
  checkSupertraitCompleteness(ctx, concreteImpls);
}

/**
 * Registers every `Const`/`Static` declared directly in `items` into the
 * *current* (innermost) const/static scope frame - called once per scope,
 * right after that scope's frame is pushed (top-level `analyze()` for frame
 * 0, `analyzeBlock` for every nested one) and before any sequential
 * statement analysis, so forward/chained references within the same scope
 * resolve regardless of textual order. A name already registered in this
 * same frame is a redefinition diagnostic; a name only present in an outer
 * frame is shadowing, which is allowed.
 */
function registerConstsAndStatics(
  ctx: AnalysisContext,
  items: readonly Parser.Item[],
): void {
  const frame = currentFrame(ctx);
  const constFrame = frame.constDecls;
  // Pre-scanned up front, independent of registration order: a static gets
  // `bind()`-registered into `currentScope` as this loop runs (below), so a
  // same-frame const/static name collision would otherwise be order-
  // dependent - caught (mislabeled "collides with an existing function
  // name") only when the static happens to be processed first, missed
  // entirely when the const comes first. Checking against this frame's full
  // const-name set, decided before either kind is registered, reports
  // exactly one correctly-labeled diagnostic regardless of file order.
  const constNamesInFrame = new Set(
    items.filter((item) => item.kind === "Const").map((item) => item.name.text),
  );

  for (const item of items) {
    if (item.kind === "Const") {
      registerConst(ctx, item);
    } else if (item.kind === "Static") {
      registerStatic(ctx, constNamesInFrame, item);
    }
  }
  // Eagerly resolve every const in this frame, not just referenced ones - an
  // unused const can still be malformed (cycle, non-foldable initializer,
  // undeclared reference), and this also guarantees every forward/chained
  // reference within the frame is resolvable before the sequential
  // statement walk needs it.
  for (const name of constFrame.keys()) {
    resolveConstDecl(ctx, name);
  }
}

function registerConst(ctx: AnalysisContext, item: Parser.ConstDecl): void {
  const frame = currentFrame(ctx);
  const constFrame = frame.constDecls;
  const staticFrame = frame.staticTypes;
  const currentScope = frame.vars;

  if (constFrame.has(item.name.text)) {
    emitError(
      ctx,
      `const \`${item.name.text}\` is defined more than once`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
  } else {
    // A same-frame static collision is reported once, from the static
    // branch below (via `constNamesInFrame`) - skip the function check
    // here for a name that's actually a static, so a static processed
    // earlier in this same loop (and thus already `bind()`-ed into
    // `currentScope`) doesn't produce a second, mislabeled diagnostic.
    if (!staticFrame.has(item.name.text) && currentScope.has(item.name.text)) {
      // A reference to this name would be ambiguous: `analyzeExpression`
      // always tries `analyzeConstReference` first (see its
      // "PathExpression" case), so `X()` against a same-named function
      // would inline the const and try to call its literal value
      // instead of calling the function - a real miscompile, not just
      // shadowing. Still registers below so the const is still usable
      // under its own name; the diagnostic already blocks codegen.
      emitError(
        ctx,
        `const \`${item.name.text}\` collides with an existing function name`,
        item.name.tokenId,
        "HEDGE-NAME-002",
      );
    }
    constFrame.set(item.name.text, item);
  }
}

function registerStatic(
  ctx: AnalysisContext,
  constNamesInFrame: ReadonlySet<string>,
  item: Parser.StaticDecl,
): void {
  const frame = currentFrame(ctx);
  const staticFrame = frame.staticTypes;
  const currentScope = frame.vars;

  if (staticFrame.has(item.name.text)) {
    emitError(
      ctx,
      `static \`${item.name.text}\` is defined more than once`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
    return;
  }
  if (constNamesInFrame.has(item.name.text)) {
    // A static lowers to a real accessor function of its own name
    // (see jsim.ts's StaticDecl lowering), but a reference to this
    // name always tries the const first (`analyzeConstReference`),
    // making the static unreachable/ambiguous either way.
    emitError(
      ctx,
      `static \`${item.name.text}\` collides with a const of the same name`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
  } else if (currentScope.has(item.name.text)) {
    // A static lowers to a real top-level accessor function of its
    // own name (see jsim.ts's StaticDecl lowering) - sharing a name
    // with an existing function would collide at codegen, not just
    // shadow. Still registers below so `analyzeStaticDecl` has an
    // entry to resolve; the diagnostic already blocks codegen.
    emitError(
      ctx,
      `static \`${item.name.text}\` collides with an existing function name`,
      item.name.tokenId,
      "HEDGE-NAME-002",
    );
  }
  if (isSome(item.visibility)) {
    emitError(
      ctx,
      "static items cannot be pub yet",
      item.tokenId,
      "HEDGE-ITEM-001",
    );
  }
  // A local static is its own item, not a closure - see the matching
  // barrier around a local const's own type resolution.
  pushGenericParams(ctx, []);
  const declaredType = validateSlice1Type(ctx, item.type, item.type.tokenId);
  popGenericParams(ctx);
  staticFrame.set(item.name.text, declaredType);
  bind(ctx, item.name.text, { type: declaredType, mutable: false });
}

function analyzeStaticDecl(
  ctx: AnalysisContext,
  item: Parser.StaticDecl,
): Semantics.StaticDecl {
  const declaredType = resolveStaticType(ctx, item.name.text);
  const analyzedValue = analyzeExpression(ctx, item.value);
  const { expr: value, mismatch } = reconcileExpressionType(
    ctx,
    analyzedValue,
    declaredType,
    item.value.tokenId,
  );
  if (mismatch) {
    emitError(
      ctx,
      "type mismatch: static's declared type does not match its initializer",
      item.value.tokenId,
      "HEDGE-TYPE-001",
    );
  }
  if (value.kind === "IntLiteral") {
    checkPosLiteralRange(ctx, value, declaredType);
  }
  return {
    kind: "Static",
    tokenId: item.tokenId,
    visibility: item.visibility,
    name: { ...item.name, type: declaredType },
    value,
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    type: declaredType,
  };
}

/**
 * Builds the `Semantics.ConstDecl` for an already-registered-and-resolved
 * `Const` item - shared by top-level `analyzeItem` and block-local
 * `analyzeStatement`, since `registerConstsAndStatics` has already done the
 * actual folding for both by the time either one is reached.
 */
function analyzeConstStatement(
  ctx: AnalysisContext,
  item: Parser.ConstDecl,
): Semantics.ConstDecl {
  const entry = resolveConstDecl(ctx, item.name.text);
  const resolved = entry.value;
  return {
    kind: "Const",
    tokenId: item.tokenId,
    visibility: item.visibility,
    name: { ...item.name, type: entry.declaredType },
    value: isSome(resolved) ? resolved.value : { kind: "Int", value: 0n },
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    type: entry.declaredType,
  };
}

const TOP_LEVEL_ITEM_RESTRICTION_MESSAGE =
  "only function, struct, enum, const, and static declarations are allowed at the top level";

function analyzeEnum(
  ctx: AnalysisContext,
  item: Parser.EnumDecl,
): Semantics.EnumDecl {
  const scopedName = scopedTypeName(item.name.tokenId, item.name.text);
  const enumType: Semantics.Type = { kind: "EnumType", name: scopedName };
  const seenVariantNames = new Set<string>();
  for (const variant of item.variants) {
    if (seenVariantNames.has(variant.name.text)) {
      emitError(
        ctx,
        `variant \`${variant.name.text}\` is defined more than once`,
        variant.name.tokenId,
        "HEDGE-NAME-002",
      );
    }
    seenVariantNames.add(variant.name.text);
  }
  checkUnusedGenericParams(
    ctx,
    item.generics,
    enumVariantUsedNames(item.variants),
  );
  pushGenericParams(ctx, item.generics);
  const variants = item.variants.map((variant) =>
    analyzeVariant(ctx, variant, enumType),
  );
  popGenericParams(ctx);
  return {
    ...item,
    name: { ...item.name, type: enumType },
    generics: genericParamNames(item.generics),
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    variants,
    type: enumType,
  };
}

function analyzeVariant(
  ctx: AnalysisContext,
  variant: Parser.Variant,
  enumType: Semantics.Type,
): Semantics.Variant {
  return {
    ...variant,
    name: { ...variant.name, type: enumType },
    attributes: variant.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    body: mapSome(variant.body, (body) => analyzeVariantBody(ctx, body)),
    type: enumType,
  };
}

function analyzeVariantBody(
  ctx: AnalysisContext,
  body: Parser.NamedFieldsBody | Parser.TupleFieldsBody,
): Semantics.NamedFieldsBody | Semantics.TupleFieldsBody {
  switch (body.kind) {
    case "NamedFields":
      return {
        ...body,
        fields: body.fields.map(
          (field: Parser.StructField): Semantics.StructField => {
            const fieldType = validateSlice1Type(
              ctx,
              field.type,
              field.type.tokenId,
            );
            return {
              ...field,
              name: analyzeIdentifier(ctx, field.name, fieldType),
              attributes: field.attributes.map((attr) =>
                analyzeAttribute(ctx, attr),
              ),
              type: fieldType,
            };
          },
        ),
      };
    case "TupleFields":
      return {
        ...body,
        fields: body.fields.map(
          (field: Parser.TupleField): Semantics.TupleField => ({
            ...field,
            attributes: field.attributes.map((attr) =>
              analyzeAttribute(ctx, attr),
            ),
            type: validateSlice1Type(ctx, field.type, field.type.tokenId),
          }),
        ),
      };
    default:
      assertNever(body, `Unexpected AST node: ${JSON.stringify(body)}`);
  }
}

const WHILE_NOT_YET_SUPPORTED_MESSAGE =
  "`while` expressions are not yet supported by semantic analysis";

/** Placeholder for an `Expression` variant with no `Semantics` counterpart
 * yet - same "parser accepts it, semantics doesn't yet" pattern as
 * `analyzeEnumPlaceholder`, at expression rather than item
 * granularity. Reuses the zero-element `TupleExpression` shape, which is
 * already in {@link AMBIGUOUS_UNIT_EXPR_KINDS}'s error-recovery bucket, so no
 * new `Semantics.Expression` kind - and no new bucket entry - is needed. */
function analyzeExpressionPlaceholder(
  ctx: AnalysisContext,
  tokenId: number,
  message: string,
): Semantics.Expression {
  emitError(ctx, message, tokenId, "HEDGE-UNSUPPORTED-001");
  return {
    kind: "TupleExpression",
    tokenId,
    elements: [],
    type: { kind: "UnitType", tokenId },
  };
}

function analyzeLiteralValue(
  ctx: AnalysisContext,
  literal:
    | Parser.StringLiteral
    | Parser.IntLiteral
    | Parser.FloatLiteral
    | Parser.CharLiteral
    | Parser.BoolLiteral,
):
  | Semantics.StringLiteral
  | Semantics.IntLiteral
  | Semantics.FloatLiteral
  | Semantics.CharLiteral
  | Semantics.BoolLiteral {
  switch (literal.kind) {
    case "StringLiteral":
      return analyzeStringLiteral(ctx, literal);
    case "IntLiteral":
      return analyzeIntLiteral(ctx, literal);
    case "FloatLiteral":
      return analyzeFloatLiteral(ctx, literal);
    case "CharLiteral":
      return analyzeCharLiteral(ctx, literal);
    case "BoolLiteral":
      return analyzeBoolLiteral(ctx, literal);
    default:
      return assertNever(
        literal,
        `Unexpected literal: ${JSON.stringify(literal)}`,
      );
  }
}

// TuplePattern/SlicePattern (dynamic-length)/an `@`-subpattern binding stay
// out of scope entirely, in match, `let`, and parameter position alike
// (struct, tuple-struct and fixed-length-slice patterns are supported,
// but not these). The message deliberately doesn't name a specific position -
// `analyzePattern` is shared by all three, so a position-specific wording
// would be wrong two-thirds of the time.
const PATTERN_KIND_NOT_YET_SUPPORTED_MESSAGE =
  "this pattern kind is not yet supported";

/** Substitutes a placeholder `WildcardPattern` rather than propagating the
 * original (unsupported) kind - deliberately, so a guardrail-rejected arm
 * still counts as an exhaustiveness catch-all instead of also tripping a
 * separate, redundant "non-exhaustive" diagnostic on top of the guardrail
 * one (the same cascade-avoidance shape as `analyzeExpressionPlaceholder`
 * elsewhere in this file). */
function analyzePatternGuardrail(
  ctx: AnalysisContext,
  pattern: Parser.Pattern,
  scrutineeType: Semantics.Type,
): Semantics.WildcardPattern {
  emitError(
    ctx,
    PATTERN_KIND_NOT_YET_SUPPORTED_MESSAGE,
    pattern.tokenId,
    "HEDGE-UNSUPPORTED-001",
  );
  return {
    kind: "WildcardPattern",
    tokenId: pattern.tokenId,
    type: scrutineeType,
  };
}

type PatternLiteral =
  | Semantics.StringLiteral
  | Semantics.IntLiteral
  | Semantics.FloatLiteral
  | Semantics.CharLiteral
  | Semantics.BoolLiteral;

/**
 * An unsuffixed integer literal in pattern position adopts the scrutinee's
 * type, matching spec 0010's rule for value position - without it
 * `match x { 1 => ... }` against a `u8` would compare an `i32`.
 */
function coercePatternLiteral(
  literal: PatternLiteral,
  scrutineeType: Semantics.Type,
): PatternLiteral {
  return literal.kind === "IntLiteral" &&
    !isSome(literal.suffix) &&
    isIntegerType(scrutineeType)
    ? { ...literal, type: scrutineeType }
    : literal;
}

/**
 * A literal or range pattern only ever matches values of its own type, so a
 * mismatch here can never match and is rejected rather than compiled into a
 * comparison that is statically false.
 *
 * A `UnitType` scrutinee is skipped: pattern position has no expression to
 * hand `isAmbiguousUnitExpr`, and the placeholder a failed scrutinee
 * analysis produces is far more common than a genuine `match ()`.
 */
function checkPatternLiteralType(
  ctx: AnalysisContext,
  literalType: Semantics.Type,
  scrutineeType: Semantics.Type,
  tokenId: number,
): void {
  if (scrutineeType.kind === "UnitType") return;
  if (typesEqual(literalType, scrutineeType)) return;
  emitError(
    ctx,
    `expected \`${describeType(scrutineeType)}\`, found \`${describeType(literalType)}\``,
    tokenId,
    "HEDGE-TYPE-001",
  );
}

/** Signed value of a range bound, or `undefined` for a non-integer bound. */
function rangeBoundValue(
  bound: Semantics.RangePatternBound,
): bigint | undefined {
  if (bound.literal.kind !== "IntLiteral") return undefined;
  const magnitude = intLiteralValue(bound.literal);
  return bound.negative ? -magnitude : magnitude;
}

type PatternBindingMode = "owned" | "shared" | "mut";

/** Derives the default binding mode + the "effective" (already-dereferenced)
 * type every pattern position should see, from a scrutinee's own resolved
 * type (spec 0016): `match x` binds by value/move, `match &x` binds by
 * shared reference, `match &mut x` binds by mutable reference - and that
 * default applies uniformly to every binding the pattern contains (not just
 * a top-level one), overridable per-binding by an explicit `&`/`&mut` sigil
 * (see `effectiveBindingType`). Called once per match/`let`/parameter at the
 * pattern-analysis entry point (`analyzeMatchExpression`,
 * `analyzeLetOrParamPattern`); `analyzePattern` and everything it resolves
 * against (`resolveEnumDecl`, `resolveStructDecl`, ...) only ever sees the
 * already-unwrapped `effectiveType` from here on, so those never need their
 * own reference-unwrapping logic. Only one layer of `ReferenceType` is
 * peeled off - a reference to a reference isn't real syntax yet (no nested
 * reference types anywhere in the type system), so this doesn't loop. */
function defaultBindingModeForScrutinee(scrutineeType: Semantics.Type): {
  readonly mode: PatternBindingMode;
  readonly effectiveType: Semantics.Type;
} {
  if (scrutineeType.kind === "ReferenceType") {
    return {
      mode: scrutineeType.mutable ? "mut" : "shared",
      effectiveType: scrutineeType.referent,
    };
  }
  return { mode: "owned", effectiveType: scrutineeType };
}

/** The type + local-mutability a single `BindingPattern`/shorthand-field
 * binding gets, combining `defaultMode` (inherited from the scrutinee
 * unless overridden) with the binding's own sigils. An explicit `byRef`
 * (`&`/`&mut`) always overrides the mode outright, ignoring `defaultMode`
 * entirely - the spec's own "borrowing one field of an owned scrutinee
 * while moving another" example. Without `byRef`, `mutable` never changes
 * mode - a plain `mut name` still inherits whatever the scrutinee's default
 * says, only marking the resulting local slot as reassignable - mirroring
 * how `mut` and `ref`/`ref mut` are independent modifiers in Rust's own
 * match ergonomics (there's no fifth sigil combination for "mutably
 * rebindable `&mut` borrow" - `&mut name`'s own `mutable` bit is entirely
 * consumed by "this is a mutable borrow", not a separate local-slot
 * concern). */
function effectiveBindingType(
  fieldType: Semantics.Type,
  defaultMode: PatternBindingMode,
  byRef: boolean,
  mutable: boolean,
  tokenId: number,
): { readonly type: Semantics.Type; readonly localMutable: boolean } {
  const mode: PatternBindingMode = byRef
    ? mutable
      ? "mut"
      : "shared"
    : defaultMode;
  const type: Semantics.Type =
    mode === "owned"
      ? fieldType
      : {
          kind: "ReferenceType",
          tokenId,
          mutable: mode === "mut",
          referent: fieldType,
        };
  return { type, localMutable: byRef ? false : mutable };
}

/**
 * Whether a `&mut` binding-mode override (`x: &mut bx`, or a bare `&mut
 * name`) is legal at this point in a pattern. `defaultMode === "shared"`
 * rejects it unconditionally - capability comes from the reference already
 * being crossed (spec 0005's rule for `&mut` through a `Deref` of a shared
 * reference), regardless of `rootMutable`. `defaultMode === "mut"` always
 * allows it (an `&mut` scrutinee's own chain permits further `&mut`
 * sub-borrows). `defaultMode === "owned"` defers to `rootMutable` - whether
 * the scrutinee/initializer's own root place is mutable (from
 * `placeMutabilityViolation`), or a `mut`-marked ancestor struct/tuple-struct
 * pattern stood in for it.
 */
function checkMutOverrideLegality(
  ctx: AnalysisContext,
  name: string,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
  tokenId: number,
): void {
  if (defaultMode === "shared") {
    emitError(
      ctx,
      `cannot bind \`${name}\` as \`&mut\` through a shared reference`,
      tokenId,
      "HEDGE-PATTERN-007",
    );
    return;
  }
  if (defaultMode === "owned" && !rootMutable) {
    emitError(
      ctx,
      `cannot bind \`${name}\` as \`&mut\` because the underlying place is not mutable`,
      tokenId,
      "HEDGE-PATTERN-007",
    );
  }
}

/** `none()` if `scrutineeType` isn't an enum, or names an enum this context
 * never registered (an unresolved/erroneous scrutinee type) - callers treat
 * both the same way, falling back to the generic pattern-kind guardrail.
 * Only ever called with an already-dereferenced `effectiveType`
 * (`defaultBindingModeForScrutinee`) - never needs its own reference
 * unwrapping. */
function resolveEnumDecl(
  ctx: AnalysisContext,
  scrutineeType: Semantics.Type,
): Option<Semantics.EnumDecl> {
  if (scrutineeType.kind !== "EnumType") return none();
  const name = scrutineeType.name.split("::").pop() ?? scrutineeType.name;
  const decl = lookupEnum(ctx, name);
  return decl === undefined ? none() : some(decl);
}

function lastPathSegment(path: Parser.Path): string | undefined {
  return path.segments.at(-1);
}

/** `none()` if `scrutineeType` isn't a plain (non-enum) `StructType`, or names
 * a struct this context never registered - callers treat both the same way,
 * falling back to enum resolution or the generic pattern-kind guardrail.
 * Mirrors `resolveEnumDecl` structurally, but a struct pattern has no variant
 * layer to delegate its own name-check to, so `resolveTupleStructForPattern`/
 * `resolveStructForPattern` (below) must separately verify the pattern's own
 * path names this exact struct, not just any struct sharing its field
 * shape. */
function resolveStructDecl(
  ctx: AnalysisContext,
  scrutineeType: Semantics.Type,
): Option<Semantics.StructDecl> {
  if (scrutineeType.kind !== "StructType") return none();
  const name = scrutineeType.name.split("::").pop() ?? scrutineeType.name;
  const decl = lookupStruct(ctx, name);
  return decl === undefined ? none() : some(decl);
}

interface ResolvedTupleVariant {
  readonly fields: readonly Semantics.TupleField[];
}

interface ResolvedStructVariant {
  readonly fields: readonly Semantics.StructField[];
}

// A qualified path in enum-scrutinee position is genuinely supported syntax
// now, so a wrong variant name/shape here gets its own real diagnostic
// rather than falling back to `analyzePatternGuardrail`'s generic one.
function resolveTupleVariantForPattern(
  ctx: AnalysisContext,
  pattern: Parser.TupleStructPattern,
  scrutineeType: Semantics.Type,
): Option<ResolvedTupleVariant> {
  const enumDecl = resolveEnumDecl(ctx, scrutineeType);
  if (!isSome(enumDecl)) return none();
  const variantName = lastPathSegment(pattern.path);
  const variant = enumDecl.value.variants.find(
    (v) => v.name.text === variantName,
  );
  if (variant === undefined) {
    emitError(
      ctx,
      `no variant \`${variantName}\` on enum \`${describeType(scrutineeType)}\``,
      pattern.tokenId,
      "HEDGE-NAME-004",
    );
    return none();
  }
  if (!isSome(variant.body) || variant.body.value.kind !== "TupleFields") {
    emitError(
      ctx,
      `variant \`${variantName}\` is not a tuple variant`,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return none();
  }
  return some({ fields: variant.body.value.fields });
}

function resolveStructVariantForPattern(
  ctx: AnalysisContext,
  pattern: Parser.StructPattern,
  scrutineeType: Semantics.Type,
): Option<ResolvedStructVariant> {
  const enumDecl = resolveEnumDecl(ctx, scrutineeType);
  if (!isSome(enumDecl)) return none();
  const variantName = lastPathSegment(pattern.path);
  const variant = enumDecl.value.variants.find(
    (v) => v.name.text === variantName,
  );
  if (variant === undefined) {
    emitError(
      ctx,
      `no variant \`${variantName}\` on enum \`${describeType(scrutineeType)}\``,
      pattern.tokenId,
      "HEDGE-NAME-004",
    );
    return none();
  }
  if (!isSome(variant.body) || variant.body.value.kind !== "NamedFields") {
    emitError(
      ctx,
      `variant \`${variantName}\` is not a struct variant`,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return none();
  }
  return some({ fields: variant.body.value.fields });
}

interface ResolvedPatternFields<F> {
  readonly fields: readonly F[];
  /** Diagnostic-facing descriptor - `` variant `Move` `` or `` struct `Point` ``
   * - so the arity/field-name errors below read naturally for either
   * source. */
  readonly label: string;
  /** `true` when the resolver already emitted its own diagnostic (wrong
   * struct name, wrong shape) - `fields` is an empty error-recovery
   * placeholder in this case, not a genuine zero-field struct, so the
   * caller must skip its own arity/field-name diagnostics (they'd just be
   * redundant noise on top of the one already emitted) while still binding
   * every name the pattern mentions against the placeholder, so a
   * reference to one of those names in the arm body doesn't cascade into a
   * further "cannot find name" error. */
  readonly alreadyErrored: boolean;
}

/** Plain-struct counterpart to `resolveTupleVariantForPattern` - only
 * reachable when `scrutineeType` isn't an enum (the enum resolver already
 * ran first and returned `none()`). Unlike an enum variant, a struct has no
 * name-disambiguating layer of its own, so the pattern's path must be
 * checked directly against the struct named by `scrutineeType` itself
 * (never trusting the pattern's own path as a lookup key) - otherwise a
 * pattern naming an unrelated, differently-typed struct that merely shares
 * a field shape would silently "resolve". */
function resolveTupleStructForPattern(
  ctx: AnalysisContext,
  pattern: Parser.TupleStructPattern,
  scrutineeType: Semantics.Type,
): Option<ResolvedPatternFields<Semantics.TupleField>> {
  const structDecl = resolveStructDecl(ctx, scrutineeType);
  if (!isSome(structDecl)) return none();
  const patternName = lastPathSegment(pattern.path);
  const label = `struct \`${patternName}\``;
  if (patternName !== structDecl.value.name.text) {
    emitError(
      ctx,
      `expected struct \`${structDecl.value.name.text}\`, found \`${patternName}\``,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return some({ fields: [], label, alreadyErrored: true });
  }
  if (structDecl.value.body.kind !== "TupleFields") {
    emitError(
      ctx,
      `struct \`${patternName}\` is not a tuple struct`,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return some({ fields: [], label, alreadyErrored: true });
  }
  return some({
    fields: structDecl.value.body.fields,
    label,
    alreadyErrored: false,
  });
}

/** Plain-struct counterpart to `resolveStructVariantForPattern` - see
 * `resolveTupleStructForPattern`'s doc comment for why the pattern's own
 * path must be checked against the scrutinee-derived struct name. */
function resolveStructForPattern(
  ctx: AnalysisContext,
  pattern: Parser.StructPattern,
  scrutineeType: Semantics.Type,
): Option<ResolvedPatternFields<Semantics.StructField>> {
  const structDecl = resolveStructDecl(ctx, scrutineeType);
  if (!isSome(structDecl)) return none();
  const patternName = lastPathSegment(pattern.path);
  const label = `struct \`${patternName}\``;
  if (patternName !== structDecl.value.name.text) {
    emitError(
      ctx,
      `expected struct \`${structDecl.value.name.text}\`, found \`${patternName}\``,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return some({ fields: [], label, alreadyErrored: true });
  }
  if (structDecl.value.body.kind !== "NamedFields") {
    emitError(
      ctx,
      `struct \`${patternName}\` does not have named fields`,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return some({ fields: [], label, alreadyErrored: true });
  }
  return some({
    fields: structDecl.value.body.fields,
    label,
    alreadyErrored: false,
  });
}

/** Tries enum-variant resolution first, then plain-struct resolution -
 * mutually exclusive since a scrutinee type is never both `EnumType` and
 * `StructType`, so trying both never risks a duplicate diagnostic. */
function resolveTupleFieldsForPattern(
  ctx: AnalysisContext,
  pattern: Parser.TupleStructPattern,
  scrutineeType: Semantics.Type,
): Option<ResolvedPatternFields<Semantics.TupleField>> {
  const patternName = lastPathSegment(pattern.path);
  const enumVariant = resolveTupleVariantForPattern(
    ctx,
    pattern,
    scrutineeType,
  );
  if (isSome(enumVariant)) {
    return some({
      fields: enumVariant.value.fields,
      label: `variant \`${patternName}\``,
      alreadyErrored: false,
    });
  }
  return resolveTupleStructForPattern(ctx, pattern, scrutineeType);
}

/** Struct-pattern counterpart to `resolveTupleFieldsForPattern` above. */
function resolveNamedFieldsForPattern(
  ctx: AnalysisContext,
  pattern: Parser.StructPattern,
  scrutineeType: Semantics.Type,
): Option<ResolvedPatternFields<Semantics.StructField>> {
  const patternName = lastPathSegment(pattern.path);
  const enumVariant = resolveStructVariantForPattern(
    ctx,
    pattern,
    scrutineeType,
  );
  if (isSome(enumVariant)) {
    return some({
      fields: enumVariant.value.fields,
      label: `variant \`${patternName}\``,
      alreadyErrored: false,
    });
  }
  return resolveStructForPattern(ctx, pattern, scrutineeType);
}

// eslint-disable-next-line complexity -- Routing function
function analyzePattern(
  ctx: AnalysisContext,
  pattern: Parser.Pattern,
  scrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.Pattern {
  switch (pattern.kind) {
    case "WildcardPattern":
      return analyzeWildcardPattern(pattern, scrutineeType);
    case "BindingPattern":
      return isSome(pattern.subpattern)
        ? analyzePatternGuardrail(ctx, pattern, scrutineeType)
        : analyzeBindingPattern(
            ctx,
            pattern,
            scrutineeType,
            defaultMode,
            rootMutable,
          );
    case "LiteralPattern":
      return analyzeLiteralPattern(ctx, pattern, scrutineeType);
    case "RangePattern":
      return analyzeRangePattern(ctx, pattern, scrutineeType);
    case "OrPattern":
      return orPattern(ctx, pattern, scrutineeType, defaultMode, rootMutable);
    case "PathPattern": {
      const enumDecl = resolveEnumDecl(ctx, scrutineeType);
      return isSome(enumDecl)
        ? analyzePathPattern(ctx, pattern, scrutineeType, enumDecl.value)
        : analyzePatternGuardrail(ctx, pattern, scrutineeType);
    }
    case "TupleStructPattern": {
      const resolved = resolveTupleFieldsForPattern(
        ctx,
        pattern,
        scrutineeType,
      );

      return isSome(resolved)
        ? analyzeTupleStructPattern(
            ctx,
            pattern,
            scrutineeType,
            defaultMode,
            rootMutable,
            resolved.value,
          )
        : analyzePatternGuardrail(ctx, pattern, scrutineeType);
    }
    case "StructPattern": {
      const resolved = resolveNamedFieldsForPattern(
        ctx,
        pattern,
        scrutineeType,
      );

      return isSome(resolved)
        ? analyzeStructPattern(
            ctx,
            pattern,
            scrutineeType,
            defaultMode,
            rootMutable,
            resolved.value,
          )
        : analyzePatternGuardrail(ctx, pattern, scrutineeType);
    }
    case "SlicePattern": {
      // A dynamic-length scrutinee has no real type to destructure against
      // yet (no `Vec`/slice type exists - Slice 5), so only a fixed-length
      // `ArrayType` is promoted to real semantics here; anything else still
      // falls to the generic guardrail, unchanged.
      return scrutineeType.kind !== "ArrayType"
        ? analyzePatternGuardrail(ctx, pattern, scrutineeType)
        : analyzeSlicePattern(
            ctx,
            pattern,
            scrutineeType,
            defaultMode,
            rootMutable,
          );
    }
    case "TuplePattern":
      return analyzePatternGuardrail(ctx, pattern, scrutineeType);
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

function analyzeWildcardPattern(
  pattern: Parser.WildcardPattern,
  scrutineeType: Semantics.Type,
): Semantics.WildcardPattern {
  return {
    ...pattern,
    type: scrutineeType,
  };
}

function analyzeBindingPattern(
  ctx: AnalysisContext,
  pattern: Parser.BindingPattern,
  scrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.BindingPattern {
  if (pattern.byRef && pattern.mutable) {
    checkMutOverrideLegality(
      ctx,
      pattern.name.text,
      defaultMode,
      rootMutable,
      pattern.tokenId,
    );
  }
  const { type: boundType, localMutable } = effectiveBindingType(
    scrutineeType,
    defaultMode,
    pattern.byRef,
    pattern.mutable,
    pattern.tokenId,
  );
  bind(ctx, pattern.name.text, { type: boundType, mutable: localMutable });
  return {
    ...pattern,
    name: { ...pattern.name, type: boundType },
    subpattern: none(),
    type: boundType,
  };
}

function analyzeLiteralPattern(
  ctx: AnalysisContext,
  pattern: Parser.LiteralPattern,
  scrutineeType: Semantics.Type,
): Semantics.LiteralPattern {
  const literal = coercePatternLiteral(
    analyzeLiteralValue(ctx, pattern.literal),
    scrutineeType,
  );
  checkPatternLiteralType(ctx, literal.type, scrutineeType, pattern.tokenId);
  if (literal.kind === "IntLiteral") {
    checkPosLiteralRange(ctx, literal, literal.type);
  }
  return {
    ...pattern,
    literal,
    type: literal.type,
  };
}

function analyzeRangePattern(
  ctx: AnalysisContext,
  pattern: Parser.RangePattern,
  scrutineeType: Semantics.Type,
): Semantics.RangePattern {
  const start = coercePatternLiteral(
    analyzeLiteralValue(ctx, pattern.start.literal),
    scrutineeType,
  );
  const end = coercePatternLiteral(
    analyzeLiteralValue(ctx, pattern.end.literal),
    scrutineeType,
  );
  const startBound: Semantics.RangePatternBound = {
    ...pattern.start,
    literal: start,
  };
  const endBound: Semantics.RangePatternBound = {
    ...pattern.end,
    literal: end,
  };
  if (!typesEqual(start.type, end.type)) {
    emitError(
      ctx,
      `range bounds must have the same type: \`${describeType(start.type)}\` and \`${describeType(end.type)}\``,
      pattern.tokenId,
      "HEDGE-PATTERN-006",
    );
  } else {
    checkPatternLiteralType(ctx, start.type, scrutineeType, pattern.tokenId);
  }
  const low = rangeBoundValue(startBound);
  const high = rangeBoundValue(endBound);
  if (low !== undefined && high !== undefined && low > high) {
    emitError(
      ctx,
      `lower range bound ${low} is greater than upper bound ${high}, so the range matches nothing`,
      pattern.tokenId,
      "HEDGE-PATTERN-006",
    );
  }
  return {
    ...pattern,
    start: startBound,
    end: endBound,
    type: start.type,
  };
}

function orPattern(
  ctx: AnalysisContext,
  pattern: Parser.OrPattern,
  scrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.OrPattern {
  // Each alternative is analyzed independently, so `Foo(a) | Bar(b)`
  // binds both `a` and `b` into the arm's scope regardless of which
  // alternative actually matches at runtime - `checkOrPatternConsistency`
  // (below) is what actually enforces spec 0016's requirement that every
  // alternative bind the same names/types/modes, rather than this
  // analysis step silently accepting the mismatch.
  const alternatives = pattern.alternatives.map((alt) =>
    analyzePattern(ctx, alt, scrutineeType, defaultMode, rootMutable),
  );
  const result: Semantics.OrPattern = {
    ...pattern,
    alternatives,
    type: scrutineeType,
  };
  checkOrPatternConsistency(ctx, result);
  checkOrPatternReachability(ctx, result);
  return result;
}

function analyzePathPattern(
  ctx: AnalysisContext,
  pattern: Parser.PathPattern,
  scrutineeType: Semantics.Type,
  enumDecl: Semantics.EnumDecl,
): Semantics.PathPattern | Semantics.WildcardPattern {
  const variantName = lastPathSegment(pattern.path);
  const variant = enumDecl.variants.find((v) => v.name.text === variantName);
  if (variant === undefined) {
    emitError(
      ctx,
      `no variant \`${variantName}\` on enum \`${describeType(scrutineeType)}\``,
      pattern.tokenId,
      "HEDGE-NAME-004",
    );
    return analyzePatternGuardrail(ctx, pattern, scrutineeType);
  }
  if (isSome(variant.body)) {
    emitError(
      ctx,
      `variant \`${variantName}\` has fields; use \`${variantName}(...)\` or \`${variantName} { ... }\``,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
    return analyzePatternGuardrail(ctx, pattern, scrutineeType);
  }
  return { ...pattern, type: scrutineeType };
}

function analyzeTupleStructPattern(
  ctx: AnalysisContext,
  pattern: Parser.TupleStructPattern,
  scrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
  resolved: ResolvedPatternFields<Semantics.TupleField>,
): Semantics.TupleStructPattern {
  const { fields, label, alreadyErrored } = resolved;
  if (!alreadyErrored && fields.length !== pattern.elements.length) {
    emitError(
      ctx,
      `${label} has ${fields.length} field(s), but the pattern has ${pattern.elements.length}`,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
  }
  // A `mut` sigil on this whole tuple-struct pattern treats
  // the destructured value as mutable for every field reached through
  // it, regardless of the ambient `rootMutable` - it never demotes an
  // already-mutable ambient context back to immutable, only ever adds
  // mutability.
  const effectiveRootMutable = pattern.mutable || rootMutable;
  const elements = pattern.elements.map((el, i) =>
    analyzePattern(
      ctx,
      el,
      fields[i]?.type ?? UNIT,
      defaultMode,
      effectiveRootMutable,
    ),
  );
  return {
    ...pattern,
    elements,
    type: scrutineeType,
  };
}

function analyzeStructPattern(
  ctx: AnalysisContext,
  pattern: Parser.StructPattern,
  scrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
  resolved: ResolvedPatternFields<Semantics.StructField>,
): Semantics.StructPattern {
  const { fields: declaredFields, label, alreadyErrored } = resolved;
  // See the identical note in the `TupleStructPattern` case above.
  const effectiveRootMutable = pattern.mutable || rootMutable;
  const fields = pattern.fields.map((field): Semantics.FieldPattern => {
    const declared = declaredFields.find(
      (f) => f.name.text === field.name.text,
    );
    const fieldType = declared?.type ?? UNIT;
    if (declared === undefined && !alreadyErrored) {
      emitError(
        ctx,
        `no field \`${field.name.text}\` on ${label}`,
        field.name.tokenId,
        "HEDGE-NAME-003",
      );
    }
    if (isSome(field.pattern)) {
      return {
        ...field,
        name: { ...field.name, type: fieldType },
        pattern: some(
          analyzePattern(
            ctx,
            field.pattern.value,
            fieldType,
            defaultMode,
            effectiveRootMutable,
          ),
        ),
      };
    }
    // Shorthand (`Point { x }`) has no sigil position of its own - it
    // always inherits `defaultMode` unconditionally (byRef=false,
    // mutable=false), matching a bare `name` binding pattern with no
    // sigil at all.
    const { type: boundType, localMutable } = effectiveBindingType(
      fieldType,
      defaultMode,
      false,
      false,
      field.name.tokenId,
    );
    bind(ctx, field.name.text, { type: boundType, mutable: localMutable });
    return {
      ...field,
      name: { ...field.name, type: boundType },
      pattern: none<Semantics.Pattern>(),
    };
  });
  return {
    ...pattern,
    fields,
    type: scrutineeType,
  };
}

function analyzeSlicePattern(
  ctx: AnalysisContext,
  pattern: Parser.SlicePattern,
  scrutineeType: Semantics.ArrayType,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.SlicePattern {
  const { elementType, length } = scrutineeType;
  const restCount = pattern.elements.filter(
    (el) => el.kind === "RestPattern",
  ).length;
  const nonRestCount = pattern.elements.length - restCount;
  const alreadyErrored = restCount > 1;
  if (alreadyErrored) {
    emitError(
      ctx,
      `a slice pattern can have at most one \`..\` rest, but this one has ${restCount}`,
      pattern.tokenId,
      "HEDGE-PATTERN-005",
    );
  } else {
    const hasRest = restCount === 1;
    const arityOk = hasRest ? nonRestCount <= length : nonRestCount === length;
    if (!arityOk) {
      emitError(
        ctx,
        hasRest
          ? `array has ${length} element(s), but the pattern requires at least ${nonRestCount}`
          : `array has ${length} element(s), but the pattern requires exactly ${nonRestCount}`,
        pattern.tokenId,
        "HEDGE-PATTERN-005",
      );
    }
  }
  // Only used when a rest is present; harmless otherwise. Clamped to 0
  // since an array length is a `usize` (never negative) - it only goes
  // negative when `!arityOk` above already diagnosed the mismatch.
  const restLength = Math.max(0, length - nonRestCount);
  const elements = pattern.elements.map(
    (el): Semantics.Pattern | Semantics.RestPattern => {
      if (el.kind !== "RestPattern") {
        return analyzePattern(ctx, el, elementType, defaultMode, rootMutable);
      }
      if (!isSome(el.name)) {
        return { ...el, name: none() };
      }
      if (el.byRef && el.mutable) {
        checkMutOverrideLegality(
          ctx,
          el.name.value.text,
          defaultMode,
          rootMutable,
          el.tokenId,
        );
      }
      const restArrayType: Semantics.Type = {
        kind: "ArrayType",
        elementType,
        length: restLength,
      };
      const { type: boundType, localMutable } = effectiveBindingType(
        restArrayType,
        defaultMode,
        el.byRef,
        el.mutable,
        el.tokenId,
      );
      bind(ctx, el.name.value.text, {
        type: boundType,
        mutable: localMutable,
      });
      return {
        ...el,
        name: some({ ...el.name.value, type: boundType }),
      };
    },
  );
  return {
    ...pattern,
    elements,
    type: scrutineeType,
  };
}

interface OrPatternBinding {
  readonly name: string;
  readonly type: Semantics.Type;
  readonly byRef: boolean;
  readonly mutable: boolean;
}

/**
 * Every name one or-pattern alternative binds, with enough per-binding info
 * (`type`, `byRef`, `mutable`) for `checkOrPatternConsistency` to compare
 * alternatives against each other - mirrors `ownership/control-flow-graph.ts`'s
 * `declarationsOf`/`ownership/move-check.ts`'s `collectPatternDeclarations`
 * structurally, but adds `byRef` (neither of those needs it) since a
 * `&name`/`&mut name` override changes a binding's mode independently of its
 * `type` and local `mutable` flag. A struct pattern's shorthand field
 * (`Point { x }`) synthesizes `byRef: false, mutable: false` - the grammar
 * has no sigil position for shorthand, so it's always equivalent to a plain
 * `name` binding pattern with no sigil at all.
 */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function collectOrPatternBindings(
  pattern: Semantics.Pattern,
): readonly OrPatternBinding[] {
  switch (pattern.kind) {
    case "WildcardPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "PathPattern":
      return [];
    case "BindingPattern": {
      const own: OrPatternBinding[] =
        pattern.name.text === "_"
          ? []
          : [
              {
                name: pattern.name.text,
                type: pattern.type,
                byRef: pattern.byRef,
                mutable: pattern.mutable,
              },
            ];
      return isSome(pattern.subpattern)
        ? [...own, ...collectOrPatternBindings(pattern.subpattern.value)]
        : own;
    }
    case "OrPattern":
      // Not reachable in practice - the grammar flattens `|` to one level,
      // so an alternative is never itself an `OrPattern` - but handled
      // consistently (recursing through its own alternatives) rather than
      // asserted against, in case that ever changes.
      return pattern.alternatives.flatMap((alt) =>
        collectOrPatternBindings(alt),
      );
    case "TuplePattern":
    case "TupleStructPattern":
      return pattern.elements.flatMap((el) => collectOrPatternBindings(el));
    case "StructPattern":
      return pattern.fields.flatMap((field): readonly OrPatternBinding[] => {
        if (isSome(field.pattern)) {
          return collectOrPatternBindings(field.pattern.value);
        }
        if (field.name.text === "_") return [];
        return [
          {
            name: field.name.text,
            type: field.name.type,
            byRef: false,
            mutable: false,
          },
        ];
      });
    case "SlicePattern":
      return pattern.elements.flatMap((el): readonly OrPatternBinding[] => {
        if (el.kind === "RestPattern") {
          if (!isSome(el.name)) return [];
          return [
            {
              name: el.name.value.text,
              type: el.name.value.type,
              byRef: el.byRef,
              mutable: el.mutable,
            },
          ];
        }
        return collectOrPatternBindings(el);
      });
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

/**
 * Spec 0016: every or-pattern alternative must bind the same names, with
 * the same type and mode, since only one alternative's bindings actually
 * exist at runtime but the arm body can't know which. Emits at most one
 * "different names" diagnostic (naming every name that isn't universal,
 * not one diagnostic per name) and at most one "different type/mode"
 * diagnostic per name that every alternative does bind but not
 * identically.
 */
function checkOrPatternConsistency(
  ctx: AnalysisContext,
  pattern: Semantics.OrPattern,
): void {
  const perAlternative = pattern.alternatives.map((alt) =>
    collectOrPatternBindings(alt),
  );
  const nameSets = perAlternative.map(
    (bindings) => new Set(bindings.map((b) => b.name)),
  );
  const allNames = new Set(nameSets.flatMap((s) => [...s]));

  const inconsistentNames = [...allNames].filter(
    (name) => !nameSets.every((set) => set.has(name)),
  );
  if (inconsistentNames.length > 0) {
    emitError(
      ctx,
      `or-pattern alternatives must bind the same names; \`${inconsistentNames.join("`, `")}\` ${inconsistentNames.length === 1 ? "is" : "are"} not bound by every alternative`,
      pattern.tokenId,
      "HEDGE-PATTERN-004",
    );
  }

  for (const name of allNames) {
    if (inconsistentNames.includes(name)) continue;
    // Every alternative's own bindings are guaranteed to include `name` at
    // this point (it isn't in `inconsistentNames`), so `undefined` entries
    // are filtered out defensively rather than expected.
    const occurrences = perAlternative
      .map((bindings) => bindings.find((b) => b.name === name))
      .filter((b) => b !== undefined);
    const [first, ...rest] = occurrences;
    if (first === undefined) continue;
    // Compare the resulting type (mode-aware already, see
    // `effectiveBindingType`) and derived local mutability, not the raw
    // sigils: under a shared-reference scrutinee, `name` and `&name` both
    // bind an immutable `&T` - different syntax, same result.
    const localMutable = (b: OrPatternBinding): boolean =>
      !b.byRef && b.mutable;
    const consistent = rest.every(
      (occ) =>
        typesEqual(first.type, occ.type) &&
        localMutable(first) === localMutable(occ),
    );
    if (!consistent) {
      emitError(
        ctx,
        `or-pattern alternatives must bind \`${name}\` with the same type and mode in every alternative`,
        pattern.tokenId,
        "HEDGE-PATTERN-004",
      );
    }
  }
}

/** Once one alternative is irrefutable, everything after it in the same
 * or-pattern is dead. */
function checkOrPatternReachability(
  ctx: AnalysisContext,
  pattern: Semantics.OrPattern,
): void {
  let sawIrrefutable = false;
  for (const alt of pattern.alternatives) {
    if (sawIrrefutable) {
      emitError(ctx, "unreachable pattern", alt.tokenId, "HEDGE-PATTERN-003");
    } else if (isIrrefutablePattern(ctx, alt)) {
      sawIrrefutable = true;
    }
  }
}

/** A slice pattern's own arity check, re-derived from `analyzePattern`
 * rather than stored as a redundant flag. Array length is statically
 * known, so an arity mismatch is a precise "never matches" - not
 * assume-best-case like the struct/enum cases below - so it must not
 * count as a catch-all or subsume a later arm. Multiple rests (`[a, ..,
 * b, .., c]`) are ill-formed regardless of arity - already diagnosed
 * separately - so that case stays assume-best-case (`true`), unlike the
 * real check below it. */
function isSliceArityIrrefutable(
  elements: readonly (Semantics.Pattern | Semantics.RestPattern)[],
  type: Semantics.Type,
): boolean {
  if (type.kind !== "ArrayType") return false;
  const restCount = elements.filter((el) => el.kind === "RestPattern").length;
  if (restCount > 1) return true;
  const nonRestCount = elements.length - restCount;
  return restCount === 1
    ? nonRestCount <= type.length
    : nonRestCount === type.length;
}

function isIrrefutablePattern(
  ctx: AnalysisContext,
  pattern: Semantics.Pattern,
): boolean {
  switch (pattern.kind) {
    case "WildcardPattern":
      return true;
    case "BindingPattern":
      return isNone(pattern.subpattern);
    case "LiteralPattern":
    case "RangePattern":
    case "TuplePattern":
      return false;
    case "SlicePattern":
      return isSliceArityIrrefutable(pattern.elements, pattern.type);
    case "StructPattern":
    case "TupleStructPattern":
    case "PathPattern": {
      // A plain (non-enum) struct has exactly one shape, so any pattern
      // that resolved against one is unconditionally irrefutable - there's
      // no other variant for it to fail to match. An enum-variant pattern
      // is irrefutable only when its enum has exactly one variant (that
      // variant is the only possible value, mirroring Rust's own treatment
      // of a single-variant enum); a multi-variant enum's pattern only ever
      // names one variant, leaving the others uncovered.
      const enumDecl = resolveEnumDecl(ctx, pattern.type);
      if (isSome(enumDecl)) return enumDecl.value.variants.length === 1;
      return isSome(resolveStructDecl(ctx, pattern.type));
    }
    case "OrPattern":
      // Matching tries each alternative in turn and succeeds at the first
      // one that matches, so a single irrefutable alternative (e.g. `_` in
      // `_ | Message::Quit`) makes the whole or-pattern always match.
      return pattern.alternatives.some((alt) => isIrrefutablePattern(ctx, alt));
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

/** Every enum-variant name a pattern covers, recursing through `OrPattern`
 * alternatives - every other pattern kind contributes nothing (a wildcard/
 * binding catch-all is handled separately by `checkMatchExhaustiveness`'s
 * own base rule, and every other kind either doesn't apply to an enum
 * scrutinee or (once `analyzePattern` resolves it) can only ever name a
 * real variant of it). */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function collectCoveredVariantNames(
  pattern: Semantics.Pattern,
  out: Set<string>,
): void {
  switch (pattern.kind) {
    case "PathPattern":
    case "TupleStructPattern":
    case "StructPattern": {
      const name = lastPathSegment(pattern.path);
      if (name !== undefined) out.add(name);
      return;
    }
    case "OrPattern":
      for (const alt of pattern.alternatives) {
        collectCoveredVariantNames(alt, out);
      }
      return;
    case "WildcardPattern":
    case "BindingPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "TuplePattern":
    case "SlicePattern":
      return;
    default:
      assertNever(pattern, `Unexpected pattern: ${JSON.stringify(pattern)}`);
  }
}

/** Every bool value a pattern covers, recursing through `OrPattern`
 * alternatives - mirrors `collectCoveredVariantNames` for the bool
 * scrutinee case. */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function collectCoveredBoolValues(
  pattern: Semantics.Pattern,
  out: Set<boolean>,
): void {
  switch (pattern.kind) {
    case "LiteralPattern":
      if (pattern.literal.kind === "BoolLiteral")
        out.add(pattern.literal.value);
      return;
    case "OrPattern":
      for (const alt of pattern.alternatives) {
        collectCoveredBoolValues(alt, out);
      }
      return;
    case "WildcardPattern":
    case "BindingPattern":
    case "RangePattern":
    case "TuplePattern":
    case "StructPattern":
    case "TupleStructPattern":
    case "PathPattern":
    case "SlicePattern":
      return;
    default:
      assertNever(pattern, `Unexpected pattern: ${JSON.stringify(pattern)}`);
  }
}

/**
 * At most one of `enumDecl`/`isBool` is ever relevant for a given
 * scrutinee - every other scrutinee type only hits the irrefutable
 * catch-all rule, never real subsumption tracking.
 */
interface UnreachableArmsCoverage {
  readonly enumDecl: Option<Semantics.EnumDecl>;
  readonly isBool: boolean;
  readonly coveredVariants: Set<string>;
  readonly coveredBools: Set<boolean>;
}

function isArmUnreachable(
  coverage: UnreachableArmsCoverage,
  arm: Semantics.MatchArm,
  hasCatchAllSoFar: boolean,
): boolean {
  if (hasCatchAllSoFar) return true;

  if (isSome(coverage.enumDecl)) {
    const thisArmVariants = new Set<string>();
    collectCoveredVariantNames(arm.pattern, thisArmVariants);
    return (
      thisArmVariants.size > 0 &&
      [...thisArmVariants].every((name) => coverage.coveredVariants.has(name))
    );
  }

  if (coverage.isBool) {
    const thisArmBools = new Set<boolean>();
    collectCoveredBoolValues(arm.pattern, thisArmBools);
    return (
      thisArmBools.size > 0 &&
      [...thisArmBools].every((v) => coverage.coveredBools.has(v))
    );
  }

  return false;
}

/**
 * A guarded arm never contributes coverage - a guard means "maybe
 * matches", so it can't unconditionally cover anything for arms after it.
 */
function recordArmCoverage(
  ctx: AnalysisContext,
  coverage: UnreachableArmsCoverage,
  arm: Semantics.MatchArm,
): boolean {
  if (isSome(arm.guard)) return false;
  if (isIrrefutablePattern(ctx, arm.pattern)) return true;

  if (isSome(coverage.enumDecl)) {
    collectCoveredVariantNames(arm.pattern, coverage.coveredVariants);
  } else if (coverage.isBool) {
    collectCoveredBoolValues(arm.pattern, coverage.coveredBools);
  }
  return false;
}

/**
 * Reports an arm as unreachable when it is fully subsumed by the arms
 * before it, in source order.
 */
function checkUnreachableArms(
  ctx: AnalysisContext,
  arms: readonly Semantics.MatchArm[],
  scrutineeType: Semantics.Type,
): void {
  const coverage: UnreachableArmsCoverage = {
    enumDecl: resolveEnumDecl(ctx, scrutineeType),
    isBool: scrutineeType.kind === "PrimitiveBooleanType",
    coveredVariants: new Set<string>(),
    coveredBools: new Set<boolean>(),
  };
  let hasCatchAll = false;

  for (const arm of arms) {
    if (isArmUnreachable(coverage, arm, hasCatchAll)) {
      emitError(ctx, "unreachable pattern", arm.tokenId, "HEDGE-PATTERN-003");
    }
    hasCatchAll = hasCatchAll || recordArmCoverage(ctx, coverage, arm);
  }
}

function missingEnumVariants(
  arms: readonly Semantics.MatchArm[],
  enumDecl: Semantics.EnumDecl,
): readonly string[] {
  const covered = new Set<string>();
  for (const arm of arms) {
    if (isNone(arm.guard)) collectCoveredVariantNames(arm.pattern, covered);
  }
  return enumDecl.variants
    .map((v) => v.name.text)
    .filter((name) => !covered.has(name));
}

function missingBoolValues(
  arms: readonly Semantics.MatchArm[],
): readonly string[] {
  const covered = new Set<boolean>();
  for (const arm of arms) {
    if (isNone(arm.guard)) collectCoveredBoolValues(arm.pattern, covered);
  }
  const missing: string[] = [];
  if (!covered.has(true)) missing.push("true");
  if (!covered.has(false)) missing.push("false");
  return missing;
}

/**
 * Only enum-variant and bool coverage get real per-value tracking (mirrors
 * `UnreachableArmsCoverage`) - every other scrutinee type falls to the
 * "`_` covers everything" fallback.
 */
function missingPatternNames(
  ctx: AnalysisContext,
  arms: readonly Semantics.MatchArm[],
  scrutineeType: Semantics.Type,
): readonly string[] {
  const enumDecl = resolveEnumDecl(ctx, scrutineeType);
  if (isSome(enumDecl)) return missingEnumVariants(arms, enumDecl.value);
  if (scrutineeType.kind === "PrimitiveBooleanType")
    return missingBoolValues(arms);
  return ["_"];
}

function checkMatchExhaustiveness(
  ctx: AnalysisContext,
  matchExpr: Parser.MatchExpression,
  arms: readonly Semantics.MatchArm[],
  scrutineeType: Semantics.Type,
): void {
  const hasCatchAll = arms.some(
    (arm) => isNone(arm.guard) && isIrrefutablePattern(ctx, arm.pattern),
  );
  if (hasCatchAll) return;

  const missing = missingPatternNames(ctx, arms, scrutineeType);
  if (missing.length === 0) return;

  emitError(
    ctx,
    `non-exhaustive patterns: \`${missing.join("`, `")}\` not covered`,
    matchExpr.tokenId,
    "HEDGE-PATTERN-002",
  );
}

function analyzeMatchArm(
  ctx: AnalysisContext,
  arm: Parser.MatchArm,
  effectiveScrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.MatchArm {
  pushFrame(ctx);
  try {
    const pattern = analyzePattern(
      ctx,
      arm.pattern,
      effectiveScrutineeType,
      defaultMode,
      rootMutable,
    );
    const guard = mapSome(arm.guard, (g) => analyzeExpression(ctx, g));
    const body = analyzeExpression(ctx, arm.body);
    return { ...arm, pattern, guard, body };
  } finally {
    popFrame(ctx);
  }
}

function analyzeMatchExpression(
  ctx: AnalysisContext,
  matchExpr: Parser.MatchExpression,
): Semantics.MatchExpression {
  const scrutinee = analyzeExpression(ctx, matchExpr.scrutinee);
  const scrutineeType = getType(scrutinee);
  const { mode: defaultMode, effectiveType } =
    defaultBindingModeForScrutinee(scrutineeType);
  // Only ever consulted when `defaultMode === "owned"` (see
  // `checkMutOverrideLegality`) - a &mut-override's legality under a
  // reference-typed scrutinee never depends on the scrutinee expression's
  // own place mutability, only on the reference's own mutability
  // (`defaultMode` itself already captures that).
  const rootMutable = !isSome(placeMutabilityViolation(ctx, scrutinee, true));
  const arms = matchExpr.arms.map((arm) =>
    analyzeMatchArm(ctx, arm, effectiveType, defaultMode, rootMutable),
  );

  // A `UnitType` scrutinee is ambiguous (see `isAmbiguousUnitExpr`'s doc
  // comment): it's either a genuine unit value or the error-recovery
  // placeholder for an already-diagnosed failure (an unresolved name, a
  // failed arithmetic operand, ...). Skipping both checks in the
  // placeholder case avoids piling a second, spurious "non-exhaustive"
  // diagnostic on top of whatever already failed to resolve the scrutinee.
  // Checked against the raw `scrutineeType`, not `effectiveType` - a
  // reference-wrapped scrutinee is never itself the `UnitType` placeholder
  // (it would be a `ReferenceType`), so unwrapping first couldn't change
  // this check's outcome, only its own doesn't-apply-here type.
  if (!(scrutineeType.kind === "UnitType" && isAmbiguousUnitExpr(scrutinee))) {
    checkUnreachableArms(ctx, arms, effectiveType);
    checkMatchExhaustiveness(ctx, matchExpr, arms, effectiveType);
  }

  let resultType: Semantics.Type = {
    kind: "UnitType",
    tokenId: matchExpr.tokenId,
  };
  for (const arm of arms) {
    const armType = getType(arm.body);
    if (armType.kind === "UnitType") continue;
    if (resultType.kind === "UnitType") {
      resultType = armType;
      continue;
    }
    if (!typesEqual(resultType, armType)) {
      emitError(
        ctx,
        "match arms have incompatible types",
        matchExpr.tokenId,
        "HEDGE-TYPE-004",
      );
      break;
    }
  }

  return { ...matchExpr, scrutinee, arms, type: resultType };
}

// eslint-disable-next-line complexity -- Routing function over the full Item union
function analyzeItem(ctx: AnalysisContext, item: Parser.Item): Semantics.Item {
  switch (item.kind) {
    case "Function":
      return analyzeFunction(ctx, item);
    case "FunctionSignature":
      emitError(
        ctx,
        "a function signature with no body is not allowed as a top-level item",
        item.tokenId,
        "HEDGE-ITEM-001",
      );
      return analyzeFunctionSignature(ctx, item);
    case "Struct": {
      const cached = lookupStruct(ctx, item.name.text);
      return cached?.tokenId === item.tokenId
        ? cached
        : analyzeStruct(ctx, item);
    }
    case "Enum": {
      const cached = lookupEnum(ctx, item.name.text);
      return cached?.tokenId === item.tokenId ? cached : analyzeEnum(ctx, item);
    }
    case "Trait":
      return analyzeTraitDecl(ctx, item);
    case "Impl":
      return analyzeImplDecl(ctx, item);
    case "TypeAlias":
      return { kind: "TypeAlias", tokenId: item.tokenId };
    case "Const":
      return analyzeConstStatement(ctx, item);
    case "Static":
      return analyzeStaticDecl(ctx, item);
    case "LetStatement":
    case "ExpressionStatement": {
      emitError(
        ctx,
        TOP_LEVEL_ITEM_RESTRICTION_MESSAGE,
        item.tokenId,
        "HEDGE-ITEM-001",
      );
      const prevLen = ctx.diagnostics.length;
      const analyzed = analyzeStatement(ctx, item);
      ctx.diagnostics.splice(prevLen); // suppress cascading errors - the restriction error is good enough
      return analyzed;
    }
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
    case "PathExpression":
    case "CallExpression":
    case "ReferenceExpression":
    case "DereferenceExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "AssignExpression":
    case "CompoundAssignExpression":
    case "FieldAccessExpression":
    case "MethodCallExpression":
    case "IndexExpression":
    case "TupleExpression":
    case "ArrayExpression":
    case "ArrayRepeatExpression":
    case "StructExpression":
    case "RangeExpression":
    case "IfExpression":
    case "LetExpression":
    case "MatchExpression":
    case "WhileExpression":
    case "Block":
    case "Identifier":
      // A bare expression at top level: rejected, then analyzed anyway so a
      // reference inside it does not cascade a second diagnostic.
      emitError(
        ctx,
        TOP_LEVEL_ITEM_RESTRICTION_MESSAGE,
        item.tokenId,
        "HEDGE-ITEM-001",
      );
      return analyzeExpression(ctx, item);
    default:
      return assertNever(item, `Unexpected item: ${JSON.stringify(item)}`);
  }
}

function analyzeStruct(
  ctx: AnalysisContext,
  item: Parser.StructDecl,
): Semantics.StructDecl {
  const scopedName = scopedTypeName(item.name.tokenId, item.name.text);
  checkUnusedGenericParams(ctx, item.generics, structFieldUsedNames(item.body));
  pushGenericParams(ctx, item.generics);
  const body = analyzeStructBody(ctx, item.body);
  popGenericParams(ctx);
  return {
    ...item,
    name: { ...item.name, type: { kind: "StructType", name: scopedName } },
    generics: genericParamNames(item.generics),
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    body,
    type: {
      kind: "StructType",
      name: scopedName,
    },
  };
}

function analyzeStructBody(
  ctx: AnalysisContext,
  body: Parser.StructBody,
): Semantics.StructBody {
  switch (body.kind) {
    case "Unit":
      return body;
    case "NamedFields":
      return {
        ...body,
        fields: body.fields.map(
          (field: Parser.StructField): Semantics.StructField => {
            const fieldType = validateSlice1Type(
              ctx,
              field.type,
              field.type.tokenId,
            );
            return {
              ...field,
              name: analyzeIdentifier(ctx, field.name, fieldType),
              attributes: field.attributes.map((attr) =>
                analyzeAttribute(ctx, attr),
              ),
              type: fieldType,
            };
          },
        ),
      };
    case "TupleFields":
      return {
        ...body,
        fields: body.fields.map(
          (field: Parser.TupleField): Semantics.TupleField => ({
            ...field,
            attributes: field.attributes.map((attr) =>
              analyzeAttribute(ctx, attr),
            ),
            type: validateSlice1Type(ctx, field.type, field.type.tokenId),
          }),
        ),
      };
    default:
      assertNever(body, `Unexpected AST node: ${JSON.stringify(body)}`);
  }
}

function analyzeAttribute(
  ctx: AnalysisContext,
  attribute: Parser.Attribute,
): Semantics.Attribute {
  return {
    ...attribute,
    name: analyzeIdentifier(ctx, attribute.name, {
      kind: "PrimitiveStringType",
    }),
    arguments: mapSome(attribute.arguments, (args) =>
      args.map((arg) => ({
        path: arg.path,
        literal: mapSome(arg.literal, (literal) => {
          switch (literal.kind) {
            case "StringLiteral":
              return analyzeStringLiteral(ctx, literal);
            case "IntLiteral":
              return analyzeIntLiteral(ctx, literal);
            default:
              return assertNever(
                literal,
                `Unexpected AST node: ${JSON.stringify(literal)}`,
              );
          }
        }),
      })),
    ),
  };
}

function analyzeStringLiteral(
  _ctx: AnalysisContext,
  stringLiteral: Parser.StringLiteral,
): Semantics.StringLiteral {
  return { ...stringLiteral, type: { kind: "PrimitiveStringType" } };
}

function analyzeIntLiteral(
  ctx: AnalysisContext,
  intLiteral: Parser.IntLiteral,
  skipRangeCheck: boolean = false,
): Semantics.IntLiteral {
  const type: Semantics.PrimitiveType = isSome(intLiteral.suffix)
    ? intSuffixToPrimitive(intLiteral.suffix.value)
    : { kind: "PrimitiveI32Type" };
  const result = { ...intLiteral, type };
  if (!skipRangeCheck && isSome(intLiteral.suffix)) {
    checkPosLiteralRange(ctx, result, type);
  }
  return result;
}

function analyzeFloatLiteral(
  _ctx: AnalysisContext,
  floatLiteral: Parser.FloatLiteral,
): Semantics.FloatLiteral {
  const type: Semantics.PrimitiveType =
    isSome(floatLiteral.suffix) && floatLiteral.suffix.value === "f32"
      ? { kind: "PrimitiveF32Type" }
      : { kind: "PrimitiveF64Type" };
  return { ...floatLiteral, type };
}

function analyzeBoolLiteral(
  _ctx: AnalysisContext,
  boolLiteral: Parser.BoolLiteral,
): Semantics.BoolLiteral {
  return { ...boolLiteral, type: { kind: "PrimitiveBooleanType" } };
}

function analyzeCharLiteral(
  _ctx: AnalysisContext,
  charLiteral: Parser.CharLiteral,
): Semantics.CharLiteral {
  return { ...charLiteral, type: { kind: "PrimitiveCharType" } };
}

/** Non-emitting counterpart to `validateProjectionType`'s bound-parameter
 * branch - `undefined` for anything that doesn't cleanly resolve (an
 * unbound or ambiguous base), since the caller's own fallback to `UnitType`
 * already covers every failure case without needing to distinguish them. */
function resolveProjectionType(
  ctx: AnalysisContext,
  type: Parser.NamedType,
  fallbackTokenId: number,
): Semantics.Type | undefined {
  const baseName = type.path.segments[0];
  const assocName = type.path.segments[1];
  if (
    baseName === undefined ||
    assocName === undefined ||
    !isDeclaredGenericParam(ctx, baseName)
  ) {
    return undefined;
  }
  const result = resolveAssociatedTypeTrait(
    ctx,
    declaredGenericParamBounds(ctx, baseName),
    assocName,
  );
  return result.kind === "Found"
    ? makeProjectionType(fallbackTokenId, result.traitName, assocName, baseName)
    : undefined;
}

/**
 * Must resolve user-declared names too, not just primitives, or every
 * struct and enum in a signature becomes `()` and call-site checking
 * silently passes. Non-emitting counterpart to `validateNamedType`.
 */
function resolveNamedType(
  ctx: AnalysisContext,
  type: Parser.NamedType,
  fallbackTokenId: number,
): Semantics.Type {
  if (type.path.segments.length === 1) {
    const name = type.path.segments[0];
    assert(name !== undefined, "Name segment missing");
    if (isDeclaredGenericParam(ctx, name) && type.typeArguments.length === 0) {
      return { kind: "NamedType", tokenId: fallbackTokenId, path: type.path };
    }
    const prim = namedTypeToPrimitive(name);
    if (isSome(prim)) return prim.value;
    const resolved = lookupStructOrEnumType(ctx, name);
    if (resolved !== undefined) return resolved;
  }
  if (type.path.segments.length === 2) {
    const projection = resolveProjectionType(ctx, type, fallbackTokenId);
    if (projection !== undefined) return projection;
  }
  return { kind: "UnitType", tokenId: fallbackTokenId };
}

/**
 * Resolves a declared type without emitting, for building a signature
 * before the declaration is analyzed - emitting here would double-report.
 */
function resolveSlice1Type(
  ctx: AnalysisContext,
  type: Parser.Type,
  fallbackTokenId: number,
): Semantics.Type {
  switch (type.kind) {
    case "NamedType":
      return resolveNamedType(ctx, type, fallbackTokenId);
    case "UnitType":
      return type;
    case "ReferenceType":
      return {
        kind: "ReferenceType",
        tokenId: fallbackTokenId,
        mutable: type.mutable,
        referent: resolveSlice1Type(ctx, type.referent, type.referent.tokenId),
      };
    case "ArrayType":
      return {
        kind: "ArrayType",
        elementType: resolveSlice1Type(
          ctx,
          type.elementType,
          type.elementType.tokenId,
        ),
        // No `ctx` here (see this function's own callers - only used for a
        // function's pre-registration signature type, before its body is
        // analyzed), so a non-literal length can't be const-folded yet.
        // `validateSlice1Type` resolves the real length later, with full
        // context, when the function's own parameters are actually
        // analyzed - this placeholder only affects a caller that resolves
        // against this function's forward-registered signature before then.
        length:
          type.length.kind === "IntLiteral"
            ? Number(intLiteralValue(type.length))
            : 0,
      };
    case "DynType": {
      const bareName = type.bound.path.segments.at(-1) ?? "";
      const traitId = lookupTrait(ctx, bareName);
      const registered =
        traitId === undefined ? undefined : ctx.traitRegistry.get(traitId);
      // Non-emitting - `validateSlice1Type` reports an unknown/non-trait name
      // or a non-object-safe trait once the declaration's body is analyzed;
      // here just mirror the type it lands on (`DynType` or the recovery
      // `UnitType`) so a forward-registered signature matches.
      return traitId !== undefined &&
        registered !== undefined &&
        isNone(registered.notObjectSafe)
        ? { kind: "DynType", tokenId: fallbackTokenId, traitId }
        : { kind: "UnitType", tokenId: fallbackTokenId };
    }
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function fnSignatureType(
  ctx: AnalysisContext,
  signature: Parser.FunctionSignature,
): Semantics.FunctionType {
  pushGenericParams(ctx, signature.generics, signature.whereClause);
  validateGenericParamBounds(ctx, signature.generics, signature.whereClause);
  const type: Semantics.FunctionType = {
    kind: "FunctionType",
    params: signature.params.map((p) =>
      resolveSlice1Type(ctx, p.type, p.type.tokenId),
    ),
    returnType: isSome(signature.returnType)
      ? resolveSlice1Type(
          ctx,
          signature.returnType.value,
          signature.returnType.value.tokenId,
        )
      : { kind: "UnitType", tokenId: signature.tokenId },
    paramsArePlaceholder: false,
    genericParams: genericParamNames(signature.generics),
    genericParamBounds: resolveBoundNames(
      ctx,
      genericParamBoundNames(signature.generics, signature.whereClause),
    ),
  };
  popGenericParams(ctx);
  return type;
}

/**
 * `operand` is a fresh borrow of a plain value that lives only in this
 * function's own frame - a `let`-local or a by-value parameter - when it
 * is a bare single-segment path whose own type is not already a
 * reference. A reference-typed operand (an incoming `&T` parameter, or a
 * dereference of one) means the borrow is grounded in something the
 * caller owns, not this frame. This is the narrow, single-hop
 * "borrow outliving referent" check - it does not trace through an
 * intermediate alias binding, e.g. `let r = &x; r`, a known, deliberately
 * deferred gap.
 */
function danglingReferenceOperandName(
  operand: Semantics.Expression,
): string | undefined {
  if (
    operand.kind !== "PathExpression" ||
    operand.path.segments.length !== 1 ||
    operand.type.kind === "ReferenceType"
  ) {
    return undefined;
  }
  // A PathExpression's UnitType is always the error-recovery placeholder for
  // an unresolved name (see isAmbiguousUnitExpr's doc comment) - that
  // failure already reported its own diagnostic, so this must not add a
  // second one for the same root cause.
  if (isAmbiguousUnitExpr(operand) && operand.type.kind === "UnitType") {
    return undefined;
  }
  return operand.path.segments[0];
}

/**
 * Checks a function body's trailing-expression type against its declared
 * (or implicit-unit) return type, coercing an unsuffixed-integer-literal
 * trailing expression first. A body with no trailing expression at all
 * (e.g. `fn f() -> i32 { let x = 1; }`) takes the early-return branch below
 * instead - it's checked for a missing return value there, not for a type
 * mismatch, since there's no trailing-expression type to reconcile against.
 *
 * Cascade guard: if the trailing expression's own analysis already failed
 * (its type is the `UnitType` error-recovery placeholder), no diagnostic is
 * emitted here - see {@link reconcileExpressionType}.
 */
function checkEscapingReferenceExpression(
  ctx: AnalysisContext,
  expr: Semantics.ReferenceExpression,
): void {
  const name = danglingReferenceOperandName(expr.operand);
  if (name === undefined) {
    return;
  }
  emitError(
    ctx,
    `returns a reference to \`${name}\`, which does not live beyond this function`,
    expr.tokenId,
    "HEDGE-LIFETIME-002",
  );
}

function checkEscapingStructExpression(
  ctx: AnalysisContext,
  expr: Semantics.StructExpression,
): void {
  for (const field of expr.fields) {
    if (
      !isSome(field.value) ||
      field.value.value.kind !== "ReferenceExpression"
    ) {
      continue;
    }
    const fieldValue = field.value.value;
    const name = danglingReferenceOperandName(fieldValue.operand);
    if (name === undefined) {
      continue;
    }
    emitError(
      ctx,
      `struct literal field \`${field.name.text}\` borrows \`${name}\`, which does not live beyond this function`,
      fieldValue.tokenId,
      "HEDGE-LIFETIME-002",
    );
  }
}

/**
 * The narrow "borrow outliving referent" check (spec 0006): a function's
 * trailing/return-position expression must not carry a fresh borrow of a
 * value grounded in this function's own frame. The two leaf shapes named in
 * the ticket - a bare `&local`, and a struct literal field initialized with
 * `&local` - are checked wherever they appear in return position, including
 * inside an `if`/`else` branch or a nested block's own trailing expression
 * (recursing via `checkEscapingReferenceInBranch`/`checkEscapingReferenceInBlock`).
 * This still does not trace through an intermediate alias binding (`let r =
 * &x; r`) - that remains general escape/alias analysis, out of scope here
 * (see the `it.fails` pinning it below).
 */
function checkEscapingReference(
  ctx: AnalysisContext,
  expr: Semantics.Expression,
): void {
  if (expr.kind === "ReferenceExpression") {
    checkEscapingReferenceExpression(ctx, expr);
    return;
  }
  if (expr.kind === "StructExpression") {
    checkEscapingStructExpression(ctx, expr);
    return;
  }
  if (expr.kind === "IfExpression") {
    checkEscapingReferenceInBlock(ctx, expr.thenBranch);
    if (isSome(expr.elseBranch)) {
      checkEscapingReferenceInBranch(ctx, expr.elseBranch.value);
    }
    return;
  }
  if (expr.kind === "Block") {
    checkEscapingReferenceInBlock(ctx, expr);
  }
}

function checkEscapingReferenceInBranch(
  ctx: AnalysisContext,
  branch: Semantics.IfExpression | Semantics.Block,
): void {
  if (branch.kind === "IfExpression") {
    checkEscapingReference(ctx, branch);
    return;
  }
  checkEscapingReferenceInBlock(ctx, branch);
}

function checkEscapingReferenceInBlock(
  ctx: AnalysisContext,
  block: Semantics.Block,
): void {
  if (isSome(block.trailingExpression)) {
    checkEscapingReference(ctx, block.trailingExpression.value);
  }
}

function checkFunctionReturnType(
  ctx: AnalysisContext,
  body: Semantics.Block,
  expectedReturnType: Semantics.Type,
  suppressMismatch: boolean,
): Semantics.Block {
  if (!isSome(body.trailingExpression)) {
    if (expectedReturnType.kind !== "UnitType") {
      emitError(
        ctx,
        `missing return value: expected \`${describeType(expectedReturnType)}\``,
        body.tokenId,
        "HEDGE-TYPE-001",
      );
    }
    return body;
  }
  const trailing = body.trailingExpression.value;

  const { expr, mismatch } = reconcileExpressionType(
    ctx,
    trailing,
    expectedReturnType,
    trailing.tokenId,
  );
  if (expr.kind === "IntLiteral") {
    checkPosLiteralRange(ctx, expr, expectedReturnType);
  }
  if (mismatch) {
    if (!suppressMismatch) {
      emitError(
        ctx,
        `return type mismatch: expected \`${describeType(expectedReturnType)}\`, found \`${describeType(getType(expr))}\``,
        trailing.tokenId,
        "HEDGE-TYPE-001",
      );
    }
  } else {
    checkEscapingReference(ctx, expr);
  }

  return expr === trailing
    ? body
    : { ...body, trailingExpression: some(expr), type: getType(expr) };
}

/**
 * Analyzes everything a signature owns (params, return type, name,
 * attributes, generics) - shared by a bodiless `FunctionSignature` and a
 * bodied `FunctionDef`'s own signature. Caller owns `pushFrame`/
 * `pushGenericParams` and their `pop` counterparts, since a bodied
 * function's body analysis must still run inside that same scope.
 */
function buildFunctionSignature(
  ctx: AnalysisContext,
  decl: Parser.FunctionSignature,
): {
  signature: Semantics.FunctionSignature;
  expectedReturnType: Semantics.Type;
  suppressReturnTypeMismatch: boolean;
} {
  const analyzedParams = decl.params.map(
    (param: Parser.Param): Semantics.Param => {
      const paramType = validateSlice1Type(ctx, param.type, param.type.tokenId);
      const pattern = analyzeLetOrParamPattern(
        ctx,
        param.pattern,
        paramType,
        none(),
      );
      return { ...param, type: paramType, pattern };
    },
  );
  const returnType: Option<Semantics.Type> = mapSome(
    decl.returnType,
    (rt: Parser.Type): Semantics.Type =>
      validateSlice1Type(ctx, rt, rt.tokenId),
  );
  const expectedReturnType: Semantics.Type = unwrapSomeOr(returnType, {
    kind: "UnitType",
    tokenId: decl.tokenId,
  });
  const suppressReturnTypeMismatch =
    isSome(decl.returnType) && isSelfType(decl.returnType.value);
  const signature: Semantics.FunctionSignature = {
    kind: "FunctionSignature",
    tokenId: decl.tokenId,
    visibility: decl.visibility,
    name: {
      ...decl.name,
      type: { kind: "UnitType", tokenId: decl.name.tokenId },
    },
    attributes: decl.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    generics: genericParamNames(decl.generics),
    whereClause: none(),
    params: analyzedParams,
    returnType,
  };
  return { signature, expectedReturnType, suppressReturnTypeMismatch };
}

function analyzeFunctionSignature(
  ctx: AnalysisContext,
  decl: Parser.FunctionSignature,
): Semantics.FunctionSignature {
  // Pushed in lockstep with `scopes` (matching `analyzeBlock`'s own
  // invariant) even though a const/static can never actually be declared
  // in param position - `resolvedNameIsStatic` and the const-shadowing
  // check in `analyzeConstReference` both compare frame *indices* across
  // `scopes` and these stacks, which only lines up if every `scopes` push
  // has a matching push here, everywhere, not just in `analyzeBlock`.
  pushFrame(ctx);
  pushGenericParams(ctx, decl.generics);
  const { signature } = buildFunctionSignature(ctx, decl);
  popGenericParams(ctx);
  popFrame(ctx);
  return signature;
}

function analyzeFunction(
  ctx: AnalysisContext,
  decl: Parser.FunctionDef,
): Semantics.FunctionDef {
  pushFrame(ctx);
  pushGenericParams(ctx, decl.signature.generics);
  const { signature, expectedReturnType, suppressReturnTypeMismatch } =
    buildFunctionSignature(ctx, decl.signature);
  const body = checkFunctionReturnType(
    ctx,
    analyzeBlock(
      ctx,
      decl.body,
      isSome(decl.signature.returnType) && !suppressReturnTypeMismatch
        ? expectedReturnType
        : undefined,
    ),
    expectedReturnType,
    suppressReturnTypeMismatch,
  );
  const result: Semantics.FunctionDef = {
    kind: "Function",
    tokenId: decl.tokenId,
    signature,
    body,
  };
  popGenericParams(ctx);
  popFrame(ctx);
  return result;
}

/** `expectedType`, when given, seeds a trailing expression that's directly
 * a call to a generic callee - the enclosing function's own declared return
 * type, threaded down only from `analyzeFunction`'s own top-level call.
 * Every other caller (an `if`/`else` branch, a nested block, ...) omits it,
 * unaffected. */
function analyzeBlock(
  ctx: AnalysisContext,
  block: Parser.Block,
  expectedType?: Semantics.Type,
): Semantics.Block {
  pushFrame(ctx);
  registerTypeDecls(ctx, block.statements);
  registerConstsAndStatics(ctx, block.statements);
  const analyzedStatements = block.statements.map((statement) =>
    analyzeStatement(ctx, statement),
  );
  const analyzedTrailing = mapSome(block.trailingExpression, (expr) =>
    expr.kind === "CallExpression" && expectedType !== undefined
      ? analyzeCall(ctx, expr, expectedType)
      : analyzeExpression(ctx, expr),
  );
  const type: Semantics.Type = isSome(analyzedTrailing)
    ? getType(analyzedTrailing.value)
    : { kind: "UnitType", tokenId: block.tokenId };
  const result: Semantics.Block = {
    ...block,
    innerAttributes: block.innerAttributes.map((attr) =>
      analyzeAttribute(ctx, attr),
    ),
    statements: analyzedStatements,
    trailingExpression: analyzedTrailing,
    type,
  };
  popFrame(ctx);
  return result;
}

function analyzeStatement(
  ctx: AnalysisContext,
  statement: Parser.Statement,
): Semantics.Statement {
  switch (statement.kind) {
    case "LetStatement":
      return analyzeLetStatement(ctx, statement);
    case "ExpressionStatement":
      return {
        ...statement,
        expression: analyzeExpression(ctx, statement.expression),
        type: { kind: "UnitType", tokenId: statement.tokenId },
      };
    case "Function": {
      // Bind the function name into the current scope before analyzing the body
      // so the function is callable from subsequent statements in the same block.
      bind(ctx, statement.signature.name.text, {
        type: fnSignatureType(ctx, statement.signature),
        mutable: false,
      });
      return analyzeFunction(ctx, statement);
    }
    case "FunctionSignature": {
      emitError(
        ctx,
        "a function signature with no body is not allowed inside a block",
        statement.tokenId,
        "HEDGE-ITEM-001",
      );
      bind(ctx, statement.name.text, {
        type: fnSignatureType(ctx, statement),
        mutable: false,
      });
      return analyzeFunctionSignature(ctx, statement);
    }
    case "Struct": {
      const analyzed = lookupStruct(ctx, statement.name.text);
      assert(analyzed !== undefined, "struct not registered for this scope");
      return analyzed;
    }
    case "Enum": {
      const analyzed = lookupEnum(ctx, statement.name.text);
      assert(analyzed !== undefined, "enum not registered for this scope");
      return analyzed;
    }
    case "Const":
      // Already registered and folded by `registerConstsAndStatics`, at the
      // start of this block, so every reference within the block - before
      // or after this statement - resolves regardless of order.
      return analyzeConstStatement(ctx, statement);
    case "Static":
      // Name and type already registered by `registerConstsAndStatics`;
      // this analyzes the (runtime, not const-folded) initializer itself.
      return analyzeStaticDecl(ctx, statement);
    case "Trait":
      return analyzeTraitDecl(ctx, statement);
    case "Impl":
      return analyzeImplDecl(ctx, statement);
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
  }
}

function analyzeLetStatement(
  ctx: AnalysisContext,
  statement: Parser.LetStatement,
): Semantics.LetStatement {
  // Resolved once up front (rather than only after the initializer, as
  // every other branch below still effectively did) so a call initializer
  // can seed it into its own unification before argument-driven inference
  // runs - see `analyzeCall`'s `expectedType` parameter. Bundled with
  // `isSelf` so every use site below carries both in lockstep, rather than
  // separately re-checking `isSome(statement.type)` alongside
  // `isSome(annotation)` to prove they agree.
  const annotation: Option<{
    readonly type: Semantics.Type;
    readonly isSelf: boolean;
  }> = mapSome(statement.type, (type) => ({
    type: validateSlice1Type(ctx, type, statement.tokenId),
    isSelf: isSelfType(type),
  }));
  const analyzedInitializer: Option<Semantics.Expression> = mapSome(
    statement.initializer,
    (initializer) =>
      initializer.kind === "CallExpression" &&
      isSome(annotation) &&
      !annotation.value.isSelf
        ? analyzeCall(ctx, initializer, annotation.value.type)
        : analyzeExpression(ctx, initializer),
  );

  let coercedInitializer: Option<Semantics.Expression> = analyzedInitializer;
  let bindingType: Semantics.Type;
  if (isSome(analyzedInitializer)) {
    bindingType = getType(analyzedInitializer.value);
    if (isSome(annotation)) {
      const { expr, mismatch } = reconcileExpressionType(
        ctx,
        analyzedInitializer.value,
        annotation.value.type,
        statement.tokenId,
      );
      coercedInitializer = some(expr);
      if (mismatch && !annotation.value.isSelf) {
        emitError(
          ctx,
          "type mismatch: explicit annotation does not match initializer type",
          statement.tokenId,
          "HEDGE-TYPE-001",
        );
      }
      bindingType = annotation.value.type;
    } else if (
      analyzedInitializer.value.kind === "ArrayExpression" &&
      analyzedInitializer.value.elements.length === 0
    ) {
      emitError(
        ctx,
        "cannot infer element type of an empty array literal without an explicit type annotation",
        statement.tokenId,
        "HEDGE-TYPE-006",
      );
    }
  } else if (isSome(annotation)) {
    bindingType = annotation.value.type;
  } else {
    bindingType = { kind: "UnitType", tokenId: statement.tokenId };
  }

  if (
    isSome(coercedInitializer) &&
    coercedInitializer.value.kind === "IntLiteral"
  ) {
    checkPosLiteralRange(ctx, coercedInitializer.value, bindingType);
  }

  const pattern = analyzeLetOrParamPattern(
    ctx,
    statement.pattern,
    bindingType,
    coercedInitializer,
  );

  return {
    ...statement,
    pattern,
    attributes: statement.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    initializer: coercedInitializer,
    type: { kind: "UnitType", tokenId: statement.tokenId },
  };
}

const INT_BOUNDS: ReadonlyMap<string, readonly [bigint, bigint]> = new Map([
  ["PrimitiveI8Type", [-0x80n, 0x7fn]],
  ["PrimitiveI16Type", [-0x8000n, 0x7fffn]],
  ["PrimitiveI32Type", [-0x8000_0000n, 0x7fff_ffffn]],
  ["PrimitiveI64Type", [-0x8000_0000_0000_0000n, 0x7fff_ffff_ffff_ffffn]],
  ["PrimitiveU8Type", [0n, 0xffn]],
  ["PrimitiveU16Type", [0n, 0xffffn]],
  ["PrimitiveU32Type", [0n, 0xffff_ffffn]],
  ["PrimitiveU64Type", [0n, 0xffff_ffff_ffff_ffffn]],
  ["PrimitiveUsizeType", [0n, 0xffff_ffffn]],
  ["PrimitiveIsizeType", [-0x8000_0000n, 0x7fff_ffffn]],
]);

const NEG_FLOAT_MAX: ReadonlyMap<string, number> = new Map([
  ["PrimitiveF32Type", 3.4028234663852886e38],
  ["PrimitiveF64Type", 1.7976931348623157e308],
]);

const NUMERIC_TYPE_NAME: ReadonlyMap<string, string> = new Map([
  ["PrimitiveI8Type", "i8"],
  ["PrimitiveI16Type", "i16"],
  ["PrimitiveI32Type", "i32"],
  ["PrimitiveI64Type", "i64"],
  ["PrimitiveIsizeType", "isize"],
  ["PrimitiveU8Type", "u8"],
  ["PrimitiveU16Type", "u16"],
  ["PrimitiveU32Type", "u32"],
  ["PrimitiveU64Type", "u64"],
  ["PrimitiveUsizeType", "usize"],
  ["PrimitiveF32Type", "f32"],
  ["PrimitiveF64Type", "f64"],
]);

/**
 * Renders a {@link Semantics.Type} as the name a diagnostic should show the
 * user (`i32`, `bool`, `str`, a struct's simple name, `()`). Complements
 * {@link NUMERIC_TYPE_NAME}, which only covers the numeric kinds.
 */
// eslint-disable-next-line complexity -- Routing function over the full Type union
function describeType(type: Semantics.Type): string {
  switch (type.kind) {
    case "PrimitiveBooleanType":
      return "bool";
    case "PrimitiveStringType":
      return "str";
    case "PrimitiveCharType":
      return "char";
    case "StructType":
    case "EnumType":
      return type.name.split("::").pop() ?? type.name;
    case "UnitType":
      return "()";
    case "ReferenceType":
      return `&${type.mutable ? "mut " : ""}${describeType(type.referent)}`;
    case "ArrayType":
      return `[${describeType(type.elementType)}; ${String(type.length)}]`;
    case "PrimitiveI8Type":
    case "PrimitiveI16Type":
    case "PrimitiveI32Type":
    case "PrimitiveI64Type":
    case "PrimitiveIsizeType":
    case "PrimitiveU8Type":
    case "PrimitiveU16Type":
    case "PrimitiveU32Type":
    case "PrimitiveU64Type":
    case "PrimitiveUsizeType":
    case "PrimitiveF32Type":
    case "PrimitiveF64Type":
      return NUMERIC_TYPE_NAME.get(type.kind) ?? type.kind;
    case "NamedType":
      return type.path.segments.at(-1) ?? "unknown";
    case "FunctionType":
      return `fn(${type.params.map(describeType).join(", ")}) -> ${describeType(type.returnType)}`;
    case "Projection":
      return `${describeType(type.selfType)}::${type.assocName}`;
    case "DynType":
      return `dyn ${bareTypeName(type.traitId)}`;
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function checkNegLiteralRange(
  operand: Semantics.Expression,
  annotationType: Semantics.Type,
): Option<string> {
  const typeName = NUMERIC_TYPE_NAME.get(annotationType.kind);
  if (typeName === undefined) return none();

  if (operand.kind === "IntLiteral") {
    const val = -intLiteralValue(operand);
    const [min, max] = INT_BOUNDS.get(annotationType.kind) ?? [];
    if (min === undefined || max === undefined) {
      return some(`unexpected int-literal range check for type ${typeName}`);
    }
    if (val > max || val < min) {
      return some(`out of range for ${typeName}`);
    }
  } else if (operand.kind === "FloatLiteral") {
    const val = Number.parseFloat(operand.value);
    const max = NEG_FLOAT_MAX.get(annotationType.kind);
    if (max === undefined) {
      return some(`unexpected float-literal range check for type ${typeName}`);
    }
    if (val > max) {
      return some(`out of range for ${typeName}`);
    }
  }
  return none();
}

function checkPosLiteralRange(
  ctx: AnalysisContext,
  literal: Semantics.IntLiteral,
  type: Semantics.Type,
): void {
  const bounds = INT_BOUNDS.get(type.kind);
  if (bounds === undefined) return;
  const val = intLiteralValue(literal);
  const [, max] = bounds;
  if (val > max) {
    const name = NUMERIC_TYPE_NAME.get(type.kind) ?? type.kind;
    emitError(
      ctx,
      `out of range for ${name}`,
      literal.tokenId,
      "HEDGE-TYPE-005",
    );
  }
}

/**
 * Binary operators whose result type is their operand type, so an expected
 * type flows down into both operands. Comparison and logical operators
 * produce `bool` regardless of what they are given, so an expected integer
 * type must never propagate through one.
 */
const TYPE_PRESERVING_BINARY_OPS: ReadonlySet<Parser.BinaryOperator> = new Set([
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Rem",
  "Shl",
  "Shr",
  "BitAnd",
  "BitXor",
  "BitOr",
]);

/**
 * Whether an expected integer type can be pushed into `expr`. Recurses,
 * because coercing only the outermost node would leave the operands at the
 * default `i32` and fail the annotation check against them.
 */
function isUnsuffixedLiteralExpr(expr: Semantics.Expression): boolean {
  if (expr.kind === "IntLiteral" && !isSome(expr.suffix)) return true;
  if (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral" &&
    !isSome(expr.operand.suffix)
  ) {
    return true;
  }
  return (
    expr.kind === "BinaryExpression" &&
    TYPE_PRESERVING_BINARY_OPS.has(expr.operator) &&
    isUnsuffixedLiteralExpr(expr.left) &&
    isUnsuffixedLiteralExpr(expr.right)
  );
}

function coerceToIntegerType(
  expr: Semantics.Expression,
  targetType: Semantics.Type,
): Semantics.Expression {
  if (!isIntegerType(targetType)) return expr;
  if (expr.kind === "IntLiteral" && !isSome(expr.suffix)) {
    return { ...expr, type: targetType };
  }
  if (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral" &&
    !isSome(expr.operand.suffix)
  ) {
    return {
      ...expr,
      type: targetType,
      operand: { ...expr.operand, type: targetType },
    };
  }
  if (
    expr.kind === "BinaryExpression" &&
    TYPE_PRESERVING_BINARY_OPS.has(expr.operator) &&
    isUnsuffixedLiteralExpr(expr)
  ) {
    return {
      ...expr,
      type: targetType,
      left: coerceToIntegerType(expr.left, targetType),
      right: coerceToIntegerType(expr.right, targetType),
    };
  }
  return expr;
}

function checkCoercedLiteralRange(
  ctx: AnalysisContext,
  expr: Semantics.Expression,
): void {
  if (expr.kind === "IntLiteral") {
    checkPosLiteralRange(ctx, expr, expr.type);
  } else if (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral"
  ) {
    const rangeError = checkNegLiteralRange(expr.operand, expr.type);
    if (isSome(rangeError)) {
      emitError(ctx, rangeError.value, expr.operand.tokenId, "HEDGE-TYPE-005");
    }
  } else if (expr.kind === "BinaryExpression") {
    checkCoercedLiteralRange(ctx, expr.left);
    checkCoercedLiteralRange(ctx, expr.right);
  }
}

/**
 * Structural equality of two resolved types. A `NamedType` here is a
 * still-abstract generic parameter, compared by name. `FunctionType` is
 * compared by kind alone - its parameter and return types are not checked.
 * The final group is every payload-free primitive plus
 * `UnitType`: matching `kind` (already established by the guard) is the
 * whole comparison, and the exhaustive switch forces a new payload-bearing
 * `Type` variant to be classified here rather than silently landing in it.
 */
// eslint-disable-next-line complexity -- Routing function over the full Type union
function typesEqual(a: Semantics.Type, b: Semantics.Type): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "StructType":
      return b.kind === "StructType" && a.name === b.name;
    case "EnumType":
      return b.kind === "EnumType" && a.name === b.name;
    case "NamedType":
      return (
        b.kind === "NamedType" &&
        a.path.segments.join("::") === b.path.segments.join("::")
      );
    case "ReferenceType":
      return (
        b.kind === "ReferenceType" &&
        a.mutable === b.mutable &&
        typesEqual(a.referent, b.referent)
      );
    case "ArrayType":
      return (
        b.kind === "ArrayType" &&
        a.length === b.length &&
        typesEqual(a.elementType, b.elementType)
      );
    case "Projection":
      return (
        b.kind === "Projection" &&
        a.traitName === b.traitName &&
        a.assocName === b.assocName &&
        typesEqual(a.selfType, b.selfType)
      );
    case "DynType":
      return b.kind === "DynType" && a.traitId === b.traitId;
    case "FunctionType":
    case "UnitType":
    case "PrimitiveI8Type":
    case "PrimitiveI16Type":
    case "PrimitiveI32Type":
    case "PrimitiveI64Type":
    case "PrimitiveIsizeType":
    case "PrimitiveU8Type":
    case "PrimitiveU16Type":
    case "PrimitiveU32Type":
    case "PrimitiveU64Type":
    case "PrimitiveUsizeType":
    case "PrimitiveF32Type":
    case "PrimitiveF64Type":
    case "PrimitiveBooleanType":
    case "PrimitiveCharType":
    case "PrimitiveStringType":
      return true;
    default:
      return assertNever(a, `Unexpected type: ${JSON.stringify(a)}`);
  }
}

function isIntegerType(type: Semantics.Type): boolean {
  return (
    type.kind === "PrimitiveI8Type" ||
    type.kind === "PrimitiveI16Type" ||
    type.kind === "PrimitiveI32Type" ||
    type.kind === "PrimitiveI64Type" ||
    type.kind === "PrimitiveIsizeType" ||
    type.kind === "PrimitiveU8Type" ||
    type.kind === "PrimitiveU16Type" ||
    type.kind === "PrimitiveU32Type" ||
    type.kind === "PrimitiveU64Type" ||
    type.kind === "PrimitiveUsizeType"
  );
}

/**
 * Kinds whose `UnitType` result can only be the error-recovery placeholder
 * for a failed sub-analysis (unresolved name/field/struct, or a Slice-1
 * not-yet-implemented construct), or a type inherited/propagated from such
 * a placeholder (`BinaryExpression`/`UnaryExpression`, which never compute
 * `UnitType` themselves - only ever pass one through from an operand) -
 * never a genuine unit value. A `UnitType` from one of these suppresses a
 * redundant diagnostic, since the failure already reported its own error
 * (or, for not-yet-implemented constructs, isn't a reliable type signal
 * yet). A `UnitType` from anything else (`CallExpression`, `Block`,
 * `AssignExpression`, `CompoundAssignExpression`, `IfExpression`, ...) is
 * genuine and must be compared normally.
 */
const AMBIGUOUS_UNIT_EXPR_KINDS: ReadonlySet<Semantics.ExpressionKind> =
  new Set([
    "PathExpression",
    "FieldAccessExpression",
    "StructExpression",
    "MethodCallExpression",
    "IndexExpression",
    "BinaryExpression",
    "UnaryExpression",
    "TupleExpression",
    "RangeExpression",
    "ReferenceExpression",
    "DereferenceExpression",
    "ArrayRepeatExpression",
  ]);

function isAmbiguousUnitExpr(expr: Semantics.Expression): boolean {
  return AMBIGUOUS_UNIT_EXPR_KINDS.has(expr.kind);
}

/**
 * Reconciles an analyzed expression against an `expectedType` context - a
 * `let` binding's explicit annotation, a function's declared return type, or
 * a struct field's declared type - applying Slice 1's unsuffixed-integer-
 * literal coercion (0010-primitive-types.md: an unconstrained literal adopts
 * the type its context expects) and negative-literal range checks before
 * falling back to a plain type-equality comparison.
 *
 * Callers are responsible for (a) emitting their own call-site-specific
 * message when `mismatch` is true, and (b) running {@link checkPosLiteralRange}
 * on the result if it is an `IntLiteral` - kept out of this helper so each
 * call site performs the positive-range check exactly once.
 *
 * Cascade guard: `mismatch` is always `false` when the resolved expression's
 * type is the `UnitType` error-recovery placeholder (see
 * {@link isAmbiguousUnitExpr}) - that failure already reported its own
 * diagnostic. A genuinely unit-typed result (e.g. a `print(...)` call) is
 * compared normally, not suppressed.
 */
// eslint-disable-next-line complexity -- Reconciliation checks several independent coercion cases in sequence
function reconcileExpressionType(
  ctx: AnalysisContext,
  expr: Semantics.Expression,
  expectedType: Semantics.Type,
  tokenId: number,
): { expr: Semantics.Expression; mismatch: boolean } {
  let result = expr;
  let suppressed = false;

  if (isUnsuffixedLiteralExpr(expr) && isIntegerType(expectedType)) {
    result = coerceToIntegerType(expr, expectedType);
    if (result.kind === "BinaryExpression") {
      // No single literal for the caller to range-check, unlike the bare case.
      checkCoercedLiteralRange(ctx, result);
    }
    suppressed = true;
  }

  // An empty array literal (`[]`) has no element to infer a type from -
  // `analyzeArrayExpression` gives it an ambiguous `elementType: UnitType`
  // placeholder that only resolves once an explicit `[T; 0]` annotation is
  // in view, mirroring the unsuffixed-literal coercion just above.
  if (
    expr.kind === "ArrayExpression" &&
    expr.elements.length === 0 &&
    expectedType.kind === "ArrayType" &&
    expectedType.length === 0
  ) {
    result = { ...expr, type: expectedType };
    suppressed = true;
  }

  if (
    result.kind === "UnaryExpression" &&
    result.operator === "Neg" &&
    result.operand.kind === "IntLiteral" &&
    !isSome(result.operand.suffix)
  ) {
    const rangeError = checkNegLiteralRange(result.operand, expectedType);
    if (isSome(rangeError)) {
      emitError(ctx, rangeError.value, tokenId, "HEDGE-TYPE-005");
      suppressed = true;
    }
  }

  const resultType = getType(result);
  const mismatch =
    !suppressed &&
    (resultType.kind !== "UnitType" || !isAmbiguousUnitExpr(result)) &&
    !typesEqual(expectedType, resultType);

  return { expr: result, mismatch };
}

interface ComparisonOperand {
  readonly type: Semantics.Type;
  readonly isValid: boolean;
}

interface ComparisonSpec {
  readonly capability: TypeCapability;
  readonly errorMessage: string;
}

/**
 * Shared shape for `Eq`/`Ne` and `Lt`/`Gt`/`Le`/`Ge`: a missing capability
 * on either side is one error (`spec.errorMessage`); two individually valid
 * but differently-typed operands is a second, shared error - this text is
 * identical for both operator groups in the original code, not a
 * coincidence being papered over here.
 */
function inferComparisonType(
  ctx: AnalysisContext,
  spec: ComparisonSpec,
  left: ComparisonOperand,
  right: ComparisonOperand,
  tokenId: number,
): Semantics.Type {
  const leftOk = !left.isValid || hasCapability(left.type, spec.capability);
  const rightOk = !right.isValid || hasCapability(right.type, spec.capability);
  if (!leftOk || !rightOk) {
    // TODO(Hedge-265): equality should fall through to a resolved
    // PartialEq/Eq impl here instead of rejecting outright.
    // TODO(Hedge-279): same gap for ordering (PartialOrd/Ord).
    emitError(ctx, spec.errorMessage, tokenId, "HEDGE-TYPE-002");
  } else if (
    left.isValid &&
    right.isValid &&
    !typesEqual(left.type, right.type)
  ) {
    emitError(
      ctx,
      "comparison operands must have the same type",
      tokenId,
      "HEDGE-TYPE-003",
    );
  }
  return { kind: "PrimitiveBooleanType" };
}

function inferLogicalType(
  ctx: AnalysisContext,
  leftType: Semantics.Type,
  rightType: Semantics.Type,
  isLeftTypeValid: boolean,
  isRightTypeValid: boolean,
  tokenId: number,
): Semantics.Type {
  if (isLeftTypeValid && !hasCapability(leftType, "logical")) {
    emitError(
      ctx,
      "logical operator operands must be `bool`",
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  if (isRightTypeValid && !hasCapability(rightType, "logical")) {
    emitError(
      ctx,
      "logical operator operands must be `bool`",
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  return { kind: "PrimitiveBooleanType" };
}

function inferArithmeticType(
  ctx: AnalysisContext,
  leftType: Semantics.Type,
  rightType: Semantics.Type,
  isLeftTypeValid: boolean,
  isRightTypeValid: boolean,
  tokenId: number,
): Semantics.Type {
  // TODO(Hedge-280): no fallback to an Add/Sub/Mul/Div/Rem-style operator
  // trait yet - a struct or enum operand is always rejected here.
  if (isLeftTypeValid && !hasCapability(leftType, "arithmetic")) {
    emitError(
      ctx,
      `arithmetic operands must be numeric; left-operand is type \`${describeType(leftType)}\``,
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  if (isRightTypeValid && !hasCapability(rightType, "arithmetic")) {
    emitError(
      ctx,
      `arithmetic operands must be numeric; right-operand is type \`${describeType(rightType)}\``,
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  if (isLeftTypeValid && isRightTypeValid && !typesEqual(leftType, rightType)) {
    emitError(
      ctx,
      "arithmetic operands must have the same type",
      tokenId,
      "HEDGE-TYPE-003",
    );
  }
  return isLeftTypeValid ? leftType : rightType;
}

/**
 * A shift amount is independent of the shifted value's type (matching
 * Rust), unlike the other bitwise operators below, which combine two
 * values of one type - so unlike `inferBitwiseType`, there is no
 * same-type check here.
 */
function inferShiftType(
  ctx: AnalysisContext,
  leftType: Semantics.Type,
  rightType: Semantics.Type,
  isLeftTypeValid: boolean,
  isRightTypeValid: boolean,
  tokenId: number,
): Semantics.Type {
  // TODO(Hedge-280): no fallback to a Shl/Shr-style operator trait yet.
  if (isLeftTypeValid && !hasCapability(leftType, "bitwise")) {
    emitError(
      ctx,
      "the shifted value must be an integer",
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  if (isRightTypeValid && !hasCapability(rightType, "bitwise")) {
    emitError(
      ctx,
      "the shift amount must be an integer",
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  return isLeftTypeValid ? leftType : rightType;
}

function inferBitwiseType(
  ctx: AnalysisContext,
  leftType: Semantics.Type,
  rightType: Semantics.Type,
  isLeftTypeValid: boolean,
  isRightTypeValid: boolean,
  tokenId: number,
): Semantics.Type {
  // TODO(Hedge-280): no fallback to a BitAnd/BitOr/BitXor-style operator
  // trait yet.
  if (isLeftTypeValid && !hasCapability(leftType, "bitwise")) {
    emitError(
      ctx,
      "bitwise operations require integer operands",
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  if (isRightTypeValid && !hasCapability(rightType, "bitwise")) {
    emitError(
      ctx,
      "bitwise operations require integer operands",
      tokenId,
      "HEDGE-TYPE-002",
    );
  }
  if (isLeftTypeValid && isRightTypeValid && !typesEqual(leftType, rightType)) {
    emitError(
      ctx,
      "bitwise operands must have the same type",
      tokenId,
      "HEDGE-TYPE-003",
    );
  }
  return isLeftTypeValid ? leftType : rightType;
}

// eslint-disable-next-line complexity -- Routing function; each case is one line dispatching to a named helper
function inferBinaryType(
  ctx: AnalysisContext,
  op: Parser.BinaryOperator,
  left: Semantics.Expression,
  right: Semantics.Expression,
  tokenId: number,
): Semantics.Type {
  const leftType = getType(left);
  const rightType = getType(right);

  // UnitType is ambiguous: it's either the error-recovery placeholder from a
  // failed sub-analysis, or a genuine unit value (e.g. a `print(...)` call).
  // Only suppress cascading type errors for the former - see
  // isAmbiguousUnitExpr.
  const isLeftTypeValid =
    leftType.kind !== "UnitType" || !isAmbiguousUnitExpr(left);
  const isRightTypeValid =
    rightType.kind !== "UnitType" || !isAmbiguousUnitExpr(right);

  switch (op) {
    case "Eq":
    case "Ne":
      return inferComparisonType(
        ctx,
        {
          capability: "equality",
          errorMessage: "type does not support equality comparison",
        },
        { type: leftType, isValid: isLeftTypeValid },
        { type: rightType, isValid: isRightTypeValid },
        tokenId,
      );
    case "Lt":
    case "Gt":
    case "Le":
    case "Ge":
      return inferComparisonType(
        ctx,
        {
          capability: "ordering",
          errorMessage: "type does not support ordering comparison",
        },
        { type: leftType, isValid: isLeftTypeValid },
        { type: rightType, isValid: isRightTypeValid },
        tokenId,
      );
    case "And":
    case "Or":
      return inferLogicalType(
        ctx,
        leftType,
        rightType,
        isLeftTypeValid,
        isRightTypeValid,
        tokenId,
      );
    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "Rem":
      return inferArithmeticType(
        ctx,
        leftType,
        rightType,
        isLeftTypeValid,
        isRightTypeValid,
        tokenId,
      );
    case "Shl":
    case "Shr":
      return inferShiftType(
        ctx,
        leftType,
        rightType,
        isLeftTypeValid,
        isRightTypeValid,
        tokenId,
      );
    case "BitAnd":
    case "BitXor":
    case "BitOr":
      return inferBitwiseType(
        ctx,
        leftType,
        rightType,
        isLeftTypeValid,
        isRightTypeValid,
        tokenId,
      );
    default:
      return assertNever(
        op,
        `Unexpected binary operator: ${JSON.stringify(op)}`,
      );
  }
}

/**
 * `!` is logical negation on `bool` and bitwise negation on an integer,
 * mirroring Rust; either way the result keeps the operand's type. Anything
 * else has no meaning to give it.
 */
function unaryNotResultType(
  ctx: AnalysisContext,
  operand: Semantics.Expression,
  tokenId: number,
): Semantics.Type {
  const operandType = getType(operand);
  // TODO(Hedge-280): no fallback to a Not-style operator trait yet.
  if (
    hasCapability(operandType, "logical") ||
    hasCapability(operandType, "bitwise")
  ) {
    return operandType;
  }
  if (operandType.kind === "UnitType" && isAmbiguousUnitExpr(operand)) {
    return operandType;
  }
  emitError(
    ctx,
    `\`!\` requires \`bool\` or an integer, found \`${describeType(operandType)}\``,
    tokenId,
    "HEDGE-TYPE-002",
  );
  return { kind: "PrimitiveBooleanType" };
}

function analyzePathExpression(
  ctx: AnalysisContext,
  expression: Parser.PathExpression,
): Semantics.Expression {
  const constRef = analyzeConstReference(ctx, expression);
  if (isSome(constRef)) return constRef.value;
  const staticRef = analyzeStaticReference(ctx, expression);
  if (isSome(staticRef)) return staticRef.value;
  return analyzePath(ctx, expression);
}

function analyzeBinaryExpression(
  ctx: AnalysisContext,
  expression: Parser.BinaryExpression,
): Semantics.BinaryExpression {
  let left = analyzeExpression(ctx, expression.left);
  let right = analyzeExpression(ctx, expression.right);
  const isLeftUnsuffixed = isUnsuffixedLiteralExpr(left);
  const isRightUnsuffixed = isUnsuffixedLiteralExpr(right);
  if (isLeftUnsuffixed && !isRightUnsuffixed) {
    left = coerceToIntegerType(left, getType(right));
    checkCoercedLiteralRange(ctx, left);
  } else if (!isLeftUnsuffixed && isRightUnsuffixed) {
    right = coerceToIntegerType(right, getType(left));
    checkCoercedLiteralRange(ctx, right);
  }
  const type = inferBinaryType(
    ctx,
    expression.operator,
    left,
    right,
    expression.tokenId,
  );
  return { ...expression, left, right, type };
}

function analyzeUnaryExpression(
  ctx: AnalysisContext,
  expression: Parser.UnaryExpression,
): Semantics.UnaryExpression {
  const operand =
    expression.operator === "Neg" && expression.operand.kind === "IntLiteral"
      ? analyzeIntLiteral(ctx, expression.operand, true)
      : analyzeExpression(ctx, expression.operand);
  const type: Semantics.Type =
    expression.operator === "Not"
      ? unaryNotResultType(ctx, operand, expression.tokenId)
      : getType(operand);
  if (
    expression.operator === "Neg" &&
    operand.kind === "IntLiteral" &&
    isSome(operand.suffix)
  ) {
    const rangeError = checkNegLiteralRange(operand, type);
    if (isSome(rangeError))
      emitError(ctx, rangeError.value, operand.tokenId, "HEDGE-TYPE-005");
  }
  return { ...expression, operand, type };
}

function analyzeMethodCallExpression(
  ctx: AnalysisContext,
  expression: Parser.MethodCallExpression,
): Semantics.MethodCallExpression {
  const receiver = analyzeExpression(ctx, expression.receiver);
  return {
    ...expression,
    receiver,
    method: {
      ...expression.method,
      type: { kind: "UnitType", tokenId: expression.method.tokenId },
    },
    arguments: expression.arguments.map((arg) => analyzeExpression(ctx, arg)),
    type: { kind: "UnitType", tokenId: expression.tokenId },
  };
}

function analyzeTupleExpression(
  ctx: AnalysisContext,
  expression: Parser.TupleExpression,
): Semantics.TupleExpression {
  return {
    ...expression,
    elements: expression.elements.map((elem) => analyzeExpression(ctx, elem)),
    type: { kind: "UnitType", tokenId: expression.tokenId },
  };
}

function analyzeRangeExpression(
  ctx: AnalysisContext,
  expression: Parser.RangeExpression,
): Semantics.RangeExpression {
  return {
    ...expression,
    start: mapSome(expression.start, (expr) => analyzeExpression(ctx, expr)),
    end: mapSome(expression.end, (expr) => analyzeExpression(ctx, expr)),
    type: { kind: "UnitType", tokenId: expression.tokenId },
  };
}

function analyzeIdentifierExpression(
  ctx: AnalysisContext,
  expression: Parser.Identifier,
): Semantics.Expression {
  return analyzePath(ctx, {
    ...expression,
    kind: "PathExpression",
    path: { absolute: false, segments: [expression.text] },
    typeArguments: [],
  });
}

// eslint-disable-next-line complexity -- Routing function; each case is one line dispatching to a named helper
function analyzeExpression(
  ctx: AnalysisContext,
  expression: Parser.Expression,
): Semantics.Expression {
  switch (expression.kind) {
    case "StringLiteral":
      return analyzeStringLiteral(ctx, expression);
    case "IntLiteral":
      return analyzeIntLiteral(ctx, expression);
    case "FloatLiteral":
      return analyzeFloatLiteral(ctx, expression);
    case "BoolLiteral":
      return analyzeBoolLiteral(ctx, expression);
    case "CharLiteral":
      return analyzeCharLiteral(ctx, expression);
    case "PathExpression":
      return analyzePathExpression(ctx, expression);
    case "CallExpression":
      return analyzeCall(ctx, expression);
    case "ReferenceExpression":
      return analyzeReferenceExpression(ctx, expression);
    case "DereferenceExpression":
      return analyzeDereferenceExpression(ctx, expression);
    case "BinaryExpression":
      return analyzeBinaryExpression(ctx, expression);
    case "UnaryExpression":
      return analyzeUnaryExpression(ctx, expression);
    case "AssignExpression":
      return analyzeAssignmentExpression(ctx, expression);
    case "CompoundAssignExpression":
      return analyzeCompoundAssignmentExpression(ctx, expression);
    case "FieldAccessExpression":
      return analyzeFieldAccessExpression(ctx, expression);
    case "MethodCallExpression":
      return analyzeMethodCallExpression(ctx, expression);
    case "IndexExpression":
      return analyzeIndexExpression(ctx, expression);
    case "TupleExpression":
      return analyzeTupleExpression(ctx, expression);
    case "ArrayExpression":
      return analyzeArrayExpression(ctx, expression);
    case "ArrayRepeatExpression":
      return analyzeArrayRepeatExpression(ctx, expression);
    case "RangeExpression":
      return analyzeRangeExpression(ctx, expression);
    case "StructExpression":
      return analyzeStructExpression(ctx, expression);
    case "IfExpression":
      return analyzeIfExpression(ctx, expression);
    case "LetExpression":
      // The parser only constructs a LetExpression as an if/while condition,
      // and analyzeIfExpression intercepts it first - reaching here should
      // be impossible.
      throw new Error(
        "a LetExpression reached generic expression analysis outside an if condition, which should be structurally impossible",
      );
    case "MatchExpression":
      return analyzeMatchExpression(ctx, expression);
    case "WhileExpression":
      return analyzeExpressionPlaceholder(
        ctx,
        expression.tokenId,
        WHILE_NOT_YET_SUPPORTED_MESSAGE,
      );
    case "Block":
      return analyzeBlock(ctx, expression);
    case "Identifier":
      return analyzeIdentifierExpression(ctx, expression);
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

/**
 * A borrow's operand is a legal place when it is a projection chain - any
 * combination of `FieldAccessExpression`/`IndexExpression`/
 * `DereferenceExpression` - grounded at its root in a bare local binding or
 * parameter name (a single-segment, non-absolute `PathExpression`). This
 * widens the original bare-local-only restriction on a borrow's operand;
 * `ownership/borrowck.ts`'s `resolveBorrowBases`/place model widens in
 * lockstep to resolve the same root to a `BindingId` and walk the same
 * projection chain for conflict-checking and write-capability checking, so
 * accepting a wider set of operands here never outpaces what `borrowck.ts`
 * can actually reason about - the soundness gap this guard originally
 * existed to prevent.
 */
// eslint-disable-next-line complexity -- Routing function over the full Expression union
function isBorrowablePlace(expr: Parser.Expression): boolean {
  switch (expr.kind) {
    case "PathExpression":
      return expr.path.segments.length === 1 && !expr.path.absolute;
    case "FieldAccessExpression":
      return isBorrowablePlace(expr.object);
    case "IndexExpression":
      return isBorrowablePlace(expr.object);
    case "DereferenceExpression":
      return isBorrowablePlace(expr.operand);
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
    case "CallExpression":
    case "ReferenceExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "AssignExpression":
    case "CompoundAssignExpression":
    case "MethodCallExpression":
    case "TupleExpression":
    case "ArrayExpression":
    case "ArrayRepeatExpression":
    case "StructExpression":
    case "RangeExpression":
    case "IfExpression":
    case "LetExpression":
    case "MatchExpression":
    case "WhileExpression":
    case "Block":
    case "Identifier":
      // Not grounded in a binding, so there is no place to borrow.
      return false;
    default:
      return assertNever(
        expr,
        `Unexpected expression: ${JSON.stringify(expr)}`,
      );
  }
}

function analyzeReferenceExpression(
  ctx: AnalysisContext,
  expression: Parser.ReferenceExpression,
): Semantics.ReferenceExpression {
  const operand = analyzeExpression(ctx, expression.operand);

  if (!isBorrowablePlace(expression.operand)) {
    emitError(
      ctx,
      "only a local binding, a parameter, or a field, index, or dereference of one can be borrowed directly",
      expression.tokenId,
      "HEDGE-BORROW-CHECK-005",
    );
    return {
      ...expression,
      operand,
      type: { kind: "UnitType", tokenId: expression.tokenId },
    };
  }

  return {
    ...expression,
    operand,
    type: {
      kind: "ReferenceType",
      tokenId: expression.tokenId,
      mutable: expression.mutable,
      referent: getType(operand),
    },
  };
}

function analyzeDereferenceExpression(
  ctx: AnalysisContext,
  expression: Parser.DereferenceExpression,
): Semantics.DereferenceExpression {
  const operand = analyzeExpression(ctx, expression.operand);
  const operandType = getType(operand);

  if (operandType.kind !== "ReferenceType") {
    // A UnitType operand from one of `isAmbiguousUnitExpr`'s buckets is
    // itself an error-recovery placeholder (e.g. an unresolved name) that
    // already emitted its own diagnostic - reporting a second one here would
    // be a cascade, not a genuine second fault.
    if (!(operandType.kind === "UnitType" && isAmbiguousUnitExpr(operand))) {
      emitError(
        ctx,
        "cannot dereference a non-reference type",
        expression.tokenId,
        "HEDGE-TYPE-007",
      );
    }
    return {
      ...expression,
      operand,
      type: { kind: "UnitType", tokenId: expression.tokenId },
    };
  }

  return { ...expression, operand, type: operandType.referent };
}

const USIZE_TYPE: Semantics.PrimitiveType = { kind: "PrimitiveUsizeType" };

/**
 * `[a, b, c]` infers its element type from the first element and requires
 * every other element to match it (no fallback to `UnitType` per element -
 * a genuinely mismatched element gets its own diagnostic, not a cascade). An
 * empty literal (`[]`) has no element to infer from; its `type` here is an
 * ambiguous placeholder (`elementType: UnitType`) that only resolves
 * successfully when `analyzeLetStatement` reconciles it against an explicit
 * `[T; 0]` annotation - see that function's own handling. An element type
 * need not be `Copy` - `[T; N]` is itself always move-only regardless of
 * `T` (see `type-capabilities.ts`), and a non-Copy element disposes via the
 * recursive array-disposal helper (`codegen/generator.ts`'s
 * `ARRAY_DISPOSE_HELPER`), so there is nothing left for this function to
 * reject on that basis.
 */
function analyzeArrayExpression(
  ctx: AnalysisContext,
  expression: Parser.ArrayExpression,
): Semantics.ArrayExpression {
  const elements = expression.elements.map((elem) =>
    analyzeExpression(ctx, elem),
  );
  const first = elements[0];
  if (first === undefined) {
    return {
      ...expression,
      elements,
      type: { kind: "ArrayType", elementType: UNIT, length: 0 },
    };
  }
  const elementType = getType(first);
  for (const elem of elements.slice(1)) {
    const elemType = getType(elem);
    if (!typesEqual(elementType, elemType)) {
      emitError(
        ctx,
        `array elements must all have the same type; expected \`${describeType(elementType)}\`, found \`${describeType(elemType)}\``,
        elem.tokenId,
        "HEDGE-TYPE-003",
      );
      break;
    }
  }
  return {
    ...expression,
    elements,
    type: { kind: "ArrayType", elementType, length: elements.length },
  };
}

/** `[value; count]` - `count` must const-fold to a known integer (see `foldArrayLength`). */
function analyzeArrayRepeatExpression(
  ctx: AnalysisContext,
  expression: Parser.ArrayRepeatExpression,
): Semantics.ArrayRepeatExpression {
  const value = analyzeExpression(ctx, expression.value);
  const valueType = getType(value);
  if (!hasCapability(valueType, "copy")) {
    // Unlike the list form (each element its own expression), `value` is
    // evaluated once and codegen reuses the same result for every slot via
    // `.fill(value)` - a non-Copy value would alias the identical JS object
    // reference across the whole array instead of each slot holding a
    // distinct value. Matches Rust's own `[expr; N]` rule (`expr: Copy`, or
    // a const item - a const reference here is already inlined to a Copy
    // literal by `analyzeConstReference` before this check runs, so a
    // primitive const's value naturally passes; a struct-typed const isn't
    // in this ticket's const-eval scope, so still hits this diagnostic).
    emitError(
      ctx,
      `repeat-form array element type must be Copy, found \`${describeType(valueType)}\``,
      expression.value.tokenId,
      "HEDGE-TYPE-002",
    );
    return { ...expression, value, count: 0, type: UNIT };
  }
  const count = foldArrayLength(ctx, expression.count);
  if (!isSome(count)) {
    return { ...expression, value, count: 0, type: UNIT };
  }
  return {
    ...expression,
    value,
    count: count.value,
    type: {
      kind: "ArrayType",
      elementType: getType(value),
      length: count.value,
    },
  };
}

function analyzeIndexExpression(
  ctx: AnalysisContext,
  expression: Parser.IndexExpression,
): Semantics.IndexExpression {
  const object = analyzeExpression(ctx, expression.object);
  const rawIndex = analyzeExpression(ctx, expression.index);
  const { expr: index, mismatch: indexMismatch } = reconcileExpressionType(
    ctx,
    rawIndex,
    USIZE_TYPE,
    expression.index.tokenId,
  );
  const objectType = getType(object);

  if (objectType.kind === "UnitType") {
    return { ...expression, object, index, type: UNIT };
  }

  // Indexing reaches through a borrow automatically (spec 0005), mirroring
  // field access - resolve against the referent's type.
  const arrayType =
    objectType.kind === "ReferenceType" ? objectType.referent : objectType;

  if (arrayType.kind !== "ArrayType") {
    emitError(
      ctx,
      `cannot index into non-array type \`${describeType(objectType)}\``,
      expression.tokenId,
      "HEDGE-TYPE-007",
    );
    return { ...expression, object, index, type: UNIT };
  }

  if (indexMismatch) {
    emitError(
      ctx,
      `array index must be \`usize\`, found \`${describeType(getType(index))}\``,
      expression.index.tokenId,
      "HEDGE-TYPE-001",
    );
    return { ...expression, object, index, type: arrayType.elementType };
  }

  if (index.kind === "IntLiteral") {
    const literalIndex = Number(intLiteralValue(index));
    if (literalIndex < 0 || literalIndex >= arrayType.length) {
      emitError(
        ctx,
        `index ${String(literalIndex)} out of bounds for array of length ${String(arrayType.length)}`,
        expression.index.tokenId,
        "HEDGE-TYPE-005",
      );
    }
  }

  return { ...expression, object, index, type: arrayType.elementType };
}

function analyzeFieldAccessExpression(
  ctx: AnalysisContext,
  expression: Parser.FieldAccessExpression,
): Semantics.FieldAccessExpression {
  const object = analyzeExpression(ctx, expression.object);
  const objectType = getType(object);
  const unresolved = (): Semantics.FieldAccessExpression => ({
    ...expression,
    object,
    field: { ...expression.field, type: UNIT },
    type: UNIT,
  });

  if (objectType.kind === "UnitType") return unresolved();

  // Field access reaches through a borrow automatically (spec 0005),
  // shared or mutable alike - resolve against the referent's type.
  const structType =
    objectType.kind === "ReferenceType" ? objectType.referent : objectType;

  if (structType.kind !== "StructType") {
    emitError(
      ctx,
      "field access on non-struct type",
      expression.field.tokenId,
      "HEDGE-TYPE-007",
    );
    return unresolved();
  }

  const structName = structType.name.split("::").pop() ?? structType.name;
  const structDecl = lookupStruct(ctx, structName);
  const fieldName = expression.field.text;

  if (structDecl === undefined) {
    return unresolved();
  }
  if (structDecl.body.kind !== "NamedFields") {
    emitError(
      ctx,
      `no field \`${fieldName}\` on struct \`${structName}\``,
      expression.field.tokenId,
      "HEDGE-NAME-003",
    );
    return unresolved();
  }

  const matchedField = structDecl.body.fields.find(
    (f) => f.name.text === fieldName,
  );
  if (matchedField === undefined) {
    emitError(
      ctx,
      `no field \`${fieldName}\` on struct \`${structName}\``,
      expression.field.tokenId,
      "HEDGE-NAME-003",
    );
    return unresolved();
  }

  return {
    ...expression,
    object,
    field: { ...expression.field, type: matchedField.type },
    type: matchedField.type,
  };
}

type PlaceMutabilityViolation = "immutable-binding" | "shared-reference";

/**
 * A place expression's writability, checked recursively:
 * - Any place reached *through* a projection (`isRoot: false`) whose own
 *   type is a reference stops the walk immediately: write permission comes
 *   from that reference's own mutability from that point on, regardless of
 *   what contains it (`let mut r = &foo;` still can't write through the
 *   shared `r`; conversely `foo.b.value = 2` is fine when `foo.b: &mut Bar`
 *   even though `foo` itself isn't `mut` - the reference field's own
 *   mutability is what governs, not the struct holding it).
 * - A bare identifier at the *root* of the lhs (not reached through a
 *   projection) is writable exactly when its own binding is `let mut` -
 *   this is the "rebind the binding itself" case (`r = &mut y;`), which
 *   never gets the reference-type bypass above since it's never `isRoot:
 *   false`.
 * - `place.field`/`place[index]` is writable exactly when `place` is
 *   (falling through to the recursive call when the reference-type check
 *   above didn't already resolve it).
 * - `*r` is writable exactly when `r`'s own type is a mutable reference -
 *   this doesn't recurse into whether `r` itself is a writable place, since
 *   what matters is the pointer's type, not how it was produced. (`*r`'s
 *   own type is always the referent, never a reference itself, so this
 *   never overlaps with the reference-type check above.)
 *
 * Returns `undefined` for a genuinely writable place, or for any lhs shape
 * this function doesn't track (multi-segment paths, an unresolved name) -
 * matching this check's original permissive default.
 */
// eslint-disable-next-line complexity -- This is a routing function
function placeMutabilityViolation(
  ctx: AnalysisContext,
  expr: Semantics.Expression,
  isRoot: boolean,
): Option<PlaceMutabilityViolation> {
  const exprType = getType(expr);
  if (!isRoot && exprType.kind === "ReferenceType") {
    return exprType.mutable ? none() : some("shared-reference");
  }

  switch (expr.kind) {
    case "PathExpression": {
      if (expr.path.segments.length !== 1) return none();
      const name = expr.path.segments[0];
      assert(name !== undefined, "Name segment missing");
      const resolved = resolve(ctx, name);
      if (!isSome(resolved)) return none();
      return resolved.value.mutable ? none() : some("immutable-binding");
    }
    case "FieldAccessExpression":
      return placeMutabilityViolation(ctx, expr.object, false);
    case "IndexExpression":
      return placeMutabilityViolation(ctx, expr.object, false);
    case "DereferenceExpression": {
      const operandType = getType(expr.operand);
      if (operandType.kind === "ReferenceType" && !operandType.mutable) {
        return some("shared-reference");
      }
      return none();
    }
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
    case "CallExpression":
    case "ReferenceExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "AssignExpression":
    case "CompoundAssignExpression":
    case "MethodCallExpression":
    case "TupleExpression":
    case "ArrayExpression":
    case "ArrayRepeatExpression":
    case "RangeExpression":
    case "StructExpression":
    case "IfExpression":
    case "LetExpression":
    case "MatchExpression":
    case "Block":
      // Not a place, so there is no binding whose mutability could be violated.
      return none();
    default:
      return assertNever(
        expr,
        `Unexpected expression: ${JSON.stringify(expr)}`,
      );
  }
}

function checkLhsMutability(
  ctx: AnalysisContext,
  lhs: Semantics.Expression,
  tokenId: number,
): void {
  const violation = placeMutabilityViolation(ctx, lhs, true);
  if (isSome(violation)) {
    switch (violation.value) {
      case "immutable-binding":
        emitError(
          ctx,
          "cannot assign to immutable binding",
          tokenId,
          "HEDGE-BORROW-CHECK-006",
        );
        break;
      case "shared-reference":
        emitError(
          ctx,
          "cannot assign through a shared reference",
          tokenId,
          "HEDGE-BORROW-CHECK-006",
        );
        break;
      default:
        assertNever(
          violation.value,
          `Unexpected place mutability violation: ${String(violation.value)}`,
        );
    }
  }
}

function analyzeAssignmentExpression(
  ctx: AnalysisContext,
  assignExpression: Parser.AssignExpression,
): Semantics.AssignExpression {
  const lhs = analyzeExpression(ctx, assignExpression.lhs);
  checkLhsMutability(ctx, lhs, assignExpression.tokenId);
  return {
    ...assignExpression,
    lhs,
    rhs: analyzeExpression(ctx, assignExpression.rhs),
    type: { kind: "UnitType", tokenId: assignExpression.tokenId },
  };
}

function analyzeCompoundAssignmentExpression(
  ctx: AnalysisContext,
  compoundAssignExpression: Parser.CompoundAssignExpression,
): Semantics.CompoundAssignExpression {
  const lhs = analyzeExpression(ctx, compoundAssignExpression.lhs);
  checkLhsMutability(ctx, lhs, compoundAssignExpression.tokenId);
  return {
    ...compoundAssignExpression,
    lhs,
    rhs: analyzeExpression(ctx, compoundAssignExpression.rhs),
    type: { kind: "UnitType", tokenId: compoundAssignExpression.tokenId },
  };
}

/**
 * `Message::Write { text: "hi" }`-shaped construction struct-literals.
 * `none()` unless the path is a known enum + variant, falling back to
 * ordinary `StructExpression` analysis. Reuses `analyzeStructNamedFields`
 * directly, since a variant's `NamedFieldsBody` is the same node shape a
 * struct's own body is - only the diagnostic wording says "struct" rather
 * than "variant" (an accepted minor imprecision).
 */
function analyzeEnumVariantStructConstruction(
  ctx: AnalysisContext,
  structExpression: Parser.StructExpression,
  fields: readonly Semantics.FieldInit[],
  hasBase: boolean,
): Option<{
  readonly type: Semantics.Type;
  readonly fields: Semantics.FieldInit[];
}> {
  const { segments } = structExpression.path;
  const [enumName, variantName] = segments;
  if (enumName === undefined || variantName === undefined) return none();
  const enumDecl = lookupEnum(ctx, enumName);
  // Diagnosed directly here, not via `analyzePath` - a struct-literal path
  // never routes through it, so it needs its own unknown-enum/unknown-variant
  // checks.
  if (enumDecl === undefined) {
    emitError(
      ctx,
      `cannot find enum \`${enumName}\` in this scope`,
      structExpression.tokenId,
      "HEDGE-NAME-001",
    );
    return some({ type: UNIT, fields: [...fields] });
  }
  const variant = enumDecl.variants.find((v) => v.name.text === variantName);
  if (variant === undefined) {
    emitError(
      ctx,
      `no variant \`${variantName}\` on enum \`${enumName}\``,
      structExpression.tokenId,
      "HEDGE-NAME-004",
    );
    return some({ type: enumDecl.type, fields: [...fields] });
  }
  if (!isSome(variant.body) || variant.body.value.kind !== "NamedFields") {
    emitError(
      ctx,
      isSome(variant.body)
        ? `variant \`${variantName}\` is a tuple variant; use \`${variantName}(...)\``
        : `variant \`${variantName}\` is a unit variant; use \`${variantName}\` with no braces`,
      structExpression.tokenId,
      "HEDGE-TYPE-008",
    );
    return some({ type: enumDecl.type, fields: [...fields] });
  }
  const checkedFields = analyzeStructNamedFields(
    ctx,
    variantName,
    fields,
    hasBase,
    structExpression.tokenId,
    variant.body.value,
  );
  return some({ type: enumDecl.type, fields: checkedFields });
}

function analyzeStructExpression(
  ctx: AnalysisContext,
  structExpression: Parser.StructExpression,
): Semantics.StructExpression {
  const analyzedFields = structExpression.fields.map(
    (field: Parser.FieldInit): Semantics.FieldInit => {
      const analyzedValue = mapSome(field.value, (v) =>
        analyzeExpression(ctx, v),
      );
      return {
        ...field,
        name: analyzeIdentifier(ctx, field.name, UNIT),
        value: analyzedValue,
        type: unwrapSomeOr(mapSome(analyzedValue, getType), UNIT),
      };
    },
  );

  const analyzedBase = mapSome(structExpression.base, (base) =>
    analyzeExpression(ctx, base),
  );

  if (structExpression.path.segments.length === 2) {
    const construction = analyzeEnumVariantStructConstruction(
      ctx,
      structExpression,
      analyzedFields,
      isSome(analyzedBase),
    );
    if (isSome(construction)) {
      return {
        ...structExpression,
        fields: construction.value.fields,
        base: analyzedBase,
        type: construction.value.type,
      };
    }
  }

  if (structExpression.path.segments.length !== 1) {
    return {
      ...structExpression,
      fields: analyzedFields,
      base: analyzedBase,
      type: UNIT,
    };
  }
  const structName = structExpression.path.segments[0];
  if (structName === undefined) {
    return {
      ...structExpression,
      fields: analyzedFields,
      base: analyzedBase,
      type: UNIT,
    };
  }

  const structDecl = lookupStruct(ctx, structName);
  if (structDecl === undefined) {
    emitError(
      ctx,
      `cannot find struct \`${structName}\` in this scope`,
      structExpression.tokenId,
      "HEDGE-NAME-001",
    );
    return {
      ...structExpression,
      fields: analyzedFields,
      base: analyzedBase,
      type: UNIT,
    };
  }

  let checkedFields = analyzedFields;
  if (structDecl.body.kind === "NamedFields") {
    checkedFields = analyzeStructNamedFields(
      ctx,
      structName,
      analyzedFields,
      isSome(analyzedBase),
      structExpression.tokenId,
      structDecl.body,
    );
  } else if (
    structDecl.body.kind === "Unit" &&
    structExpression.fields.length > 0
  ) {
    for (const field of structExpression.fields) {
      emitError(
        ctx,
        `field \`${field.name.text}\` provided for unit struct \`${structName}\``,
        field.name.tokenId,
        "HEDGE-TYPE-008",
      );
    }
  }

  return {
    ...structExpression,
    fields: checkedFields,
    base: analyzedBase,
    type: structDecl.type,
  };
}

/**
 * Checks each provided field against the struct's declaration: duplicate
 * names, unknown names, value-type mismatches (coercing an unsuffixed-
 * integer-literal value first), and - unless a `..base` spread is present -
 * missing required fields. Returns the fields with any coerced values
 * threaded back in, since downstream JSIM lowering reads each field value's
 * `.type` to pick numeric wrapping.
 */
function analyzeStructNamedFields(
  ctx: AnalysisContext,
  structName: string,
  fields: readonly Semantics.FieldInit[],
  hasBase: boolean,
  structTokenId: number,
  namedFieldsBody: Semantics.NamedFieldsBody,
): Semantics.FieldInit[] {
  const declaredFields = new Map(
    namedFieldsBody.fields.map((f): [string, Semantics.StructField] => [
      f.name.text,
      f,
    ]),
  );

  const seenFields = new Set<string>();
  const checkedFields = fields.map((field): Semantics.FieldInit => {
    if (seenFields.has(field.name.text)) {
      emitError(
        ctx,
        `field \`${field.name.text}\` specified more than once in struct literal`,
        field.name.tokenId,
        "HEDGE-NAME-005",
      );
    }
    seenFields.add(field.name.text);

    const declaredField = declaredFields.get(field.name.text);
    if (declaredField === undefined) {
      emitError(
        ctx,
        `unknown field \`${field.name.text}\` for struct \`${structName}\``,
        field.name.tokenId,
        "HEDGE-NAME-003",
      );
      return field;
    }

    // Shorthand `Foo { x }` (field.value is none()) - value-type inference
    // for shorthand is a separate, pre-existing gap; out of scope here.
    if (!isSome(field.value)) return field;

    const value = field.value.value;
    const { expr, mismatch } = reconcileExpressionType(
      ctx,
      value,
      declaredField.type,
      value.tokenId,
    );
    if (expr.kind === "IntLiteral") {
      checkPosLiteralRange(ctx, expr, declaredField.type);
    }
    if (mismatch) {
      emitError(
        ctx,
        `field \`${field.name.text}\` type mismatch: expected \`${describeType(declaredField.type)}\`, found \`${describeType(getType(expr))}\``,
        value.tokenId,
        "HEDGE-TYPE-001",
      );
    }
    return expr === value
      ? field
      : { ...field, value: some(expr), type: getType(expr) };
  });

  if (!hasBase) {
    for (const fieldName of declaredFields.keys()) {
      if (!seenFields.has(fieldName)) {
        emitError(
          ctx,
          `missing required field \`${fieldName}\` in struct literal of type \`${structName}\``,
          structTokenId,
          "HEDGE-TYPE-008",
        );
      }
    }
  }

  return checkedFields;
}

/**
 * Whether a branch's `UnitType` came from a failed sub-analysis rather than
 * being a genuine unit value. A branch is a `Block`, so its own kind says
 * nothing; what matters is the trailing expression its type came from. A
 * block with no trailing expression is genuinely unit.
 */
function branchUnitIsAmbiguous(
  branch: Semantics.Block | Semantics.IfExpression,
): boolean {
  if (branch.kind === "IfExpression") {
    return branchUnitIsAmbiguous(branch.thenBranch);
  }
  return (
    isSome(branch.trailingExpression) &&
    isAmbiguousUnitExpr(branch.trailingExpression.value)
  );
}

function checkBranchTypesAgree(
  ctx: AnalysisContext,
  thenBranch: Semantics.Block,
  elseBranch: Semantics.IfExpression | Semantics.Block,
  tokenId: number,
): void {
  const thenType = thenBranch.type;
  const elseType = elseBranch.type;
  const suppressed =
    (thenType.kind === "UnitType" && branchUnitIsAmbiguous(thenBranch)) ||
    (elseType.kind === "UnitType" && branchUnitIsAmbiguous(elseBranch));
  if (!suppressed && !typesEqual(thenType, elseType)) {
    emitError(
      ctx,
      "if expression branches have incompatible types",
      tokenId,
      "HEDGE-TYPE-004",
    );
  }
}

function analyzeIfExpression(
  ctx: AnalysisContext,
  ifExpression: Parser.IfExpression,
): Semantics.IfExpression {
  if (ifExpression.condition.kind === "LetExpression") {
    return analyzeIfLetExpression(ctx, ifExpression, ifExpression.condition);
  }
  const condition = analyzeExpression(ctx, ifExpression.condition);
  const thenBranch = analyzeBlock(ctx, ifExpression.thenBranch);
  const elseBranch = mapSome(ifExpression.elseBranch, (elseBranch) =>
    elseBranch.kind === "IfExpression"
      ? analyzeIfExpression(ctx, elseBranch)
      : analyzeBlock(ctx, elseBranch),
  );

  const condType = getType(condition);
  if (
    condType.kind !== "UnitType" &&
    condType.kind !== "PrimitiveBooleanType"
  ) {
    emitError(
      ctx,
      "if condition must be `bool`",
      ifExpression.tokenId,
      "HEDGE-TYPE-002",
    );
  }

  if (isSome(elseBranch)) {
    checkBranchTypesAgree(
      ctx,
      thenBranch,
      elseBranch.value,
      ifExpression.tokenId,
    );
  }

  const type: Semantics.Type = isSome(elseBranch)
    ? thenBranch.type
    : { kind: "UnitType", tokenId: ifExpression.tokenId };
  return {
    ...ifExpression,
    condition,
    thenBranch,
    elseBranch,
    type,
  };
}

/**
 * Sugar over a single-arm `match` - the pattern is analyzed like a match
 * arm's (refutable allowed, binding mode via `defaultBindingModeForScrutinee`),
 * scoped to `thenBranch` only: pushed before it's analyzed, popped before
 * `elseBranch`'s. `condition.type` is always `PrimitiveBooleanType` -
 * inherently boolean by construction, so no bool-check is needed here.
 */
function analyzeIfLetExpression(
  ctx: AnalysisContext,
  ifExpression: Parser.IfExpression,
  letExpression: Parser.LetExpression,
): Semantics.IfExpression {
  const scrutinee = analyzeExpression(ctx, letExpression.scrutinee);
  const scrutineeType = getType(scrutinee);
  const { mode: defaultMode, effectiveType } =
    defaultBindingModeForScrutinee(scrutineeType);
  const rootMutable = !isSome(placeMutabilityViolation(ctx, scrutinee, true));

  let condition: Semantics.LetExpression;
  let thenBranch: Semantics.Block;
  pushFrame(ctx);
  try {
    const pattern = analyzePattern(
      ctx,
      letExpression.pattern,
      effectiveType,
      defaultMode,
      rootMutable,
    );
    condition = {
      ...letExpression,
      pattern,
      scrutinee,
      type: { kind: "PrimitiveBooleanType" },
    };
    thenBranch = analyzeBlock(ctx, ifExpression.thenBranch);
  } finally {
    popFrame(ctx);
  }

  const elseBranch = mapSome(ifExpression.elseBranch, (elseBranch) =>
    elseBranch.kind === "IfExpression"
      ? analyzeIfExpression(ctx, elseBranch)
      : analyzeBlock(ctx, elseBranch),
  );

  if (isSome(elseBranch)) {
    checkBranchTypesAgree(
      ctx,
      thenBranch,
      elseBranch.value,
      ifExpression.tokenId,
    );
  }

  const type: Semantics.Type = isSome(elseBranch)
    ? thenBranch.type
    : { kind: "UnitType", tokenId: ifExpression.tokenId };
  return {
    ...ifExpression,
    condition,
    thenBranch,
    elseBranch,
    type,
  };
}

function analyzeIdentifier(
  _ctx: AnalysisContext,
  identifier: Parser.Identifier,
  type: Semantics.Type,
): Semantics.Identifier {
  return { ...identifier, type };
}

/**
 * For each of the callee's declared generic parameters: reports an unsolved
 * generic (`HEDGE-TYPE-006`) if inference never bound it, otherwise checks
 * its resolved type against every trait bound that parameter declares,
 * reporting an unsatisfied one as `HEDGE-TRAIT-002`. Witnesses are
 * accumulated locally and committed to `ctx.witnessTable` only once every
 * bound on this call resolved - `AnalysisResult.witnesses` documents that a
 * call with unresolved bounds carries no entry at all, so a partial write
 * (one bound's witness recorded before a later bound on the same call
 * fails) would violate that contract. Split out of `analyzeCall` to keep
 * that function itself under the complexity ceiling.
 */
function checkCallGenericBounds(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  calleeType: Semantics.FunctionType,
  bindings: GenericBindings,
): void {
  const witnesses: WitnessRef[] = [];
  let allBoundsSatisfied = true;
  for (const paramName of calleeType.genericParams) {
    const binding = bindings.get(paramName);
    if (binding === undefined) {
      emitError(
        ctx,
        `cannot infer type of generic parameter \`${paramName}\` without an explicit type annotation or turbofish`,
        call.tokenId,
        "HEDGE-TYPE-006",
      );
      allBoundsSatisfied = false;
      continue;
    }
    if (binding.isErrorPlaceholder) continue;
    for (const traitName of calleeType.genericParamBounds.get(paramName) ??
      []) {
      const witness = resolveTraitBound(ctx, binding.type, traitName);
      if (isSome(witness)) {
        witnesses.push(witness.value);
        continue;
      }
      allBoundsSatisfied = false;
      emitError(
        ctx,
        traitBoundNotSatisfiedMessage(describeType(binding.type), traitName),
        call.tokenId,
        "HEDGE-TRAIT-002",
      );
    }
  }
  if (allBoundsSatisfied && witnesses.length > 0) {
    ctx.witnessTable.set(call.tokenId, witnesses);
  }
}

function analyzeCall(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  expectedType?: Semantics.Type,
): Semantics.CallExpression {
  const args = call.arguments.map((arg) => analyzeExpression(ctx, arg));
  // Must run before ordinary path analysis on `call.callee`, which would
  // otherwise emit "Cannot find name" for an unresolved single-segment name.
  const structConstruction = analyzeTupleStructCallConstruction(
    ctx,
    call,
    args,
  );
  if (isSome(structConstruction)) {
    return {
      ...call,
      callee: structConstruction.value.callee,
      arguments: structConstruction.value.args,
      type: structConstruction.value.type,
    };
  }
  const callee = analyzeExpression(ctx, call.callee);
  const enumConstruction = analyzeEnumVariantCallConstruction(ctx, call, args);
  if (isSome(enumConstruction)) {
    return {
      ...call,
      callee,
      arguments: enumConstruction.value.args,
      type: enumConstruction.value.type,
    };
  }
  const calleeType = getType(callee);
  if (calleeType.kind !== "FunctionType") {
    return {
      ...call,
      callee,
      arguments: args,
      type: { kind: "UnitType", tokenId: call.tokenId },
    };
  }
  if (calleeType.paramsArePlaceholder) {
    return {
      ...call,
      callee,
      arguments: [...args],
      type: calleeType.returnType,
    };
  }
  const turbofishBindings: GenericBindings = new Map();
  seedTurbofishBindings(ctx, call, calleeType.genericParams, turbofishBindings);
  const expectedTypeConflicted =
    expectedType !== undefined &&
    seedExpectedReturnType(
      ctx,
      call,
      calleeType.returnType,
      expectedType,
      new Set(calleeType.genericParams),
      turbofishBindings,
    );
  const { args: checkedArgs, bindings } = checkPositionalCallArgs(
    ctx,
    call,
    { kindLabel: "function", name: calleeName(call) },
    calleeType.params.map((type) => ({ type })),
    args,
    calleeType.genericParams,
    turbofishBindings,
  );
  checkCallGenericBounds(ctx, call, calleeType, bindings);
  // A conflict already reported by `seedExpectedReturnType` means the
  // enclosing `let`/return reconciliation would otherwise see a return type
  // that still disagrees with `expectedType` and double-report the same
  // problem - report the call's own type as `expectedType` itself instead,
  // so that reconciliation trivially agrees.
  const returnType = expectedTypeConflicted
    ? expectedType
    : getReturnType(calleeType, bindings);
  return {
    ...call,
    callee,
    arguments: checkedArgs,
    type: returnType,
  };
}

function getReturnType(
  calleeType: Semantics.FunctionType,
  bindings: GenericBindings,
): Semantics.Type {
  return calleeType.genericParams.length > 0
    ? substituteGenericType(calleeType.returnType, bindings)
    : calleeType.returnType;
}

/** The callee's source-level name for a diagnostic. */
function calleeName(call: Parser.CallExpression): string {
  if (call.callee.kind === "PathExpression") {
    return call.callee.path.segments.join("::");
  }
  return "this call";
}

/**
 * `Message::Move(1, 2)`-shaped construction calls. `none()` when
 * `call.callee` isn't a two-segment path naming a known enum + variant,
 * falling back to ordinary call analysis. Unlike the path resolver, this
 * one resolves regardless of the variant's body shape - only a call site
 * can validate arity, so a unit variant called with args or a struct
 * variant called with parens are both diagnosed here.
 */
function analyzeEnumVariantCallConstruction(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  args: readonly Semantics.Expression[],
): Option<{
  readonly type: Semantics.Type;
  readonly args: Semantics.Expression[];
}> {
  if (call.callee.kind !== "PathExpression") return none();
  const { segments } = call.callee.path;
  if (segments.length !== 2) return none();
  const [enumName, variantName] = segments;
  if (enumName === undefined || variantName === undefined) return none();
  const enumDecl = lookupEnum(ctx, enumName);
  if (enumDecl === undefined) return none();
  const variant = enumDecl.variants.find((v) => v.name.text === variantName);
  // Already diagnosed by `analyzePath`'s analysis of `call.callee` in
  // `analyzeCall` - not repeated here, to avoid a duplicate cascade.
  if (variant === undefined) return none();

  if (!isSome(variant.body)) {
    if (args.length > 0) {
      emitError(
        ctx,
        `variant \`${variantName}\` takes no arguments, but ${args.length} ${args.length === 1 ? "was" : "were"} supplied`,
        call.tokenId,
        "HEDGE-TYPE-008",
      );
    }
    return some({ type: enumDecl.type, args: [...args] });
  }
  if (variant.body.value.kind !== "TupleFields") {
    emitError(
      ctx,
      `variant \`${variantName}\` has named fields; use \`${variantName} { ... }\``,
      call.tokenId,
      "HEDGE-TYPE-008",
    );
    return some({ type: enumDecl.type, args: [...args] });
  }
  const checkedArgs = checkGenericPositionalConstruction(
    ctx,
    call,
    { kindLabel: "variant", name: variantName },
    variant.body.value.fields,
    args,
    enumDecl.generics,
  );
  return some({ type: enumDecl.type, args: checkedArgs });
}

/** A generic-parameter name's inferred concrete type, alongside the token
 * where that binding was first established - needed to point a later
 * conflict's `relatedSpans` back at it. */
interface GenericBinding {
  readonly type: Semantics.Type;
  readonly tokenId: number;
  /** True for a binding that stands in for an already-diagnosed failure
   * (`Self` outside a trait/impl, a structurally mismatched reference hop)
   * rather than a real resolved type - a later real binding replaces it
   * silently instead of conflicting against it, so one root-cause failure
   * doesn't cascade into a second, unrelated-looking diagnostic. */
  readonly isErrorPlaceholder?: boolean;
}

/** Bound as unification walks a call's arguments
 * (docs/adr/0012-unification-based-generic-call-inference.md). Internal
 * bookkeeping for this pass only - never joins `Semantics.Type` itself. */
type GenericBindings = Map<string, GenericBinding>;

/** Whether `declaredType` is a generic-parameter position at all - a bare
 * generic-named `NamedType`, or a single reference hop to one, the only two
 * shapes generic-parameter resolution currently supports. Anything else,
 * including a compound position, is never treated as generic here. */
function involvesGenericParam(
  declaredType: Semantics.Type,
  genericNames: ReadonlySet<string>,
): boolean {
  const base =
    declaredType.kind === "ReferenceType"
      ? declaredType.referent
      : declaredType;
  if (base.kind !== "NamedType" || base.path.segments.length !== 1) {
    return false;
  }
  const name = base.path.segments[0];
  return name !== undefined && genericNames.has(name);
}

/** Substitutes every generic-parameter-named `NamedType` position in `type`
 * for its bound concrete type, recursing through a single reference hop -
 * the only two shapes generic-parameter resolution currently supports. A
 * `NamedType` with no binding yet (or not a generic parameter at all)
 * passes through unchanged. */
function substituteGenericType(
  type: Semantics.Type,
  bindings: GenericBindings,
): Semantics.Type {
  if (type.kind === "NamedType") {
    const name = type.path.segments[0];
    const bound = name === undefined ? undefined : bindings.get(name);
    return bound?.type ?? type;
  }
  if (type.kind === "ReferenceType") {
    return {
      ...type,
      referent: substituteGenericType(type.referent, bindings),
    };
  }
  return type;
}

type UnifyOutcome =
  | { readonly kind: "Bound" }
  | {
      readonly kind: "Conflict";
      readonly previous: Semantics.Type;
      readonly previousTokenId: number;
    }
  | { readonly kind: "Mismatch" };

/** A single `relatedSpans` entry pointing at `tokenId`, or none if the
 * token can't be resolved - the shared shape a conflict diagnostic's
 * "inferred here" note takes at every `unifyGenericParam` call site. */
function relatedSpanAt(
  ctx: AnalysisContext,
  tokenId: number,
  label: string,
): readonly RelatedSpan[] {
  const token = ctx.tokens[tokenId];
  return token === undefined ? [] : [{ span: token.span, label }];
}

/** Online Robinson-style unification of one declared type against one
 * argument's actual type, binding a not-yet-seen generic parameter name
 * into `bindings` (recorded at `tokenId`, so a later conflict can point
 * back at where the binding came from) or checking a subsequent occurrence
 * against its existing binding. Only called once `involvesGenericParam` has
 * already confirmed `declaredType` is a real generic-parameter position, so
 * a `NamedType` reached here is always in `genericNames`. */
function unifyGenericParam(
  declaredType: Semantics.Type,
  actualType: Semantics.Type,
  tokenId: number,
  genericNames: ReadonlySet<string>,
  bindings: GenericBindings,
): UnifyOutcome {
  if (declaredType.kind === "NamedType") {
    const name = declaredType.path.segments[0];
    assert(
      name !== undefined && genericNames.has(name),
      "unifyGenericParam called on a non-generic NamedType",
    );
    const existing = bindings.get(name);
    if (existing === undefined || existing.isErrorPlaceholder) {
      bindings.set(name, { type: actualType, tokenId });
      return { kind: "Bound" };
    }
    return typesEqual(existing.type, actualType)
      ? { kind: "Bound" }
      : {
          kind: "Conflict",
          previous: existing.type,
          previousTokenId: existing.tokenId,
        };
  }
  if (
    declaredType.kind === "ReferenceType" &&
    actualType.kind === "ReferenceType" &&
    declaredType.mutable === actualType.mutable
  ) {
    return unifyGenericParam(
      declaredType.referent,
      actualType.referent,
      tokenId,
      genericNames,
      bindings,
    );
  }
  bindMismatchedReferentPlaceholder(
    declaredType,
    tokenId,
    genericNames,
    bindings,
  );
  return { kind: "Mismatch" };
}

/** The declared shape itself doesn't match (wrong mutability, or a
 * non-reference actual type against a `&T`/`&mut T` position), so the
 * referent's own generic name is never actually reached by
 * `unifyGenericParam`'s own recursion. Bind it to an error-recovery
 * placeholder anyway (unless something valid already bound it - a real
 * prior occurrence should never be clobbered by a later structural
 * failure), so a downstream "cannot be inferred" check doesn't cascade a
 * second diagnostic on top of this one's own. */
function bindMismatchedReferentPlaceholder(
  declaredType: Semantics.Type,
  tokenId: number,
  genericNames: ReadonlySet<string>,
  bindings: GenericBindings,
): void {
  if (
    declaredType.kind !== "ReferenceType" ||
    declaredType.referent.kind !== "NamedType" ||
    declaredType.referent.path.segments.length !== 1
  ) {
    return;
  }
  const name = declaredType.referent.path.segments[0];
  if (name !== undefined && genericNames.has(name) && !bindings.has(name)) {
    bindings.set(name, {
      type: { kind: "UnitType", tokenId },
      tokenId,
      isErrorPlaceholder: true,
    });
  }
}

/** Seeds `bindings` from a call's own turbofish type-argument list, if any -
 * these take priority over argument-driven inference, so they must run
 * before it (a later disagreement from an ordinary argument is then
 * reported as the conflict, blaming the argument). An empty list (`::<>`)
 * means zero explicit arguments were supplied, so it's treated exactly like
 * an absent turbofish - full inference, not an arity error. A non-empty
 * list that doesn't match the callee's declared generic-parameter count is
 * rejected outright. */
function seedTurbofishBindings(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  genericParams: readonly string[],
  bindings: GenericBindings,
): void {
  if (call.callee.kind !== "PathExpression") return;
  const typeArgs = call.callee.typeArguments;
  if (typeArgs.length === 0) return;
  if (typeArgs.length !== genericParams.length) {
    emitError(
      ctx,
      `\`${calleeName(call)}\` declares ${genericParams.length} generic parameter(s), but the turbofish supplies ${typeArgs.length}`,
      call.tokenId,
      "HEDGE-TYPE-011",
    );
    return;
  }
  genericParams.forEach((paramName, index) => {
    const argType = typeArgs[index];
    if (argType === undefined) return;
    bindings.set(paramName, {
      type: validateSlice1Type(ctx, argType, argType.tokenId),
      tokenId: argType.tokenId,
      // `Self` outside a trait/impl already reports its own diagnostic
      // (validateSlice1Type, above) and resolves to the UnitType
      // error-recovery placeholder - marked so a real argument later in
      // the same call isn't wrongly reported as conflicting with it.
      isErrorPlaceholder: isSelfType(argType),
    });
  });
}

/** Seeds turbofish, then argument-driven unification, then checks every
 * declared generic parameter got resolved - the same sequence `analyzeCall`
 * runs for an ordinary function call, minus the expected-return-type seed
 * (a constructed value's own type never reifies which concrete types its
 * generics resolved to - `EnumType`/`StructType` compare by name alone, see
 * `typesEqual` - so there's no return type for an outer expected type to
 * seed against the way an ordinary function call has one). Shared by
 * `analyzeEnumVariantCallConstruction` and `analyzeTupleStructCallConstruction`. */
function checkGenericPositionalConstruction(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  site: CallSiteDescription,
  params: readonly { readonly type: Semantics.Type }[],
  args: readonly Semantics.Expression[],
  genericParams: readonly string[],
): Semantics.Expression[] {
  const turbofishBindings: GenericBindings = new Map();
  seedTurbofishBindings(ctx, call, genericParams, turbofishBindings);
  const { args: checkedArgs, bindings } = checkPositionalCallArgs(
    ctx,
    call,
    site,
    params,
    args,
    genericParams,
    turbofishBindings,
  );
  for (const paramName of genericParams) {
    if (bindings.has(paramName)) continue;
    emitError(
      ctx,
      `cannot infer type of generic parameter \`${paramName}\` without an explicit type annotation or turbofish`,
      call.tokenId,
      "HEDGE-TYPE-006",
    );
  }
  return checkedArgs;
}

/** Seeds `bindings` from a calling context's already-known expected type - a
 * `let` binding's own annotation, or the enclosing function's declared
 * return type - unifying it against the callee's declared return type. Runs
 * after turbofish and before argument-driven inference, so a disagreement
 * against an ordinary argument is still blamed at the argument; a
 * disagreement against turbofish itself (no argument involved at all) is
 * blamed here, at the call's own site, since there is no argument span to
 * point at instead.
 *
 * Returns whether a conflict was reported, so the caller can substitute
 * `expectedType` directly as the call's own final type instead of the
 * ordinary bindings-substituted one - the conflict is already fully
 * reported here, so the enclosing `let`/return reconciliation seeing a
 * type that still disagrees with `expectedType` would only double-report
 * the same problem under a different, more confusing message. */
function seedExpectedReturnType(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  returnType: Semantics.Type,
  expectedType: Semantics.Type,
  genericNames: ReadonlySet<string>,
  bindings: GenericBindings,
): boolean {
  if (!involvesGenericParam(returnType, genericNames)) return false;
  const outcome = unifyGenericParam(
    returnType,
    expectedType,
    call.tokenId,
    genericNames,
    bindings,
  );
  switch (outcome.kind) {
    case "Bound":
      return false;
    case "Conflict": {
      emitError(
        ctx,
        `call to \`${calleeName(call)}\` type mismatch: expected \`${describeType(substituteGenericType(returnType, bindings))}\`, found \`${describeType(expectedType)}\``,
        call.tokenId,
        "HEDGE-TYPE-010",
        relatedSpanAt(
          ctx,
          outcome.previousTokenId,
          `inferred as \`${describeType(outcome.previous)}\` here`,
        ),
      );
      return true;
    }
    case "Mismatch":
      // The declared return shape itself doesn't match the expected type
      // (e.g. `&T` against a non-reference annotation) - a structural
      // problem the existing post-hoc annotation/return-type check (run
      // separately by the caller) still catches, so no diagnostic needed
      // here beyond leaving the generic parameter unbound.
      return false;
    default:
      return assertNever(
        outcome,
        `Unexpected unify outcome: ${JSON.stringify(outcome)}`,
      );
  }
}

/** How a positional-argument check names its callee in a diagnostic - a
 * tuple-shaped construction (`Enum::Variant(...)`, a tuple struct's own
 * `Name(...)`) or an ordinary function call, distinguished only by
 * `kindLabel`'s wording. Bundled into one type (rather than two loose
 * parameters) so `checkPositionalCallArgs`/`checkGenericPositionalArg`
 * each stay under the parameter-count ceiling. */
interface CallSiteDescription {
  readonly kindLabel: "variant" | "struct" | "function";
  readonly name: string;
}

/** Arity, then per-argument type checking, for any call whose callee has a
 * known positional parameter list. `params` is anything carrying a
 * declared type per position, so a `TupleField[]` and a `FunctionType`'s
 * own `Type[]` both satisfy it. `genericParams` is the callee's own
 * declared type-parameter names (empty for a non-generic callee); a
 * position naming one of them unifies instead of a plain `typesEqual`
 * check. Returns the bindings unification produced alongside the checked
 * arguments, so a caller can substitute them into a return type.
 * `seedBindings`, when given, is unified into (e.g. a turbofish's
 * already-resolved argument list) rather than starting empty, so a later
 * argument that disagrees with a seed is reported as the conflict. */
function checkPositionalCallArgs(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  site: CallSiteDescription,
  params: readonly { readonly type: Semantics.Type }[],
  args: readonly Semantics.Expression[],
  genericParams: readonly string[],
  seedBindings?: GenericBindings,
): {
  readonly args: Semantics.Expression[];
  readonly bindings: GenericBindings;
} {
  const fields = params;
  const genericNames = new Set(genericParams);
  const bindings: GenericBindings =
    seedBindings ?? new Map<string, GenericBinding>();
  if (fields.length !== args.length) {
    emitError(
      ctx,
      `${site.kindLabel} \`${site.name}\` takes ${fields.length} argument(s), but ${args.length} ${args.length === 1 ? "was" : "were"} supplied`,
      call.tokenId,
      "HEDGE-TYPE-008",
    );
    // Arity mismatch means the per-argument loop below never runs, so
    // nothing would otherwise bind a generic parameter that isn't already
    // seeded (turbofish, expected return type). Placeholder-bind the rest
    // so the caller's own unsolved-variable check doesn't also fire for
    // each one on top of this arity error.
    for (const paramName of genericNames) {
      if (bindings.has(paramName)) continue;
      bindings.set(paramName, {
        type: { kind: "UnitType", tokenId: call.tokenId },
        tokenId: call.tokenId,
        isErrorPlaceholder: true,
      });
    }
    return { args: [...args], bindings };
  }
  const checkedArgs = args.map((arg, i) => {
    const field = fields[i];
    if (field === undefined) return arg;
    const argType = getType(arg);
    if (
      genericNames.size > 0 &&
      involvesGenericParam(field.type, genericNames) &&
      !(argType.kind === "UnitType" && isAmbiguousUnitExpr(arg))
    ) {
      return checkGenericPositionalArg(
        ctx,
        site,
        i,
        field.type,
        arg,
        genericNames,
        bindings,
      );
    }
    const { expr, mismatch } = reconcileExpressionType(
      ctx,
      arg,
      field.type,
      arg.tokenId,
    );
    if (expr.kind === "IntLiteral") {
      checkPosLiteralRange(ctx, expr, field.type);
    }
    if (mismatch) {
      emitError(
        ctx,
        `argument ${i + 1} to ${site.kindLabel} \`${site.name}\` type mismatch: expected \`${describeType(field.type)}\`, found \`${describeType(getType(expr))}\``,
        arg.tokenId,
        "HEDGE-TYPE-001",
      );
    }
    return expr;
  });
  return { args: checkedArgs, bindings };
}

/** The generic-parameter-position branch of `checkPositionalCallArgs`'s
 * per-argument loop, split out to stay under the branch-count ceiling a
 * plain literal coercion plus range-check plus conflict-report combination
 * would otherwise push the loop body past. */
function checkGenericPositionalArg(
  ctx: AnalysisContext,
  site: CallSiteDescription,
  index: number,
  declaredType: Semantics.Type,
  arg: Semantics.Expression,
  genericNames: ReadonlySet<string>,
  bindings: GenericBindings,
): Semantics.Expression {
  // An unsuffixed literal has no fixed type of its own yet - coerce it
  // against whatever concrete type this generic parameter has already
  // resolved to (from an earlier argument, turbofish, or an expected return
  // type) before unifying, the same coercion `reconcileExpressionType`
  // applies for an ordinary (non-generic) declared type. A parameter not
  // yet bound to anything concrete leaves `coercedArg` untouched, so the
  // literal's own default type still seeds the binding.
  const coercedArg = isUnsuffixedLiteralExpr(arg)
    ? coerceToIntegerType(arg, substituteGenericType(declaredType, bindings))
    : arg;
  const coercedArgType = getType(coercedArg);
  const outcome = unifyGenericParam(
    declaredType,
    coercedArgType,
    coercedArg.tokenId,
    genericNames,
    bindings,
  );
  if (coercedArg.kind === "IntLiteral") {
    checkPosLiteralRange(ctx, coercedArg, coercedArgType);
  } else if (
    coercedArg.kind === "UnaryExpression" &&
    coercedArg.operator === "Neg" &&
    coercedArg.operand.kind === "IntLiteral" &&
    !isSome(coercedArg.operand.suffix)
  ) {
    const rangeError = checkNegLiteralRange(coercedArg.operand, coercedArgType);
    if (isSome(rangeError)) {
      emitError(ctx, rangeError.value, coercedArg.tokenId, "HEDGE-TYPE-005");
    }
  }
  switch (outcome.kind) {
    case "Bound":
      break;
    case "Conflict": {
      // Render `expected` at the same depth as `declaredType` itself (e.g.
      // `&i32`, not the unwrapped `i32` a reference-hop binding stores) so
      // it's directly comparable to `found`, which is the argument's own
      // whole type.
      const expectedType = substituteGenericType(declaredType, bindings);
      emitError(
        ctx,
        `argument ${index + 1} to ${site.kindLabel} \`${site.name}\` type mismatch: expected \`${describeType(expectedType)}\`, found \`${describeType(coercedArgType)}\``,
        coercedArg.tokenId,
        "HEDGE-TYPE-010",
        relatedSpanAt(
          ctx,
          outcome.previousTokenId,
          `inferred as \`${describeType(outcome.previous)}\` here`,
        ),
      );
      break;
    }
    case "Mismatch":
      // The declared shape itself doesn't match (e.g. `&T` against a
      // non-reference argument, or against a `&mut` when `&` is declared) -
      // a structural problem unrelated to what T resolves to, so `declaredType`
      // is rendered as-is (`&T`), not substituted - there is no concrete
      // type to substitute in, only the error-recovery placeholder
      // `unifyGenericParam` just bound to suppress a downstream cascade.
      emitError(
        ctx,
        `argument ${index + 1} to ${site.kindLabel} \`${site.name}\` type mismatch: expected \`${describeType(declaredType)}\`, found \`${describeType(coercedArgType)}\``,
        coercedArg.tokenId,
        "HEDGE-TYPE-001",
      );
      break;
    default:
      assertNever(
        outcome,
        `Unexpected unify outcome: ${JSON.stringify(outcome)}`,
      );
  }
  return coercedArg;
}

/**
 * `Pair(3, 4)`-shaped construction for a plain tuple struct - the struct
 * counterpart to `analyzeEnumVariantCallConstruction`. `none()` when the
 * callee isn't a known tuple struct's name, or a function of that name
 * already resolves (`analyze()`'s own pass rejects that collision itself).
 */
function analyzeTupleStructCallConstruction(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
  args: readonly Semantics.Expression[],
): Option<{
  readonly callee: Semantics.PathExpression;
  readonly type: Semantics.Type;
  readonly args: Semantics.Expression[];
}> {
  if (call.callee.kind !== "PathExpression") return none();
  const { segments } = call.callee.path;
  if (segments.length !== 1) return none();
  const [structName] = segments;
  if (structName === undefined) return none();
  if (isSome(resolve(ctx, structName))) return none();
  const structDecl = lookupStruct(ctx, structName);
  if (structDecl === undefined) return none();
  const callee: Semantics.PathExpression = {
    ...call.callee,
    type: structDecl.type,
  };
  // Claim the call rather than falling through to `none()`, which would
  // otherwise surface a misleading "Cannot find name" for a real struct.
  if (structDecl.body.kind === "NamedFields") {
    emitError(
      ctx,
      `struct \`${structName}\` has named fields; use \`${structName} { ... }\``,
      call.tokenId,
      "HEDGE-TYPE-008",
    );
    return some({ callee, type: structDecl.type, args: [...args] });
  }
  if (structDecl.body.kind === "Unit") {
    // Unlike a unit enum variant, a unit struct has no construction syntax
    // yet at all - reject unconditionally rather than accepting `()`.
    emitError(
      ctx,
      `struct \`${structName}\` is a unit struct and cannot be constructed with \`()\``,
      call.tokenId,
      "HEDGE-TYPE-008",
    );
    return some({ callee, type: structDecl.type, args: [...args] });
  }
  const checkedArgs = checkGenericPositionalConstruction(
    ctx,
    call,
    { kindLabel: "struct", name: structName },
    structDecl.body.fields,
    args,
    structDecl.generics,
  );
  return some({ callee, type: structDecl.type, args: checkedArgs });
}

/**
 * `Enum::Variant`-shaped construction paths - the construction-side
 * counterpart to the pattern-position resolvers above, name-driven off the
 * path's segments rather than type-driven off a scrutinee. `none()` when
 * `segments[0]` isn't a known enum, falling through to the generic
 * multi-segment-path placeholder.
 *
 * Only resolves a bare unit-variant reference (`Message::Quit`) -
 * `analyzeCall`/`analyzeStructExpression` handle the call/struct-literal
 * forms themselves, since only they know the syntactic context. A bare
 * tuple/struct variant reference (`let x = Message::Move;`) still falls to
 * `none()` - real constructor-function-value semantics are out of scope.
 */
function analyzeEnumVariantPathConstruction(
  ctx: AnalysisContext,
  path: Parser.PathExpression,
  segments: readonly string[],
): Option<Semantics.PathExpression> {
  const [enumName, variantName] = segments;
  if (enumName === undefined || variantName === undefined) return none();
  const enumDecl = lookupEnum(ctx, enumName);
  if (enumDecl === undefined) {
    emitError(
      ctx,
      `cannot find enum \`${enumName}\` in this scope`,
      path.tokenId,
      "HEDGE-NAME-001",
    );
    return some({ ...path, type: UNIT });
  }
  const variant = enumDecl.variants.find((v) => v.name.text === variantName);
  if (variant === undefined) {
    emitError(
      ctx,
      `no variant \`${variantName}\` on enum \`${enumName}\``,
      path.tokenId,
      "HEDGE-NAME-004",
    );
    return some({ ...path, type: enumDecl.type });
  }
  if (isSome(variant.body)) return none();
  return some({ ...path, type: enumDecl.type });
}

function analyzePath(
  ctx: AnalysisContext,
  path: Parser.PathExpression,
): Semantics.PathExpression {
  const { segments } = path.path;
  if (segments.length === 2) {
    const construction = analyzeEnumVariantPathConstruction(
      ctx,
      path,
      segments,
    );
    if (isSome(construction)) return construction.value;
  }
  // Multi-segment paths (modules, associated items) are a later slice.
  if (segments.length !== 1) {
    return { ...path, type: { kind: "UnitType", tokenId: path.tokenId } };
  }
  const name = segments[0];
  if (name === undefined) {
    return { ...path, type: { kind: "UnitType", tokenId: path.tokenId } };
  }
  const resolvedType = resolve(ctx, name);
  if (isSome(resolvedType)) {
    return { ...path, type: resolvedType.value.type };
  }
  emitError(
    ctx,
    `Cannot find name "${name}" in this scope.`,
    path.tokenId,
    "HEDGE-NAME-001",
  );
  return { ...path, type: { kind: "UnitType", tokenId: path.tokenId } };
}

/**
 * Run semantic analysis (name resolution and type inference) over a parsed program.
 *
 * Slice-1 scope: a builtin prelude, then per-function and per-block scopes;
 * `let` binds into the current scope after its initializer is analyzed.
 */
export function analyze(
  program: Parser.Program,
  tokens: readonly Token[],
): AnalysisResult {
  const rootFrame = newScopeFrame();
  for (const [name, scopedVariable] of BUILTIN_SCOPE) {
    rootFrame.vars.set(name, scopedVariable);
  }
  const ctx: AnalysisContext = {
    frames: [rootFrame],
    diagnostics: [],
    tokens,
    constResolving: new Set(),
    genericParamStack: [],
    genericParamBoundStack: [],
    implRegistry: [],
    traitRegistry: new Map(),
    witnessTable: new Map(),
    selfContextStack: [],
  };
  // Before functions, so a signature can name any declared type.
  registerTypeDecls(ctx, program.items);
  const allItems = collectAllItems(program.items, 0);
  registerTraits(ctx, allItems);
  registerImpls(ctx, allItems);
  const topLevelFunctionNames = new Set<string>();
  for (const item of program.items) {
    if (item.kind !== "Function" && item.kind !== "FunctionSignature") {
      continue;
    }
    const signature = item.kind === "Function" ? item.signature : item;
    if (topLevelFunctionNames.has(signature.name.text)) {
      emitError(
        ctx,
        `function \`${signature.name.text}\` is defined more than once`,
        signature.name.tokenId,
        "HEDGE-NAME-002",
      );
    } else {
      topLevelFunctionNames.add(signature.name.text);
      bind(ctx, signature.name.text, {
        type: fnSignatureType(ctx, signature),
        mutable: false,
      });
    }
  }
  // A tuple struct's name shares the value namespace with functions -
  // checked after both loops above, so declaration order doesn't matter.
  for (const structDecl of currentFrame(ctx).types.values()) {
    if (
      structDecl.body.kind === "TupleFields" &&
      topLevelFunctionNames.has(structDecl.name.text)
    ) {
      emitError(
        ctx,
        `\`${structDecl.name.text}\` is defined multiple times: a function and a tuple struct constructor share the value namespace`,
        structDecl.name.tokenId,
        "HEDGE-NAME-002",
      );
    }
  }
  registerConstsAndStatics(ctx, program.items);
  const attributes = program.attributes.map((attr) =>
    analyzeAttribute(ctx, attr),
  );
  const items = program.items.map((item) => analyzeItem(ctx, item));
  return {
    diagnostics: ctx.diagnostics,
    program: { ...program, attributes, items },
    witnesses: ctx.witnessTable,
  };
}
