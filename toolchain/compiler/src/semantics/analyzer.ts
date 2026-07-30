import { assert, assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
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
import { hasCapability } from "./type-capabilities.js";

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly program: Semantics.Program;
}

/**
 * Mutable analysis context threaded explicitly through every pass function.
 * Maps onto `struct AnalysisContext { scopes: ..., diagnostics: ... }` in Hedge.
 */
interface AnalysisContext {
  readonly scopes: Map<string, ScopedVariable>[];
  readonly typeScope: Map<string, Semantics.StructDecl>;
  readonly enumScope: Map<string, Semantics.EnumDecl>;
  readonly diagnostics: Diagnostic[];
  readonly tokens: readonly Token[];
  /**
   * One frame per scope (top-level program is frame 0, then one pushed per
   * `analyzeBlock`), mirroring `scopes`. A name is looked up innermost-first
   * so a block-local const/static can shadow an outer one of the same name;
   * a name already used in the *current* frame is a redefinition diagnostic,
   * not shadowing (see `registerConstsAndStatics`).
   */
  readonly constDeclScopes: Map<string, Parser.ConstDecl>[];
  readonly constValueScopes: Map<string, ConstEntry>[];
  readonly staticTypeScopes: Map<string, Semantics.Type>[];
  /**
   * Flat, not scoped - only tracks names currently mid-resolution on the
   * call stack for cycle detection, which never spans scopes (an outer
   * const's fold can't recurse into an inner block that hasn't been entered
   * yet).
   */
  readonly constResolving: Set<string>;
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

/** Names and types available before any user code — Slice 1 prelude. */
const BUILTIN_SCOPE: [string, ScopedVariable][] = [
  [
    "print",
    {
      type: {
        kind: "FunctionType",
        params: [{ kind: "PrimitiveStringType" }],
        returnType: UNIT,
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
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (scope !== undefined) {
    scope.set(name, scopedVariable);
  }
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
 * this one, unchanged from before Hedge-47.
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
  // marker (Hedge-47), applied by `analyzePattern` itself once it reaches a
  // `mutable: true` struct/tuple-struct pattern node.
  const rootMutable = isSome(rootExpression)
    ? !isSome(placeMutabilityViolation(ctx, rootExpression.value, true))
    : false;
  const result = analyzePattern(ctx, pattern, effectiveType, mode, rootMutable);
  if (!isIrrefutablePattern(ctx, result)) {
    emitError(ctx, REFUTABLE_LET_OR_PARAM_PATTERN_MESSAGE, pattern.tokenId, none());
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
  for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
    const scope = ctx.scopes[i];
    if (scope !== undefined) {
      const type = scope.get(name);
      if (type !== undefined) return some(type);
    }
  }
  return none();
}

/**
 * Emits an error diagnostic message for a given token in the analysis context.
 *
 * @param ctx - The analysis context where the error will be recorded.
 * @param message - The error message to emit.
 * @param tokenId - The identifier of the token associated with the error.
 * @param extra - Additional information to attach to the error.
 */
function emitError(
  ctx: AnalysisContext,
  message: string,
  tokenId: number,
  extra: Option<{ readonly code: string }>,
): void {
  const token = ctx.tokens[tokenId];
  ctx.diagnostics.push({
    severity: "error",
    message,
    span: token !== undefined ? some(token.span) : none(),
    code: mapSome(extra, (e) => e.code),
    relatedSpans: [],
  });
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
        none(),
      );
      return none();
    case "Undeclared":
      emitError(
        ctx,
        `Cannot find name "${outcome.name}" in this scope.`,
        outcome.tokenId,
        none(),
      );
      return none();
    case "DivideByZero":
      emitError(
        ctx,
        "attempt to divide by zero in a constant expression",
        outcome.tokenId,
        none(),
      );
      return none();
    case "InvalidShift":
      emitError(
        ctx,
        "shift amount must be between 0 and 63 in a constant expression",
        outcome.tokenId,
        none(),
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
    emitError(ctx, "array length must be an integer", length.tokenId, none());
    return none();
  }
  if (outcome.value.value < 0n) {
    emitError(ctx, "array length cannot be negative", length.tokenId, none());
    return none();
  }
  if (outcome.value.value > BigInt(Number.MAX_SAFE_INTEGER)) {
    emitError(
      ctx,
      `array length ${outcome.value.value} is too large to represent`,
      length.tokenId,
      none(),
    );
    return none();
  }
  return some(Number(outcome.value.value));
}

function validateSlice1Type(
  ctx: AnalysisContext,
  type: Parser.Type,
  tokenId: number,
): Semantics.Type {
  switch (type.kind) {
    case "NamedType": {
      if (type.path.segments.length === 1) {
        const name = type.path.segments[0];
        assert(name !== undefined, "Name segment missing");
        const prim = namedTypeToPrimitive(name);
        if (isSome(prim)) {
          return prim.value;
        }
        const structDecl = ctx.typeScope.get(name);
        if (structDecl !== undefined) {
          return structDecl.type;
        }
        const enumDecl = ctx.enumScope.get(name);
        if (enumDecl !== undefined) {
          return enumDecl.type;
        }
      }
      break;
    }
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
    default:
      assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
  emitError(ctx, "type is not supported in Slice 1", tokenId, none());
  return { kind: "UnitType", tokenId };
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
    default:
      return none();
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
  for (let i = ctx.constDeclScopes.length - 1; i >= 0; i -= 1) {
    if (ctx.constDeclScopes[i]?.has(name)) {
      return i;
    }
  }
  return -1;
}

/**
 * Innermost frame index where `name` resolves as an ordinary binding
 * (let/param/function/static), or -1. `scopes` and `constDeclScopes` are
 * always pushed/popped together (`analyzeBlock`, `analyzeFunctionDecl`), so
 * comparing this against `findConstFrameIndex`'s result tells
 * `analyzeConstReference` whether a closer ordinary binding shadows an
 * outer const of the same name - a const's own frame index does not
 * appear in `scopes` at all (consts are never `bind()`-ed), so without
 * this check a same-named parameter or local `let` would be silently
 * ignored in favor of the const's inlined value.
 */
function scopeFrameIndexOf(ctx: AnalysisContext, name: string): number {
  for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
    if (ctx.scopes[i]?.has(name)) {
      return i;
    }
  }
  return -1;
}

function findStaticFrameIndex(ctx: AnalysisContext, name: string): number {
  for (let i = ctx.staticTypeScopes.length - 1; i >= 0; i -= 1) {
    if (ctx.staticTypeScopes[i]?.has(name)) {
      return i;
    }
  }
  return -1;
}

/** The declared type `registerConstsAndStatics` already resolved for a static - avoids re-validating it (and re-diagnosing a bad type) in `analyzeStaticDecl`. */
function resolveStaticType(ctx: AnalysisContext, name: string): Semantics.Type {
  const frameIndex = findStaticFrameIndex(ctx, name);
  assert(
    frameIndex >= 0,
    `resolveStaticType called for undeclared static \`${name}\``,
  );
  const type = ctx.staticTypeScopes[frameIndex]?.get(name);
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
 * initializer fold and, later, array-length const-folding (Hedge-200's
 * `[T; N]` restriction).
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
      none(),
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
  const valueFrame = ctx.constValueScopes[frameIndex];
  assert(valueFrame !== undefined, "const value scope frame missing");

  const cached = valueFrame.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const decl = ctx.constDeclScopes[frameIndex]?.get(name);
  assert(
    decl !== undefined,
    `resolveConstDecl found no decl for \`${name}\` in its own frame`,
  );

  const declaredType = validateSlice1Type(ctx, decl.type, decl.type.tokenId);
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
          none(),
        );
      }
      break;
    case "NotFoldable":
      emitError(
        ctx,
        `const \`${name}\`'s initializer must be a compile-time constant expression`,
        outcome.tokenId,
        none(),
      );
      break;
    case "DivideByZero":
      emitError(
        ctx,
        "attempt to divide by zero in a constant expression",
        outcome.tokenId,
        none(),
      );
      break;
    case "InvalidShift":
      emitError(
        ctx,
        "shift amount must be between 0 and 63 in a constant expression",
        outcome.tokenId,
        none(),
      );
      break;
    case "Undeclared":
      emitError(
        ctx,
        `Cannot find name "${outcome.name}" in this scope.`,
        outcome.tokenId,
        none(),
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
 * variable shadowing it. `scopes` and `staticTypeScopes` are always pushed
 * and popped together (`analyzeBlock`), so the frame where `name` is first
 * found in `scopes` has a corresponding `staticTypeScopes` entry if and only
 * if that binding actually came from a static, not a shadowing `let`/param.
 */
function resolvedNameIsStatic(ctx: AnalysisContext, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
    if (ctx.scopes[i]?.has(name)) {
      return ctx.staticTypeScopes[i]?.has(name) ?? false;
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
 * Registers every `Const`/`Static` declared directly in `items` into the
 * *current* (innermost) const/static scope frame - called once per scope,
 * right after that scope's frame is pushed (top-level `analyze()` for frame
 * 0, `analyzeBlock` for every nested one) and before any sequential
 * statement analysis, so forward/chained references within the same scope
 * resolve regardless of textual order. A name already registered in this
 * same frame is a redefinition diagnostic; a name only present in an outer
 * frame is shadowing, which is allowed.
 */
// eslint-disable-next-line complexity -- Registration loop with a duplicate/collision/pub-rejection branch per item kind; each is a necessary, independent check.
function registerConstsAndStatics(
  ctx: AnalysisContext,
  items: readonly Parser.Item[],
): void {
  const constFrame = ctx.constDeclScopes[ctx.constDeclScopes.length - 1];
  const staticFrame = ctx.staticTypeScopes[ctx.staticTypeScopes.length - 1];
  assert(
    constFrame !== undefined && staticFrame !== undefined,
    "registerConstsAndStatics called with no active scope frame",
  );
  const currentScope = ctx.scopes[ctx.scopes.length - 1];
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
      if (constFrame.has(item.name.text)) {
        emitError(
          ctx,
          `const \`${item.name.text}\` is defined more than once`,
          item.name.tokenId,
          none(),
        );
      } else {
        // A same-frame static collision is reported once, from the static
        // branch below (via `constNamesInFrame`) - skip the function check
        // here for a name that's actually a static, so a static processed
        // earlier in this same loop (and thus already `bind()`-ed into
        // `currentScope`) doesn't produce a second, mislabeled diagnostic.
        if (
          !staticFrame.has(item.name.text) &&
          currentScope?.has(item.name.text)
        ) {
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
            none(),
          );
        }
        constFrame.set(item.name.text, item);
      }
    } else if (item.kind === "Static") {
      if (staticFrame.has(item.name.text)) {
        emitError(
          ctx,
          `static \`${item.name.text}\` is defined more than once`,
          item.name.tokenId,
          none(),
        );
      } else {
        if (constNamesInFrame.has(item.name.text)) {
          // A static lowers to a real accessor function of its own name
          // (see jsim.ts's StaticDecl lowering), but a reference to this
          // name always tries the const first (`analyzeConstReference`),
          // making the static unreachable/ambiguous either way.
          emitError(
            ctx,
            `static \`${item.name.text}\` collides with a const of the same name`,
            item.name.tokenId,
            none(),
          );
        } else if (currentScope?.has(item.name.text)) {
          // A static lowers to a real top-level accessor function of its
          // own name (see jsim.ts's StaticDecl lowering) - sharing a name
          // with an existing function would collide at codegen, not just
          // shadow. Still registers below so `analyzeStaticDecl` has an
          // entry to resolve; the diagnostic already blocks codegen.
          emitError(
            ctx,
            `static \`${item.name.text}\` collides with an existing function name`,
            item.name.tokenId,
            none(),
          );
        }
        if (isSome(item.visibility)) {
          emitError(ctx, "static items cannot be pub yet", item.tokenId, none());
        }
        const declaredType = validateSlice1Type(
          ctx,
          item.type,
          item.type.tokenId,
        );
        staticFrame.set(item.name.text, declaredType);
        bind(ctx, item.name.text, { type: declaredType, mutable: false });
      }
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
      none(),
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
  const scopedName = `scoped(${ctx.scopes.length})::${item.name.text}`;
  const enumType: Semantics.Type = { kind: "EnumType", name: scopedName };
  const seenVariantNames = new Set<string>();
  for (const variant of item.variants) {
    if (seenVariantNames.has(variant.name.text)) {
      emitError(
        ctx,
        `variant \`${variant.name.text}\` is defined more than once`,
        variant.name.tokenId,
        none(),
      );
    }
    seenVariantNames.add(variant.name.text);
  }
  return {
    ...item,
    name: { ...item.name, type: enumType },
    generics: [],
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    variants: item.variants.map((variant) =>
      analyzeVariant(ctx, variant, enumType),
    ),
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

// `LetExpression` only ever appears as (or within) an `if`/`while`
// condition (see `parser/ast.ts`'s doc comment on the type) - this message
// covers both the `if let` and `while let` surface forms.
const LET_EXPRESSION_NOT_YET_SUPPORTED_MESSAGE =
  "`if let`/`while let` are not yet supported by semantic analysis";

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
  emitError(ctx, message, tokenId, none());
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
// (Hedge-47 promoted struct/tuple-struct/fixed-length-slice patterns, but
// not these). The message deliberately doesn't name a specific position -
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
  emitError(ctx, PATTERN_KIND_NOT_YET_SUPPORTED_MESSAGE, pattern.tokenId, none());
  return {
    kind: "WildcardPattern",
    tokenId: pattern.tokenId,
    type: scrutineeType,
  };
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
 * being crossed (Hedge-25's rule for `&mut` through a `Deref` of a shared
 * reference), regardless of `rootMutable`. `defaultMode === "mut"` always
 * allows it (an `&mut` scrutinee's own chain permits further `&mut`
 * sub-borrows). `defaultMode === "owned"` defers to `rootMutable` - whether
 * the scrutinee/initializer's own root place is mutable (from
 * `placeMutabilityViolation`), or a `mut`-marked ancestor struct/tuple-struct
 * pattern (Hedge-47) stood in for it.
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
      none(),
    );
    return;
  }
  if (defaultMode === "owned" && !rootMutable) {
    emitError(
      ctx,
      `cannot bind \`${name}\` as \`&mut\` because the underlying place is not mutable`,
      tokenId,
      none(),
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
  const decl = ctx.enumScope.get(name);
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
  const decl = ctx.typeScope.get(name);
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
      none(),
    );
    return none();
  }
  if (!isSome(variant.body) || variant.body.value.kind !== "TupleFields") {
    emitError(
      ctx,
      `variant \`${variantName}\` is not a tuple variant`,
      pattern.tokenId,
      none(),
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
      none(),
    );
    return none();
  }
  if (!isSome(variant.body) || variant.body.value.kind !== "NamedFields") {
    emitError(
      ctx,
      `variant \`${variantName}\` is not a struct variant`,
      pattern.tokenId,
      none(),
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
      none(),
    );
    return some({ fields: [], label, alreadyErrored: true });
  }
  if (structDecl.value.body.kind !== "TupleFields") {
    emitError(
      ctx,
      `struct \`${patternName}\` is not a tuple struct`,
      pattern.tokenId,
      none(),
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
      none(),
    );
    return some({ fields: [], label, alreadyErrored: true });
  }
  if (structDecl.value.body.kind !== "NamedFields") {
    emitError(
      ctx,
      `struct \`${patternName}\` does not have named fields`,
      pattern.tokenId,
      none(),
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

// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function analyzePattern(
  ctx: AnalysisContext,
  pattern: Parser.Pattern,
  scrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.Pattern {
  switch (pattern.kind) {
    case "WildcardPattern": {
      const result: Semantics.WildcardPattern = {
        ...pattern,
        type: scrutineeType,
      };
      return result;
    }
    case "BindingPattern": {
      if (isSome(pattern.subpattern)) {
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
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
      const result: Semantics.BindingPattern = {
        ...pattern,
        name: { ...pattern.name, type: boundType },
        subpattern: none(),
        type: boundType,
      };
      return result;
    }
    case "LiteralPattern": {
      const literal = analyzeLiteralValue(ctx, pattern.literal);
      const result: Semantics.LiteralPattern = {
        ...pattern,
        literal,
        type: literal.type,
      };
      return result;
    }
    case "RangePattern": {
      const start = analyzeLiteralValue(ctx, pattern.start.literal);
      const end = analyzeLiteralValue(ctx, pattern.end.literal);
      const startBound: Semantics.RangePatternBound = {
        ...pattern.start,
        literal: start,
      };
      const endBound: Semantics.RangePatternBound = {
        ...pattern.end,
        literal: end,
      };
      const result: Semantics.RangePattern = {
        ...pattern,
        start: startBound,
        end: endBound,
        type: start.type,
      };
      return result;
    }
    case "OrPattern": {
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
      return result;
    }
    case "PathPattern": {
      const enumDecl = resolveEnumDecl(ctx, scrutineeType);
      if (!isSome(enumDecl)) {
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
      const variantName = lastPathSegment(pattern.path);
      const variant = enumDecl.value.variants.find(
        (v) => v.name.text === variantName,
      );
      if (variant === undefined) {
        emitError(
          ctx,
          `no variant \`${variantName}\` on enum \`${describeType(scrutineeType)}\``,
          pattern.tokenId,
          none(),
        );
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
      if (isSome(variant.body)) {
        emitError(
          ctx,
          `variant \`${variantName}\` has fields; use \`${variantName}(...)\` or \`${variantName} { ... }\``,
          pattern.tokenId,
          none(),
        );
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
      const result: Semantics.PathPattern = { ...pattern, type: scrutineeType };
      return result;
    }
    case "TupleStructPattern": {
      const resolved = resolveTupleFieldsForPattern(
        ctx,
        pattern,
        scrutineeType,
      );
      if (!isSome(resolved)) {
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
      const { fields, label, alreadyErrored } = resolved.value;
      if (!alreadyErrored && fields.length !== pattern.elements.length) {
        emitError(
          ctx,
          `${label} has ${fields.length} field(s), but the pattern has ${pattern.elements.length}`,
          pattern.tokenId,
          none(),
        );
      }
      // A `mut` sigil on this whole tuple-struct pattern (Hedge-47) treats
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
      const result: Semantics.TupleStructPattern = {
        ...pattern,
        elements,
        type: scrutineeType,
      };
      return result;
    }
    case "StructPattern": {
      const resolved = resolveNamedFieldsForPattern(
        ctx,
        pattern,
        scrutineeType,
      );
      if (!isSome(resolved)) {
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
      const { fields: declaredFields, label, alreadyErrored } = resolved.value;
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
            none(),
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
      const result: Semantics.StructPattern = {
        ...pattern,
        fields,
        type: scrutineeType,
      };
      return result;
    }
    case "SlicePattern": {
      // A dynamic-length scrutinee has no real type to destructure against
      // yet (no `Vec`/slice type exists - Slice 5), so only a fixed-length
      // `ArrayType` is promoted to real semantics here; anything else still
      // falls to the generic guardrail, unchanged from before Hedge-47.
      if (scrutineeType.kind !== "ArrayType") {
        return analyzePatternGuardrail(ctx, pattern, scrutineeType);
      }
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
          none(),
        );
      } else {
        const hasRest = restCount === 1;
        const arityOk = hasRest
          ? nonRestCount <= length
          : nonRestCount === length;
        if (!arityOk) {
          emitError(
            ctx,
            hasRest
              ? `array has ${length} element(s), but the pattern requires at least ${nonRestCount}`
              : `array has ${length} element(s), but the pattern requires exactly ${nonRestCount}`,
            pattern.tokenId,
            none(),
          );
        }
      }
      // Only meaningful when a single rest is present (`hasRest` above) -
      // harmless to compute unconditionally otherwise, since nothing reads
      // it without a `RestPattern` element to apply it to.
      const restLength = length - nonRestCount;
      const elements = pattern.elements.map(
        (el): Semantics.Pattern | Semantics.RestPattern => {
          if (el.kind !== "RestPattern") {
            return analyzePattern(
              ctx,
              el,
              elementType,
              defaultMode,
              rootMutable,
            );
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
          const result: Semantics.RestPattern = {
            ...el,
            name: some({ ...el.name.value, type: boundType }),
          };
          return result;
        },
      );
      const result: Semantics.SlicePattern = {
        ...pattern,
        elements,
        type: scrutineeType,
      };
      return result;
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
      none(),
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
    const consistent = rest.every(
      (occ) =>
        typesEqual(first.type, occ.type) &&
        first.byRef === occ.byRef &&
        first.mutable === occ.mutable,
    );
    if (!consistent) {
      emitError(
        ctx,
        `or-pattern alternatives must bind \`${name}\` with the same type and mode in every alternative`,
        pattern.tokenId,
        none(),
      );
    }
  }
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
      // A genuine `Semantics.SlicePattern` is only ever constructed against
      // a fixed-length `ArrayType` scrutinee (`analyzePattern`'s own
      // guardrail substitutes a `WildcardPattern` for anything else) - the
      // array's length is statically known, so the pattern either always
      // matches or never does (an arity mismatch, its own separate
      // diagnostic already emitted at that point) - never "maybe matches
      // at runtime" the way a literal/range truly is. Treating it as
      // irrefutable either way avoids a redundant non-exhaustive diagnostic
      // stacking on top of the arity-mismatch one.
      return true;
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
 * Reports an arm as unreachable when it is fully subsumed by the arms
 * before it, in source order. A guarded arm's own coverage is never added
 * to `coveredVariants`/`coveredBools` - a guard means "maybe matches", so
 * it can't unconditionally cover anything for arms after it. Only
 * enum-variant and bool coverage get real subsumption tracking (mirrors
 * `checkMatchExhaustiveness`'s own scope); every other scrutinee type only
 * ever hits the irrefutable-catch-all rule below.
 */
// eslint-disable-next-line complexity -- Enum/bool/general-catch-all branches, each a simple check
function checkUnreachableArms(
  ctx: AnalysisContext,
  arms: readonly Semantics.MatchArm[],
  scrutineeType: Semantics.Type,
): void {
  const enumDecl = resolveEnumDecl(ctx, scrutineeType);
  const isBool = scrutineeType.kind === "PrimitiveBooleanType";
  const coveredVariants = new Set<string>();
  const coveredBools = new Set<boolean>();
  let hasCatchAll = false;

  for (const arm of arms) {
    if (hasCatchAll) {
      emitError(ctx, "unreachable pattern", arm.tokenId, none());
    } else if (isSome(enumDecl)) {
      const thisArmVariants = new Set<string>();
      collectCoveredVariantNames(arm.pattern, thisArmVariants);
      if (
        thisArmVariants.size > 0 &&
        [...thisArmVariants].every((name) => coveredVariants.has(name))
      ) {
        emitError(ctx, "unreachable pattern", arm.tokenId, none());
      }
    } else if (isBool) {
      const thisArmBools = new Set<boolean>();
      collectCoveredBoolValues(arm.pattern, thisArmBools);
      if (
        thisArmBools.size > 0 &&
        [...thisArmBools].every((v) => coveredBools.has(v))
      ) {
        emitError(ctx, "unreachable pattern", arm.tokenId, none());
      }
    }

    if (isNone(arm.guard)) {
      if (isIrrefutablePattern(ctx, arm.pattern)) {
        hasCatchAll = true;
      } else if (isSome(enumDecl)) {
        collectCoveredVariantNames(arm.pattern, coveredVariants);
      } else if (isBool) {
        collectCoveredBoolValues(arm.pattern, coveredBools);
      }
    }
  }
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

  const enumDecl = resolveEnumDecl(ctx, scrutineeType);
  if (isSome(enumDecl)) {
    const covered = new Set<string>();
    for (const arm of arms) {
      if (isNone(arm.guard)) collectCoveredVariantNames(arm.pattern, covered);
    }
    const missing = enumDecl.value.variants
      .map((v) => v.name.text)
      .filter((name) => !covered.has(name));
    if (missing.length > 0) {
      emitError(
        ctx,
        `non-exhaustive patterns: \`${missing.join("`, `")}\` not covered`,
        matchExpr.tokenId,
        none(),
      );
    }
    return;
  }

  if (scrutineeType.kind === "PrimitiveBooleanType") {
    const covered = new Set<boolean>();
    for (const arm of arms) {
      if (isNone(arm.guard)) collectCoveredBoolValues(arm.pattern, covered);
    }
    const missing: string[] = [];
    if (!covered.has(true)) missing.push("true");
    if (!covered.has(false)) missing.push("false");
    if (missing.length > 0) {
      emitError(
        ctx,
        `non-exhaustive patterns: \`${missing.join("`, `")}\` not covered`,
        matchExpr.tokenId,
        none(),
      );
    }
    return;
  }

  emitError(ctx, "non-exhaustive patterns: `_` not covered", matchExpr.tokenId, none());
}

function analyzeMatchArm(
  ctx: AnalysisContext,
  arm: Parser.MatchArm,
  effectiveScrutineeType: Semantics.Type,
  defaultMode: PatternBindingMode,
  rootMutable: boolean,
): Semantics.MatchArm {
  ctx.scopes.push(new Map());
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
    ctx.scopes.pop();
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
      emitError(ctx, "match arms have incompatible types", matchExpr.tokenId, none());
      break;
    }
  }

  return { ...matchExpr, scrutinee, arms, type: resultType };
}

function analyzeItem(ctx: AnalysisContext, item: Parser.Item): Semantics.Item {
  switch (item.kind) {
    case "Function":
      return analyzeFunctionDecl(ctx, item);
    case "Struct": {
      const cached = ctx.typeScope.get(item.name.text);
      return cached !== undefined && cached.tokenId === item.tokenId
        ? cached
        : analyzeStruct(ctx, item);
    }
    case "Enum": {
      const cached = ctx.enumScope.get(item.name.text);
      return cached !== undefined && cached.tokenId === item.tokenId
        ? cached
        : analyzeEnum(ctx, item);
    }
    case "Const":
      return analyzeConstStatement(ctx, item);
    case "Static":
      return analyzeStaticDecl(ctx, item);
    case "LetStatement":
    case "ExpressionStatement": {
      emitError(ctx, TOP_LEVEL_ITEM_RESTRICTION_MESSAGE, item.tokenId, none());
      const prevLen = ctx.diagnostics.length;
      const analyzed = analyzeStatement(ctx, item);
      ctx.diagnostics.splice(prevLen); // suppress cascading errors — the restriction error is good enough
      return analyzed;
    }
    default:
      emitError(ctx, TOP_LEVEL_ITEM_RESTRICTION_MESSAGE, item.tokenId, none());
      return analyzeExpression(ctx, item);
  }
}

function analyzeStruct(
  ctx: AnalysisContext,
  item: Parser.StructDecl,
): Semantics.StructDecl {
  const scopedName = `scoped(${ctx.scopes.length})::${item.name.text}`;
  return {
    ...item,
    name: { ...item.name, type: { kind: "StructType", name: scopedName } },
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    body: analyzeStructBody(ctx, item.body),
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

function resolveSlice1Type(
  type: Parser.Type,
  fallbackTokenId: number,
): Semantics.Type {
  switch (type.kind) {
    case "NamedType": {
      if (type.path.segments.length === 1) {
        const name = type.path.segments[0];
        assert(name !== undefined, "Name segment missing");
        const prim = namedTypeToPrimitive(name);
        if (isSome(prim)) return prim.value;
      }
      return { kind: "UnitType", tokenId: fallbackTokenId };
    }
    case "UnitType":
      return type;
    case "ReferenceType":
      return {
        kind: "ReferenceType",
        tokenId: fallbackTokenId,
        mutable: type.mutable,
        referent: resolveSlice1Type(type.referent, type.referent.tokenId),
      };
    case "ArrayType":
      return {
        kind: "ArrayType",
        elementType: resolveSlice1Type(
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
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function fnSignatureType(fn: Parser.FunctionDecl): Semantics.FunctionType {
  return {
    kind: "FunctionType",
    params: fn.params.map((p) => resolveSlice1Type(p.type, p.type.tokenId)),
    returnType: isSome(fn.returnType)
      ? resolveSlice1Type(fn.returnType.value, fn.returnType.value.tokenId)
      : { kind: "UnitType", tokenId: fn.tokenId },
  };
}

/**
 * Checks a function body's trailing-expression type against its declared
 * (or implicit-unit) return type, coercing an unsuffixed-integer-literal
 * trailing expression first. A body with no trailing expression at all
 * (e.g. `fn f() -> i32 { let x = 1; }`) takes the early-return branch below
 * instead — it's checked for a missing return value there, not for a type
 * mismatch, since there's no trailing-expression type to reconcile against.
 *
 * Cascade guard: if the trailing expression's own analysis already failed
 * (its type is the `UnitType` error-recovery placeholder), no diagnostic is
 * emitted here — see {@link reconcileExpressionType}.
 */
/**
 * `operand` is a fresh borrow of a plain value that lives only in this
 * function's own frame - a `let`-local or a by-value parameter - when it
 * is a bare single-segment path whose own type is not already a
 * reference. A reference-typed operand (an incoming `&T` parameter, or a
 * dereference of one) means the borrow is grounded in something the
 * caller owns, not this frame. This is Hedge-26's narrow, single-hop
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
    some({ code: "HEDGE-LIFETIME-002" }),
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
      some({ code: "HEDGE-LIFETIME-002" }),
    );
  }
}

/**
 * Hedge-26's narrow "borrow outliving referent" check: a function's
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
): Semantics.Block {
  if (!isSome(body.trailingExpression)) {
    if (expectedReturnType.kind !== "UnitType") {
      emitError(
        ctx,
        `missing return value: expected \`${describeType(expectedReturnType)}\``,
        body.tokenId,
        none(),
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
    emitError(
      ctx,
      `return type mismatch: expected \`${describeType(expectedReturnType)}\`, found \`${describeType(getType(expr))}\``,
      trailing.tokenId,
      none(),
    );
  } else {
    checkEscapingReference(ctx, expr);
  }

  return expr === trailing
    ? body
    : { ...body, trailingExpression: some(expr), type: getType(expr) };
}

function analyzeFunctionDecl(
  ctx: AnalysisContext,
  decl: Parser.FunctionDecl,
): Semantics.FunctionDecl {
  // Pushed in lockstep with `scopes` (matching `analyzeBlock`'s own
  // invariant) even though a const/static can never actually be declared
  // in param position - `resolvedNameIsStatic` and the const-shadowing
  // check in `analyzeConstReference` both compare frame *indices* across
  // `scopes` and these stacks, which only lines up if every `scopes` push
  // has a matching push here, everywhere, not just in `analyzeBlock`.
  ctx.scopes.push(new Map());
  ctx.constDeclScopes.push(new Map());
  ctx.constValueScopes.push(new Map());
  ctx.staticTypeScopes.push(new Map());
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
  const body = checkFunctionReturnType(
    ctx,
    analyzeBlock(ctx, decl.body),
    expectedReturnType,
  );
  const result: Semantics.FunctionDecl = {
    ...decl,
    name: {
      ...decl.name,
      type: { kind: "UnitType", tokenId: decl.name.tokenId },
    },
    attributes: decl.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    generics: [],
    params: analyzedParams,
    returnType,
    body,
  };
  ctx.scopes.pop();
  ctx.constDeclScopes.pop();
  ctx.constValueScopes.pop();
  ctx.staticTypeScopes.pop();
  return result;
}

function analyzeBlock(
  ctx: AnalysisContext,
  block: Parser.Block,
): Semantics.Block {
  ctx.scopes.push(new Map());
  ctx.constDeclScopes.push(new Map());
  ctx.constValueScopes.push(new Map());
  ctx.staticTypeScopes.push(new Map());
  const typeScopeBefore = new Set(ctx.typeScope.keys());
  const enumScopeBefore = new Set(ctx.enumScope.keys());
  registerConstsAndStatics(ctx, block.statements);
  const analyzedStatements = block.statements.map((statement) =>
    analyzeStatement(ctx, statement),
  );
  const analyzedTrailing = mapSome(block.trailingExpression, (expr) =>
    analyzeExpression(ctx, expr),
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
  ctx.scopes.pop();
  ctx.constDeclScopes.pop();
  ctx.constValueScopes.pop();
  ctx.staticTypeScopes.pop();
  for (const key of ctx.typeScope.keys()) {
    if (!typeScopeBefore.has(key)) ctx.typeScope.delete(key);
  }
  for (const key of ctx.enumScope.keys()) {
    if (!enumScopeBefore.has(key)) ctx.enumScope.delete(key);
  }
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
      bind(ctx, statement.name.text, {
        type: fnSignatureType(statement),
        mutable: false,
      });
      return analyzeFunctionDecl(ctx, statement);
    }
    case "Struct": {
      if (ctx.typeScope.has(statement.name.text)) {
        emitError(
          ctx,
          `struct \`${statement.name.text}\` is defined more than once`,
          statement.name.tokenId,
          none(),
        );
      }
      const analyzed = analyzeStruct(ctx, statement);
      ctx.typeScope.set(statement.name.text, analyzed);
      return analyzed;
    }
    case "Enum": {
      if (ctx.enumScope.has(statement.name.text)) {
        emitError(
          ctx,
          `enum \`${statement.name.text}\` is defined more than once`,
          statement.name.tokenId,
          none(),
        );
      }
      const analyzed = analyzeEnum(ctx, statement);
      ctx.enumScope.set(statement.name.text, analyzed);
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
  const analyzedInitializer: Option<Semantics.Expression> = mapSome(
    statement.initializer,
    (initializer) => analyzeExpression(ctx, initializer),
  );

  let coercedInitializer: Option<Semantics.Expression> = analyzedInitializer;
  let bindingType: Semantics.Type;
  if (isSome(analyzedInitializer)) {
    bindingType = getType(analyzedInitializer.value);
    if (isSome(statement.type)) {
      const annotationType = validateSlice1Type(
        ctx,
        statement.type.value,
        statement.tokenId,
      );
      const { expr, mismatch } = reconcileExpressionType(
        ctx,
        analyzedInitializer.value,
        annotationType,
        statement.tokenId,
      );
      coercedInitializer = some(expr);
      if (mismatch) {
        emitError(
          ctx,
          "type mismatch: explicit annotation does not match initializer type",
          statement.tokenId,
          none(),
        );
      }
      bindingType = annotationType;
    } else if (
      analyzedInitializer.value.kind === "ArrayExpression" &&
      analyzedInitializer.value.elements.length === 0
    ) {
      emitError(
        ctx,
        "cannot infer element type of an empty array literal without an explicit type annotation",
        statement.tokenId,
        none(),
      );
    }
  } else if (isSome(statement.type)) {
    bindingType = validateSlice1Type(
      ctx,
      statement.type.value,
      statement.tokenId,
    );
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

const INT_BOUNDS: Partial<Record<Semantics.Type["kind"], [bigint, bigint]>> = {
  PrimitiveI8Type: [-0x80n, 0x7fn],
  PrimitiveI16Type: [-0x8000n, 0x7fffn],
  PrimitiveI32Type: [-0x8000_0000n, 0x7fff_ffffn],
  PrimitiveI64Type: [-0x8000_0000_0000_0000n, 0x7fff_ffff_ffff_ffffn],
  PrimitiveU8Type: [0n, 0xffn],
  PrimitiveU16Type: [0n, 0xffffn],
  PrimitiveU32Type: [0n, 0xffff_ffffn],
  PrimitiveU64Type: [0n, 0xffff_ffff_ffff_ffffn],
  PrimitiveUsizeType: [0n, 0xffff_ffffn],
  PrimitiveIsizeType: [-0x8000_0000n, 0x7fff_ffffn],
};

const NEG_FLOAT_MAX: Partial<Record<Semantics.Type["kind"], number>> = {
  PrimitiveF32Type: 3.4028234663852886e38,
  PrimitiveF64Type: 1.7976931348623157e308,
};

const NUMERIC_TYPE_NAME: Partial<Record<Semantics.Type["kind"], string>> = {
  PrimitiveI8Type: "i8",
  PrimitiveI16Type: "i16",
  PrimitiveI32Type: "i32",
  PrimitiveI64Type: "i64",
  PrimitiveIsizeType: "isize",
  PrimitiveU8Type: "u8",
  PrimitiveU16Type: "u16",
  PrimitiveU32Type: "u32",
  PrimitiveU64Type: "u64",
  PrimitiveUsizeType: "usize",
  PrimitiveF32Type: "f32",
  PrimitiveF64Type: "f64",
};

/**
 * Renders a {@link Semantics.Type} as the name a diagnostic should show the
 * user (`i32`, `bool`, `str`, a struct's simple name, `()`). Complements
 * {@link NUMERIC_TYPE_NAME}, which only covers the numeric kinds.
 */
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
    default:
      return NUMERIC_TYPE_NAME[type.kind] ?? type.kind;
  }
}

function checkNegLiteralRange(
  operand: Semantics.Expression,
  annotationType: Semantics.Type,
): Option<string> {
  const typeName = NUMERIC_TYPE_NAME[annotationType.kind];
  if (typeName === undefined) return none();

  if (operand.kind === "IntLiteral") {
    const val = -intLiteralValue(operand);
    const [min, max] = INT_BOUNDS[annotationType.kind] ?? [];
    if (min === undefined || max === undefined) {
      return some(`unexpected int-literal range check for type ${typeName}`);
    }
    if (val > max || val < min) {
      return some(`out of range for ${typeName}`);
    }
  } else if (operand.kind === "FloatLiteral") {
    const val = parseFloat(operand.value);
    const max = NEG_FLOAT_MAX[annotationType.kind];
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
  const bounds = INT_BOUNDS[type.kind];
  if (bounds === undefined) return;
  const val = intLiteralValue(literal);
  const [, max] = bounds;
  if (val > max) {
    const name = NUMERIC_TYPE_NAME[type.kind] ?? type.kind;
    emitError(ctx, `out of range for ${name}`, literal.tokenId, none());
  }
}

function isUnsuffixedLiteralExpr(expr: Semantics.Expression): boolean {
  if (expr.kind === "IntLiteral" && !isSome(expr.suffix)) return true;
  return (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral" &&
    !isSome(expr.operand.suffix)
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
      emitError(ctx, rangeError.value, expr.operand.tokenId, none());
    }
  }
}

function typesEqual(a: Semantics.Type, b: Semantics.Type): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "StructType" && b.kind === "StructType")
    return a.name === b.name;
  if (a.kind === "EnumType" && b.kind === "EnumType") return a.name === b.name;
  if (a.kind === "ReferenceType" && b.kind === "ReferenceType")
    return a.mutable === b.mutable && typesEqual(a.referent, b.referent);
  if (a.kind === "ArrayType" && b.kind === "ArrayType")
    return a.length === b.length && typesEqual(a.elementType, b.elementType);
  return true;
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
const AMBIGUOUS_UNIT_EXPR_KINDS: ReadonlySet<Semantics.Expression["kind"]> =
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
 * Reconciles an analyzed expression against an `expectedType` context — a
 * `let` binding's explicit annotation, a function's declared return type, or
 * a struct field's declared type — applying Slice 1's unsuffixed-integer-
 * literal coercion (0010-primitive-types.md: an unconstrained literal adopts
 * the type its context expects) and negative-literal range checks before
 * falling back to a plain type-equality comparison.
 *
 * Callers are responsible for (a) emitting their own call-site-specific
 * message when `mismatch` is true, and (b) running {@link checkPosLiteralRange}
 * on the result if it is an `IntLiteral` — kept out of this helper so each
 * call site performs the positive-range check exactly once.
 *
 * Cascade guard: `mismatch` is always `false` when the resolved expression's
 * type is the `UnitType` error-recovery placeholder (see
 * {@link isAmbiguousUnitExpr}) — that failure already reported its own
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
      emitError(ctx, rangeError.value, tokenId, none());
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

// eslint-disable-next-line complexity -- This is a routing function
function inferBinaryType(
  ctx: AnalysisContext,
  op: Parser.BinaryOperator,
  left: Semantics.Expression,
  right: Semantics.Expression,
  tokenId: number,
): Semantics.Type {
  const bool: Semantics.Type = { kind: "PrimitiveBooleanType" };

  const leftType = getType(left);
  const rightType = getType(right);

  // UnitType is ambiguous: it's either the error-recovery placeholder from a
  // failed sub-analysis, or a genuine unit value (e.g. a `print(...)` call).
  // Only suppress cascading type errors for the former — see
  // isAmbiguousUnitExpr.
  const isLeftTypeValid =
    leftType.kind !== "UnitType" || !isAmbiguousUnitExpr(left);
  const isRightTypeValid =
    rightType.kind !== "UnitType" || !isAmbiguousUnitExpr(right);

  switch (op) {
    case "Eq":
    case "Ne": {
      const leftEq = !isLeftTypeValid || hasCapability(leftType, "equality");
      const rightEq = !isRightTypeValid || hasCapability(rightType, "equality");
      if (!leftEq || !rightEq) {
        emitError(ctx, "type does not support equality comparison", tokenId, none());
      } else if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "comparison operands must have the same type", tokenId, none());
      }
      return bool;
    }

    case "Lt":
    case "Gt":
    case "Le":
    case "Ge": {
      const leftOrd = !isLeftTypeValid || hasCapability(leftType, "ordering");
      const rightOrd =
        !isRightTypeValid || hasCapability(rightType, "ordering");
      if (!leftOrd || !rightOrd) {
        emitError(ctx, "type does not support ordering comparison", tokenId, none());
      } else if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "comparison operands must have the same type", tokenId, none());
      }
      return bool;
    }

    case "And":
    case "Or": {
      if (isLeftTypeValid && !hasCapability(leftType, "logical")) {
        emitError(ctx, "logical operator operands must be `bool`", tokenId, none());
      }
      if (isRightTypeValid && !hasCapability(rightType, "logical")) {
        emitError(ctx, "logical operator operands must be `bool`", tokenId, none());
      }
      return bool;
    }

    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "Rem": {
      if (isLeftTypeValid && !hasCapability(leftType, "arithmetic")) {
        emitError(
          ctx,
          `arithmetic operands must be numeric; left-operand is type \`${describeType(leftType)}\``,
          tokenId,
          none(),
        );
      }
      if (isRightTypeValid && !hasCapability(rightType, "arithmetic")) {
        emitError(
          ctx,
          `arithmetic operands must be numeric; right-operand is type \`${describeType(rightType)}\``,
          tokenId,
          none(),
        );
      }
      if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "arithmetic operands must have the same type", tokenId, none());
      }
      return isLeftTypeValid ? leftType : rightType;
    }

    case "Shl":
    case "Shr":
    case "BitAnd":
    case "BitXor":
    case "BitOr": {
      if (isLeftTypeValid && !hasCapability(leftType, "bitwise")) {
        emitError(ctx, "bitwise operations require integer operands", tokenId, none());
      }
      if (isRightTypeValid && !hasCapability(rightType, "bitwise")) {
        emitError(ctx, "bitwise operations require integer operands", tokenId, none());
      }
      if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "bitwise operands must have the same type", tokenId, none());
      }
      return isLeftTypeValid ? leftType : rightType;
    }
    default:
      assertNever(op, `Unexpected binary operator: ${JSON.stringify(op)}`);
  }
}

// eslint-disable-next-line complexity -- This is a routing function
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
    case "PathExpression": {
      const constRef = analyzeConstReference(ctx, expression);
      if (isSome(constRef)) return constRef.value;
      const staticRef = analyzeStaticReference(ctx, expression);
      if (isSome(staticRef)) return staticRef.value;
      return analyzePath(ctx, expression);
    }
    case "CallExpression":
      return analyzeCall(ctx, expression);
    case "ReferenceExpression":
      return analyzeReferenceExpression(ctx, expression);
    case "DereferenceExpression":
      return analyzeDereferenceExpression(ctx, expression);
    case "BinaryExpression": {
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
    case "UnaryExpression": {
      const operand =
        expression.operator === "Neg" &&
        expression.operand.kind === "IntLiteral"
          ? analyzeIntLiteral(ctx, expression.operand, true)
          : analyzeExpression(ctx, expression.operand);
      const type: Semantics.Type =
        expression.operator === "Not"
          ? { kind: "PrimitiveBooleanType" }
          : getType(operand);
      if (
        expression.operator === "Neg" &&
        operand.kind === "IntLiteral" &&
        isSome(operand.suffix)
      ) {
        const rangeError = checkNegLiteralRange(operand, type);
        if (isSome(rangeError))
          emitError(ctx, rangeError.value, operand.tokenId, none());
      }
      return { ...expression, operand, type };
    }
    case "AssignExpression":
      return analyzeAssignmentExpression(ctx, expression);
    case "CompoundAssignExpression":
      return analyzeCompoundAssignmentExpression(ctx, expression);
    case "FieldAccessExpression":
      return analyzeFieldAccessExpression(ctx, expression);
    case "MethodCallExpression": {
      const receiver = analyzeExpression(ctx, expression.receiver);
      return {
        ...expression,
        receiver,
        method: {
          ...expression.method,
          type: { kind: "UnitType", tokenId: expression.method.tokenId },
        },
        arguments: expression.arguments.map((arg) =>
          analyzeExpression(ctx, arg),
        ),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    }
    case "IndexExpression":
      return analyzeIndexExpression(ctx, expression);
    case "TupleExpression":
      return {
        ...expression,
        elements: expression.elements.map((elem) =>
          analyzeExpression(ctx, elem),
        ),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "ArrayExpression":
      return analyzeArrayExpression(ctx, expression);
    case "ArrayRepeatExpression":
      return analyzeArrayRepeatExpression(ctx, expression);
    case "RangeExpression":
      return {
        ...expression,
        start: mapSome(expression.start, (expr) =>
          analyzeExpression(ctx, expr),
        ),
        end: mapSome(expression.end, (expr) => analyzeExpression(ctx, expr)),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "StructExpression":
      return analyzeStructExpression(ctx, expression);
    case "IfExpression":
      return analyzeIfExpression(ctx, expression);
    case "LetExpression":
      return analyzeExpressionPlaceholder(
        ctx,
        expression.tokenId,
        LET_EXPRESSION_NOT_YET_SUPPORTED_MESSAGE,
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
      return analyzePath(ctx, {
        ...expression,
        kind: "PathExpression",
        path: { absolute: false, segments: [expression.text] },
      });
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
    default:
      return false;
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
      none(),
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
        none(),
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
        none(),
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
      none(),
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
      none(),
    );
    return { ...expression, object, index, type: UNIT };
  }

  if (indexMismatch) {
    emitError(
      ctx,
      `array index must be \`usize\`, found \`${describeType(getType(index))}\``,
      expression.index.tokenId,
      none(),
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
        none(),
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
    emitError(ctx, "field access on non-struct type", expression.field.tokenId, none());
    return unresolved();
  }

  const structName = structType.name.split("::").pop() ?? structType.name;
  const structDecl = ctx.typeScope.get(structName);
  const fieldName = expression.field.text;

  if (structDecl === undefined) {
    return unresolved();
  }
  if (structDecl.body.kind !== "NamedFields") {
    emitError(
      ctx,
      `no field \`${fieldName}\` on struct \`${structName}\``,
      expression.field.tokenId,
      none(),
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
      none(),
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
    default:
      return none();
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
        emitError(ctx, "cannot assign to immutable binding", tokenId, none());
        break;
      case "shared-reference":
        emitError(ctx, "cannot assign through a shared reference", tokenId, none());
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

  const structDecl = ctx.typeScope.get(structName);
  if (structDecl === undefined) {
    emitError(
      ctx,
      `cannot find struct \`${structName}\` in this scope`,
      structExpression.tokenId,
      none(),
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
        none(),
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
        none(),
      );
    }
    seenFields.add(field.name.text);

    const declaredField = declaredFields.get(field.name.text);
    if (declaredField === undefined) {
      emitError(
        ctx,
        `unknown field \`${field.name.text}\` for struct \`${structName}\``,
        field.name.tokenId,
        none(),
      );
      return field;
    }

    // Shorthand `Foo { x }` (field.value is none()) — value-type inference
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
        none(),
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
          none(),
        );
      }
    }
  }

  return checkedFields;
}

function analyzeIfExpression(
  ctx: AnalysisContext,
  ifExpression: Parser.IfExpression,
): Semantics.IfExpression {
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
    emitError(ctx, "if condition must be `bool`", ifExpression.tokenId, none());
  }

  if (isSome(elseBranch)) {
    const thenType = thenBranch.type;
    const elseType = elseBranch.value.type;
    if (
      thenType.kind !== "UnitType" &&
      elseType.kind !== "UnitType" &&
      !typesEqual(thenType, elseType)
    ) {
      emitError(
        ctx,
        "if expression branches have incompatible types",
        ifExpression.tokenId,
        none(),
      );
    }
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

function analyzeCall(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
): Semantics.CallExpression {
  const callee = analyzeExpression(ctx, call.callee);
  const args = call.arguments.map((arg) => analyzeExpression(ctx, arg));
  const calleeType = getType(callee);
  const returnType: Semantics.Type =
    calleeType.kind === "FunctionType"
      ? calleeType.returnType
      : { kind: "UnitType", tokenId: call.tokenId };
  return { ...call, callee, arguments: args, type: returnType };
}

function analyzePath(
  ctx: AnalysisContext,
  path: Parser.PathExpression,
): Semantics.PathExpression {
  const { segments } = path.path;
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
  emitError(ctx, `Cannot find name "${name}" in this scope.`, path.tokenId, none());
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
  const ctx: AnalysisContext = {
    scopes: [new Map(BUILTIN_SCOPE)],
    typeScope: new Map(),
    enumScope: new Map(),
    diagnostics: [],
    tokens,
    constDeclScopes: [new Map<string, Parser.ConstDecl>()],
    constValueScopes: [new Map<string, ConstEntry>()],
    staticTypeScopes: [new Map<string, Semantics.Type>()],
    constResolving: new Set(),
  };
  const topLevelFunctionNames = new Set<string>();
  for (const item of program.items) {
    if (item.kind === "Struct") {
      if (ctx.typeScope.has(item.name.text)) {
        emitError(
          ctx,
          `struct \`${item.name.text}\` is defined more than once`,
          item.name.tokenId,
          none(),
        );
      } else {
        ctx.typeScope.set(item.name.text, analyzeStruct(ctx, item));
      }
    } else if (item.kind === "Enum") {
      if (ctx.enumScope.has(item.name.text)) {
        emitError(
          ctx,
          `enum \`${item.name.text}\` is defined more than once`,
          item.name.tokenId,
          none(),
        );
      } else {
        ctx.enumScope.set(item.name.text, analyzeEnum(ctx, item));
      }
    } else if (item.kind === "Function") {
      if (topLevelFunctionNames.has(item.name.text)) {
        emitError(
          ctx,
          `function \`${item.name.text}\` is defined more than once`,
          item.name.tokenId,
          none(),
        );
      } else {
        topLevelFunctionNames.add(item.name.text);
        bind(ctx, item.name.text, {
          type: fnSignatureType(item),
          mutable: false,
        });
      }
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
  };
}
