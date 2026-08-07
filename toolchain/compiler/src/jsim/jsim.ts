import { isSome, mapSome, none, type Option, some } from "../option.js";
import type { Token } from "../lexer/token.js";
import {
  declarationsOf,
  type BindingId,
  type Declaration,
} from "../ownership/control-flow-graph.js";
import type {
  BranchDrop,
  ConditionalDrop,
  FunctionOwnership,
} from "../ownership/move-check.js";
import { constValueToLiteralExpression } from "../semantics/analyzer.js";
import type * as Semantics from "../semantics/ast.js";
import { hasCapability } from "../semantics/type-capabilities.js";
import type * as JSIM from "./ast.js";
import { toDocComment } from "./parts/doc-comment.js";
import {
  findExpressionEndTokenId,
  findStatementEndTokenId,
  findMatchingCloseBraceTokenId,
  leftmostExpressionTokenId,
  resolveSpan,
} from "./parts/span.js";
import { assert, assertNever } from "../assert.js";

/**
 * The JSIM Creation context object
 */
interface JsimContext {
  readonly tokens: readonly Token[];
  readonly ownership: ReadonlyMap<string, FunctionOwnership>;
  readonly rename: RenameCtx[];
  /**
   * Per-function stack of that function's own scope-end drop map,
   * keyed by block tokenId.
   */
  readonly drops: ReadonlyMap<number, readonly Declaration[]>[];
  /**
   * Per-function stack of that function's own conditional-drop map, keyed
   * the same way as `drops`. A conditionally-dropped binding needs a
   * synthesized drop-flag guard instead of `using` (see `dropFlagName`,
   * `dropCheckStatements`).
   */
  readonly conditionalDrops: ReadonlyMap<number, readonly ConditionalDrop[]>[];
  /**
   * Per-function map from a conditionally-dropped binding's own `BindingId`
   * to its synthesized flag's emitted name, allocated lazily on first
   * reference (declare site, move site, or scope-exit guard -- whichever is
   * lowered first) and reused at every later reference.
   */
  readonly dropFlagNames: Map<BindingId, string>[];
  /**
   * Per-function stack of that function's own statically-resolved
   * conditional moves (see `move-check.ts`'s `attributeConditionalMoves`).
   * Looked up by the `if` expression's own tokenId at `jsimIfStatement`.
   */
  readonly branchDrops: (readonly BranchDrop[])[];
  /**
   * Per-function stack of `conditionalDrops`, pre-flattened once per
   * function (see `withFunctionCtx`) rather than on every
   * `allConditionalDrops` call -- `lowerStatementWithDropFlags` calls it up
   * to twice per statement, and re-flattening the map's values each time
   * would scale with statement count for no reason.
   */
  readonly allConditionalDrops: (readonly ConditionalDrop[])[];
  /**
   * Per-function map from a binding's own `BindingId` to the emitted
   * (alpha-renamed) name it was originally bound to, recorded once at its
   * own bind site (a `LetStatement` in `parseStatement`, or a parameter in
   * `parseFunction`). A drop site needs to resolve the exact binding
   * instance a `Declaration` names, not whatever its source name currently
   * resolves to via `lookupLocalName` -- that's name-based and can find a
   * shadow instead of the original if one with the same source name is
   * currently in scope. See `emittedNameForBinding`.
   */
  readonly emittedNameByBindingId: Map<BindingId, string>[];
  /**
   * Every top-level JS binding name already claimed (function names, and
   * each static's own accessor name) - not `$k`-suffixed alpha-rename
   * (that machinery is per-function local scope only), but the same
   * probe-until-free strategy, used by `staticBackingName` to keep a
   * static's hidden backing variable from colliding with any of these.
   */
  readonly topLevelNames: Set<string>;
}

function createJsimContext(
  tokens: readonly Token[],
  ownership: ReadonlyMap<string, FunctionOwnership>,
  topLevelNames: Set<string>,
): JsimContext {
  return {
    tokens,
    ownership,
    rename: [],
    drops: [],
    conditionalDrops: [],
    dropFlagNames: [],
    branchDrops: [],
    allConditionalDrops: [],
    emittedNameByBindingId: [],
    topLevelNames,
  };
}

/**
 * Collision-safe name derived from `base` - `base` itself, or that with a
 * numeric suffix if already claimed (by a user identifier, another
 * static's backing/init-flag name, or a function). Reserves the chosen
 * name in `ctx.topLevelNames` so nothing lowered afterward can reuse it.
 */
function reserveTopLevelName(ctx: JsimContext, base: string): string {
  let candidate = base;
  let suffix = 2;
  while (ctx.topLevelNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  ctx.topLevelNames.add(candidate);
  return candidate;
}

/**
 * Collision-safe backing-variable name for a static's hidden storage -
 * `__hedgeStatic_NAME`, or a numeric-suffixed variant.
 */
function staticBackingName(ctx: JsimContext, name: string): string {
  return reserveTopLevelName(ctx, `__hedgeStatic_${name}`);
}

/**
 * Collision-safe name for a static's hidden boolean "has this run yet"
 * flag - `__hedgeStaticInit_NAME`, or a numeric-suffixed variant. A
 * separate flag (rather than checking whether the backing variable is
 * still nullish via `??=`) is required because a unit-returning
 * initializer's JS value is `undefined` - see `jsim/ast.ts`'s `StaticDecl`
 * doc comment.
 */
function staticInitFlagName(ctx: JsimContext, name: string): string {
  return reserveTopLevelName(ctx, `__hedgeStaticInit_${name}`);
}

function isSimpleBindingPattern(pattern: Semantics.Pattern): boolean {
  return (
    pattern.kind === "BindingPattern" || pattern.kind === "WildcardPattern"
  );
}

/**
 * The single name+token a plain (non-destructuring) `let`/parameter
 * pattern binds: a `BindingPattern`, or `WildcardPattern` (emitted as a
 * real `_`-named JS binding). Callers check `isSimpleBindingPattern` first
 * and route anything else to real destructuring lowering instead.
 */
function simpleBindingIdentity(pattern: Semantics.Pattern): {
  readonly text: string;
  readonly tokenId: number;
} {
  if (pattern.kind === "BindingPattern") {
    return { text: pattern.name.text, tokenId: pattern.name.tokenId };
  }
  if (pattern.kind === "WildcardPattern") {
    return { text: "_", tokenId: pattern.tokenId };
  }
  throw new Error(
    "JSIM codegen for destructuring let/parameter patterns is not yet implemented",
  );
}

/** A `WildcardPattern` binding is never mutable - mirrors the pre-Hedge-47
 * behavior, where a wildcard `let`/param was never given `mut`. A `byRef`
 * binding's own `mutable` sigil (`&mut name`) means "this is a mutable
 * *borrow*", not "this local slot is reassignable" - there's no sigil
 * combination that makes a `&`/`&mut` binding's own local slot separately
 * rebindable (see `analyzer.ts`'s `effectiveBindingType`, the single source
 * of truth this mirrors: `localMutable: byRef ? false : mutable`). Only a
 * plain `mut name` (no `byRef`) actually makes the local slot mutable. */
function simpleBindingMutable(pattern: Semantics.Pattern): boolean {
  return pattern.kind === "BindingPattern" && !pattern.byRef && pattern.mutable;
}

/**
 * `using dropShadow_<name> = <name>;` for every sub-binding still owed a
 * scope-end drop and not reassignable (`using` can't wrap a `mut` local).
 * `declarationsOf` walks the whole pattern, so this fires per sub-binding,
 * not once for the pattern as a whole.
 */
function destructuredPatternDropShadows(
  ctx: JsimContext,
  pattern: Semantics.Pattern,
  scopeDropsForBlock: readonly Declaration[],
): JSIM.LetStatement[] {
  return declarationsOf(pattern)
    .filter(
      (d) => !d.mutable && scopeDropsForBlock.some((sd) => sd.id === d.id),
    )
    .map((d): JSIM.LetStatement => ({
      kind: "LetStatement",
      name: reserveLocalName(ctx, `dropShadow_${d.name}`),
      mutable: false,
      value: some({
        kind: "Identifier",
        value: emittedNameForBinding(ctx, d),
        type: none(),
      }),
      docComment: none(),
      span: resolveSpan(ctx.tokens, d.tokenId, d.tokenId),
      dispose: true,
    }));
}

/**
 * `let Wrapper::Only(x) = w;` - evaluates the initializer once into a
 * synthesized temp, then reuses `compilePatternInto` (built for match) to
 * destructure it, with an empty `rest` (nothing needs to happen "after" a
 * `let`). `isIrrefutablePattern` (the semantics check that accepted this
 * pattern) only checks its top-level shape, not nested sub-patterns, so a
 * real conditional can still occur here - see `withRefutablePatternThrow`.
 */
function lowerDestructuringLetStatement(
  ctx: JsimContext,
  statement: Semantics.LetStatement,
  scopeDropsForBlock: readonly Declaration[],
): JSIM.Statement[] {
  const value = mapSome(statement.initializer, (expr) =>
    parseExpression(ctx, expr),
  );
  assert(isSome(value), "A destructuring let must have an initializer");
  const tempName = reserveLocalName(ctx, "letDestructure");
  const tempDecl: JSIM.LetStatement = {
    kind: "LetStatement",
    name: tempName,
    mutable: false,
    value,
    docComment: none(),
    span: resolveSpan(
      ctx.tokens,
      statement.tokenId,
      findStatementEndTokenId(ctx.tokens, statement.tokenId),
    ),
    dispose: false,
  };
  const tempIdent: JSIM.Expression = {
    kind: "Identifier",
    value: tempName,
    type: none(),
  };
  // Assign-mode (see `compilePatternInto`'s own doc comment): a bound
  // name's `let` predeclares outside any conditional structure, so it's
  // still in scope for code after this statement even when
  // `withRefutablePatternThrow` below nests the actual assignment inside a
  // defensive `if`.
  const predecls: JSIM.LetStatement[] = [];
  const continuation = compilePatternInto(
    ctx,
    statement.pattern,
    tempIdent,
    false,
    false,
    predecls,
  );
  return [
    tempDecl,
    ...predecls,
    ...withRefutablePatternThrow(continuation([])),
    ...destructuredPatternDropShadows(
      ctx,
      statement.pattern,
      scopeDropsForBlock,
    ),
  ];
}

/**
 * `compilePatternInto` may produce a real conditional even for a pattern
 * `let` treats as irrefutable (see `lowerDestructuringLetStatement`). A
 * `guardedBy`-produced `if` with no `else` is match's fallthrough shape,
 * meaningless for `let` - a false condition would silently skip the
 * bindings, leaving referenced names undefined. This recursively fills in
 * a throw wherever an `else` is missing. The common (genuinely
 * irrefutable) case has no conditionals at all, so this is a no-op walk.
 */
function withRefutablePatternThrow(
  stmts: readonly JSIM.Statement[],
): JSIM.Statement[] {
  return fillMissingElseBranch(stmts, [
    { kind: "ThrowStatement", message: "refutable pattern did not match" },
  ]);
}

/** Recursively fills in `elseBranch` wherever `compilePatternInto` left one
 * missing. See `withRefutablePatternThrow`/`jsimIfLetStatement` for what
 * "on mismatch" means in each. */
function fillMissingElseBranch(
  stmts: readonly JSIM.Statement[],
  onMismatch: readonly JSIM.Statement[],
): JSIM.Statement[] {
  return stmts.map((stmt): JSIM.Statement => {
    if (stmt.kind === "IfStatement" && !isSome(stmt.elseBranch)) {
      return {
        ...stmt,
        thenBranch: fillMissingElseBranch(stmt.thenBranch, onMismatch),
        elseBranch: some([...onMismatch]),
      };
    }
    return stmt;
  });
}

/**
 * Declarations that need scope-end drop in the block owning
 * `blockTokenId`, for the function currently being lowered.
 */
function scopeDrops(
  ctx: JsimContext,
  blockTokenId: number,
): readonly Declaration[] {
  return ctx.drops.at(-1)?.get(blockTokenId) ?? [];
}

/**
 * Conditionally-dropped declarations owned by the block owning
 * `blockTokenId`, for the function currently being lowered.
 */
function scopeConditionalDrops(
  ctx: JsimContext,
  blockTokenId: number,
): readonly ConditionalDrop[] {
  return ctx.conditionalDrops.at(-1)?.get(blockTokenId) ?? [];
}

/** Every conditional drop recorded anywhere in the function currently being lowered. */
function allConditionalDrops(ctx: JsimContext): readonly ConditionalDrop[] {
  return ctx.allConditionalDrops.at(-1) ?? [];
}

/**
 * The synthesized boolean flag name for `declaration`, allocated through the
 * usual alpha-rename collision-avoidance machinery on first reference so it
 * can never collide with a real user binding, and cached so every later
 * reference (declare, move-site clear, scope-exit guard) agrees on the name.
 */
function dropFlagName(ctx: JsimContext, declaration: Declaration): string {
  const names = ctx.dropFlagNames.at(-1);
  assert(names !== undefined, "dropFlagName called outside a function context");
  const existing = names.get(declaration.id);
  if (existing !== undefined) {
    return existing;
  }
  const allocated = reserveLocalName(ctx, `dropFlag_${declaration.name}`);
  names.set(declaration.id, allocated);
  return allocated;
}

/** `let mut <flag> = true;` -- synthesized right after the binding's own declaration. */
function dropFlagDeclareStatement(
  ctx: JsimContext,
  declaration: Declaration,
  span: JSIM.LetStatement["span"],
): JSIM.LetStatement {
  return {
    kind: "LetStatement",
    name: dropFlagName(ctx, declaration),
    mutable: true,
    value: some({ kind: "BooleanLiteral", value: true }),
    docComment: none(),
    span,
    dispose: false,
  };
}

/** `<flag> = false;` -- synthesized immediately after the statement that performed the move. */
function dropFlagClearStatement(
  ctx: JsimContext,
  declaration: Declaration,
): JSIM.Statement {
  return {
    kind: "AssignExpression",
    operator: "Assign",
    lhs: {
      kind: "Identifier",
      value: dropFlagName(ctx, declaration),
      type: none(),
    },
    rhs: { kind: "BooleanLiteral", value: false },
    span: none(),
  };
}

/**
 * `if (<flag>) { <binding>[Symbol.dispose](); }` for every conditionally
 * dropped declaration owned by the block owning `blockTokenId`, in reverse
 * declaration order (matching unconditional drops). Must be spliced in
 * before any statement that can exit the block early (a trailing-expression
 * `return`) -- placed after, it would never run. These are ordinary
 * statements, not `using`, so unlike unconditional drops they do not run on
 * an exceptional (thrown) exit from the block; that gap is a known,
 * deliberately deferred limitation (`using` can't express a drop flag at
 * all -- ADR 0003 -- and wrapping every conditional drop site in try/finally
 * is unscoped extra work beyond what conditional-move tracking itself asks
 * for).
 *
 * A second, related gap: every caller (`parseFunctionBody`,
 * `jsimBlockStatement`, `jsimBranchBody`) places this call's output
 * unconditionally before a trailing-expression `return`, never after the
 * trailing expression has actually *run*. If the trailing expression is
 * itself what would clear the flag this call reads (e.g. a nested
 * conditional move inside it), the guard fires before the clear ever has a
 * chance to happen -- a real correctness bug, not just an ordering nuance.
 * It's currently unreachable: `move-check.ts`'s `attributeConditionalMoves`
 * resolves every conditional move a loop-free program can express via
 * static duplication before it ever reaches `ConditionalDrop`/this
 * function, regardless of how deeply the move is nested or confined
 * (verified directly, not just argued). Once loops (ROADMAP Slice 6) make
 * this function reachable for real, this ordering needs a proper fix --
 * likely computing the trailing value into a temporary, running the checks,
 * then returning the temporary -- rather than the current unconditional
 * "checks, then return" order.
 */
function dropCheckStatements(
  ctx: JsimContext,
  blockTokenId: number,
): JSIM.Statement[] {
  return scopeConditionalDrops(ctx, blockTokenId).map(
    (conditional): JSIM.Statement => ({
      kind: "IfStatement",
      condition: {
        kind: "Identifier",
        value: dropFlagName(ctx, conditional.declaration),
        type: none(),
      },
      thenBranch: [
        {
          kind: "DisposeCallStatement",
          target: emittedNameForBinding(ctx, conditional.declaration),
        },
      ],
      elseBranch: none(),
    }),
  );
}

/**
 * Lowers one source statement to one-or-more JSIM statements: the statement
 * itself, plus any synthesized drop-flag machinery it triggers --
 * `let mut <flag> = true;` right after the declaration of a binding that
 * ends up conditionally dropped, and a `<flag> = false;` right after the
 * statement that actually performed the move making it conditional (see
 * `dropFlagDeclareStatement`/`dropFlagClearStatement`). Depends on
 * `parseStatement` for the lowering of `statement` itself.
 */
function lowerStatementWithDropFlags(
  ctx: JsimContext,
  statement: Semantics.Statement,
  scopeDropsForBlock: readonly Declaration[],
): JSIM.Statement[] {
  const lowered = parseStatement(ctx, statement, scopeDropsForBlock);
  if (
    statement.kind === "LetStatement" &&
    !isSimpleBindingPattern(statement.pattern)
  ) {
    // A destructuring `let` - conditional-drop/drop-flag integration for
    // individual destructured bindings is a known gap (see
    // `lowerDestructuringLetStatement`), so there's nothing to layer on
    // top of the statements it already produced.
    return lowered;
  }
  const result: JSIM.Statement[] = [...lowered];
  const first = lowered[0];

  if (
    statement.kind === "LetStatement" &&
    first !== undefined &&
    first.kind === "LetStatement"
  ) {
    const conditional = allConditionalDrops(ctx).find(
      (c) =>
        c.declaration.id === simpleBindingIdentity(statement.pattern).tokenId,
    );
    if (conditional !== undefined) {
      result.push(
        dropFlagDeclareStatement(ctx, conditional.declaration, first.span),
      );
    }
  }

  for (const conditional of allConditionalDrops(ctx)) {
    if (conditional.moveStatementTokenId === statement.tokenId) {
      result.push(dropFlagClearStatement(ctx, conditional.declaration));
    }
  }

  return result;
}

/** Lowers a statement list, threading drop-flag synthesis through `lowerStatementWithDropFlags`. */
function lowerStatementsWithDropFlags(
  ctx: JsimContext,
  statements: readonly Semantics.Statement[],
  scopeDropsForBlock: readonly Declaration[],
): JSIM.Statement[] {
  return statements.flatMap((stmt) =>
    lowerStatementWithDropFlags(ctx, stmt, scopeDropsForBlock),
  );
}

/**
 * Tracks the alpha-renames from source-name to emitted-name per scope frame.
 * Null outside function bodies (top-level items are not renamed).
 */
interface RenameCtx {
  frames: Map<string, string>[];
  counters: Map<string, number>;
  emittedNames: Set<string>;
}

function withFunctionCtx<T>(
  ctx: JsimContext,
  functionName: string,
  fn: () => T,
): T {
  ctx.rename.push({
    frames: [new Map<string, string>()],
    counters: new Map<string, number>(),
    emittedNames: new Set<string>(),
  });
  ctx.drops.push(ctx.ownership.get(functionName)?.drops ?? new Map());
  const conditionalDrops =
    ctx.ownership.get(functionName)?.conditionalDrops ?? new Map();
  ctx.conditionalDrops.push(conditionalDrops);
  ctx.allConditionalDrops.push([...conditionalDrops.values()].flat());
  ctx.dropFlagNames.push(new Map());
  ctx.branchDrops.push(ctx.ownership.get(functionName)?.branchDrops ?? []);
  ctx.emittedNameByBindingId.push(new Map());
  try {
    return fn();
  } finally {
    ctx.rename.pop();
    ctx.drops.pop();
    ctx.conditionalDrops.pop();
    ctx.allConditionalDrops.pop();
    ctx.dropFlagNames.pop();
    ctx.branchDrops.pop();
    ctx.emittedNameByBindingId.pop();
  }
}

function pushRenameFrame(ctx: JsimContext): void {
  ctx.rename.at(-1)?.frames.push(new Map<string, string>());
}

function popRenameFrame(ctx: JsimContext): void {
  ctx.rename.at(-1)?.frames.pop();
}

function getCurrentRenameContext(ctx: JsimContext): Option<RenameCtx> {
  const renameCtx = ctx.rename.at(-1);
  return renameCtx ? some(renameCtx) : none();
}

/**
 * Collision-free JS name for `base`, probed against every visible frame
 * plus `emittedNames` (incremental, to catch a collision a frame lookup
 * alone would miss). Only computes the name - `bindLocalName` and
 * `reserveLocalName` decide how to register it.
 */
/**
 * Names a Hedge binding may not keep in the emitted JS. Two kinds, both of
 * which the `$k` suffix already resolves:
 *
 * - JS reserved words, which are a syntax error as a binding and so produce
 *   output that will not parse (`fn f(default: i32)`).
 * - Globals the emitted code itself calls. Shadowing one fails silently
 *   rather than loudly: a local named `Symbol` makes a struct's disposer
 *   attach under the key `undefined`, so the value is simply never disposed.
 *
 * Hedge's own grammar permits all of these, so they are renamed rather than
 * rejected - hiding backend naming rules is what this pass is for.
 */
const JS_UNUSABLE_NAMES: ReadonlySet<string> = new Set([
  // Reserved words.
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  // Reserved in strict mode, which module output always is.
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
  "await",
  "eval",
  "arguments",
  // Globals the emitted code depends on.
  "Array",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Error",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "JSON",
  "Math",
  "Number",
  "Proxy",
  "RangeError",
  "String",
  "Symbol",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
]);

function probeFreeName(renameCtx: RenameCtx, base: string): string {
  const visible = renameCtx.frames.some((f) => f.has(base));
  if (
    !visible &&
    !renameCtx.emittedNames.has(base) &&
    !JS_UNUSABLE_NAMES.has(base)
  ) {
    return base;
  }
  let k = (renameCtx.counters.get(base) ?? 0) + 1;
  let candidate = `${base}$${k}`;
  while (
    renameCtx.frames.some((f) => f.has(candidate)) ||
    renameCtx.emittedNames.has(candidate)
  ) {
    k += 1;
    candidate = `${base}$${k}`;
  }
  renameCtx.counters.set(base, k);
  return candidate;
}

function bindLocalName(ctx: JsimContext, sourceName: string): string {
  const renameCtx = getCurrentRenameContext(ctx);
  if (!isSome(renameCtx)) {
    return sourceName;
  }
  const frame = renameCtx.value.frames.at(-1);
  assert(frame !== undefined, "Expected a rename frame to be present");
  const emitted = probeFreeName(renameCtx.value, sourceName);
  frame.set(sourceName, emitted);
  renameCtx.value.emittedNames.add(emitted);
  return emitted;
}

/**
 * Collision-safe name for a synthesized temp with no Hedge-level identity
 * (`"letDestructure"`, `dropFlag_${name}`, ...). Unlike `bindLocalName`,
 * never registers `base` under `frame` - that would let a real user
 * binding of the same spelling get silently shadowed by this temp.
 */
function reserveLocalName(ctx: JsimContext, base: string): string {
  const renameCtx = getCurrentRenameContext(ctx);
  if (!isSome(renameCtx)) {
    return base;
  }
  const emitted = probeFreeName(renameCtx.value, base);
  renameCtx.value.emittedNames.add(emitted);
  return emitted;
}

function lookupLocalName(ctx: JsimContext, sourceName: string): string {
  const renameCtx = getCurrentRenameContext(ctx);
  if (!isSome(renameCtx)) {
    return sourceName;
  }
  for (let i = renameCtx.value.frames.length - 1; i >= 0; i--) {
    const frame = renameCtx.value.frames[i];
    if (frame !== undefined) {
      const hit = frame.get(sourceName);
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return sourceName;
}

/**
 * Records that `declaration`'s own `BindingId` was emitted as `emittedName`
 * -- called once, at the binding's own bind site. See
 * `emittedNameForBinding` for why a drop site needs this instead of
 * `lookupLocalName`.
 */
function recordEmittedName(
  ctx: JsimContext,
  bindingId: BindingId,
  emittedName: string,
): void {
  ctx.emittedNameByBindingId.at(-1)?.set(bindingId, emittedName);
}

/**
 * The emitted (alpha-renamed) name `declaration` was originally bound to,
 * resolved by its own `BindingId` rather than by re-resolving its source
 * name through the current frame stack. `lookupLocalName` is name-based:
 * if a shadow binding with the same source name is currently in scope (or,
 * for a use after the shadow's own frame has closed, was ever in scope),
 * it can silently return the wrong emitted name. A drop site needs the
 * exact binding instance a `Declaration`/`BindingId` names, never
 * "whatever this source name currently resolves to".
 */
function emittedNameForBinding(
  ctx: JsimContext,
  declaration: Declaration,
): string {
  const name = ctx.emittedNameByBindingId.at(-1)?.get(declaration.id);
  assert(
    name !== undefined,
    `ICE: no emitted name recorded for binding \`${declaration.name}\``,
  );
  return name;
}

export function toJsim(
  program: Semantics.Program,
  tokens: readonly Token[],
  ownership: ReadonlyMap<string, FunctionOwnership> = new Map(),
): JSIM.Program {
  const topLevelNames = new Set<string>();
  for (const item of program.items) {
    if (item.kind === "Function") {
      topLevelNames.add(item.name.text);
    } else if (item.kind === "Const" && isSome(item.visibility)) {
      // A pub const's own name becomes a real top-level JS binding too
      // (see `emitConstPart`), same as a function's - a static's mangled
      // backing name needs the same collision protection against it.
      topLevelNames.add(item.name.text);
    }
  }
  const ctx = createJsimContext(tokens, ownership, topLevelNames);
  return {
    kind: "Program",
    docComment: toDocComment(program.attributes),
    items: program.items.flatMap((i) => parseItem(ctx, i)),
  };
}

// eslint-disable-next-line complexity -- Routing function
function semanticTypeToJsPrimitive(
  type: Semantics.Type,
): Option<JSIM.PrimitiveType> {
  switch (type.kind) {
    case "PrimitiveStringType":
    case "PrimitiveCharType":
      return some({ kind: "PrimitiveType", value: "string" });
    case "PrimitiveBooleanType":
      return some({ kind: "PrimitiveType", value: "boolean" });
    case "PrimitiveI64Type":
    case "PrimitiveU64Type":
      return some({ kind: "PrimitiveType", value: "bigint" });
    case "PrimitiveI8Type":
    case "PrimitiveI16Type":
    case "PrimitiveI32Type":
    case "PrimitiveIsizeType":
    case "PrimitiveU8Type":
    case "PrimitiveU16Type":
    case "PrimitiveU32Type":
    case "PrimitiveUsizeType":
    case "PrimitiveF32Type":
    case "PrimitiveF64Type":
      return some({ kind: "PrimitiveType", value: "number" });
    case "UnitType":
      // Matches the runtime value a () literal (and a unit-returning
      // function's implicit return) actually produce - see codegen's
      // TupleExpression case and jsimTailStatements.
      return some({ kind: "PrimitiveType", value: "undefined" });
    case "ReferenceType":
      // References erase transparently - no { v } cell boxing exists yet
      // (that's the still-guardrailed `&mut`-cell lowering work), so a
      // reference-typed value's JS representation is just its referent's.
      return semanticTypeToJsPrimitive(type.referent);
    case "NamedType":
    case "StructType":
    case "EnumType":
    case "FunctionType":
    case "ArrayType":
      // No JS primitive to erase to; the caller renders these itself.
      return none();
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

const ARITHMETIC_OPS = new Set<JSIM.BinaryOperator>([
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

// eslint-disable-next-line complexity -- Routing function
function hedgeTypeToNumericKind(
  type: Semantics.Type,
): Option<JSIM.NumericKind> {
  switch (type.kind) {
    case "PrimitiveI8Type":
      return some({ kind: "signed", bits: 8 });
    case "PrimitiveI16Type":
      return some({ kind: "signed", bits: 16 });
    case "PrimitiveI32Type":
      return some({ kind: "signed", bits: 32 });
    case "PrimitiveIsizeType":
      return some({ kind: "signed", bits: 32 });
    case "PrimitiveU8Type":
      return some({ kind: "unsigned", bits: 8 });
    case "PrimitiveU16Type":
      return some({ kind: "unsigned", bits: 16 });
    case "PrimitiveU32Type":
      return some({ kind: "unsigned", bits: 32 });
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
    case "ReferenceType":
      return hedgeTypeToNumericKind(type.referent);
    case "PrimitiveBooleanType":
    case "PrimitiveCharType":
    case "PrimitiveStringType":
    case "NamedType":
    case "UnitType":
    case "StructType":
    case "EnumType":
    case "FunctionType":
    case "ArrayType":
      // Not numeric, so no wrapping applies.
      return none();
    default:
      return assertNever(type, `Unexpected type: ${JSON.stringify(type)}`);
  }
}

function parseItem(
  ctx: JsimContext,
  item: Semantics.Item,
): JSIM.Item | JSIM.Item[] {
  if (item.kind === "Function") return parseFunction(ctx, item);
  if (item.kind === "LetStatement" || item.kind === "ExpressionStatement")
    return parseStatement(ctx, item);
  if (item.kind === "Struct") return parseStruct(item);
  if (item.kind === "Enum") return [jsimEnumDecl(item)];
  // Every reference to a const already lowered to a literal at analysis
  // time (see `analyzer.ts`'s `analyzeConstReference`), so a non-pub
  // const's own declaration has no external consumer and erases entirely
  // (spec 0008: no runtime storage). A pub const still needs one real
  // exported JS binding for a plain-JS consumer, built the same way a
  // reference site's literal is (`constValueToLiteralExpression`).
  if (item.kind === "Const") {
    if (!isSome(item.visibility)) return [];
    return [
      {
        kind: "ConstDecl",
        name: item.name.text,
        type: semanticTypeToJsPrimitive(item.type),
        value: parseExpression(
          ctx,
          constValueToLiteralExpression(item.value, item.type, item.tokenId),
        ),
        span: resolveSpan(
          ctx.tokens,
          item.tokenId,
          findStatementEndTokenId(ctx.tokens, item.tokenId),
        ),
      },
    ];
  }
  if (item.kind === "Static") return parseStaticDecl(ctx, item);
  return parseExpression(ctx, item);
}

function parseStaticDecl(
  ctx: JsimContext,
  decl: Semantics.StaticDecl,
): JSIM.StaticDecl {
  return {
    kind: "StaticDecl",
    name: decl.name.text,
    backingName: staticBackingName(ctx, decl.name.text),
    initFlagName: staticInitFlagName(ctx, decl.name.text),
    init: parseExpression(ctx, decl.value),
    docComment: toDocComment(decl.attributes),
    span: resolveSpan(
      ctx.tokens,
      decl.tokenId,
      findStatementEndTokenId(ctx.tokens, decl.tokenId),
    ),
  };
}

function parseStruct(struct: Semantics.StructDecl): JSIM.Item[] {
  void struct;
  // TODO(Hedge-90): Implement how structs are represented in JS (interface for .d.ts)
  return [];
}

/**
 * Renders a variant field's type as `.d.ts` type text. A field typed as
 * another enum resolves to that enum's own type name; a struct-typed field
 * falls back to `unknown` - struct `.d.ts` generation doesn't exist yet.
 */
function enumFieldDtsType(type: Semantics.Type): string {
  const primitive = semanticTypeToJsPrimitive(type);
  if (isSome(primitive)) return primitive.value.value;
  if (type.kind === "EnumType") return type.name.split("::").pop() ?? type.name;
  return "unknown";
}

function jsimEnumDecl(enumDecl: Semantics.EnumDecl): JSIM.EnumDecl {
  return {
    kind: "EnumDecl",
    name: enumDecl.name.text,
    variants: enumDecl.variants.map((variant): JSIM.EnumDeclVariant => {
      const tag = variant.name.text;
      if (!isSome(variant.body)) return { kind: "UnitVariant", tag };
      if (variant.body.value.kind === "TupleFields") {
        return {
          kind: "TupleVariant",
          tag,
          dataTypes: variant.body.value.fields.map((f) =>
            enumFieldDtsType(f.type),
          ),
        };
      }
      return {
        kind: "StructVariant",
        tag,
        dataFields: variant.body.value.fields.map((f) => ({
          name: f.name.text,
          type: enumFieldDtsType(f.type),
        })),
      };
    }),
  };
}

function parseFunction(
  ctx: JsimContext,
  fn: Semantics.FunctionDecl,
): JSIM.FunctionDecl {
  return withFunctionCtx(ctx, fn.name.text, () => {
    // Pre-bind params so inner `let` with the same name gets a unique suffix.
    // Capture the emitted name so the function declaration stays in sync with
    // whatever the rename context assigns (defensive: currently always identity
    // since params are the first things bound in a fresh function scope). A
    // destructuring param gets a synthesized plain JS name;
    // `destructureFunctionParams` unpacks it into its own bound names.
    const emittedParams = fn.params.map((p) => {
      if (!isSimpleBindingPattern(p.pattern)) {
        return {
          param: p,
          emittedName: reserveLocalName(ctx, "paramDestructure"),
        };
      }
      const identity = simpleBindingIdentity(p.pattern);
      const emittedName = bindLocalName(ctx, identity.text);
      recordEmittedName(ctx, identity.tokenId, emittedName);
      return { param: p, emittedName };
    });
    return parseFunctionBody(ctx, fn, emittedParams);
  });
}

/**
 * A struct-typed parameter still owned (unconditionally, per
 * `analyzeOwnership`) at the function's own top-level scope end needs
 * scope-end drop, but a JS `using` binding can't reuse its own parameter's
 * name (`using p = p;` is a `SyntaxError`) and can't be reassigned (so a
 * `mut` parameter is excluded, matching the same restriction on local
 * `let` bindings, see `emitLet`). Re-binds the parameter's source name to
 * a fresh alpha-rename shadow via the existing collision-avoidance
 * machinery, then returns a synthetic `using <shadow> = <original>;`
 * statement to prepend to the body: every later `lookupLocalName`
 * reference resolves to the shadow for free.
 */
function dropParamShadows(
  ctx: JsimContext,
  emittedParams: ReadonlyArray<{
    param: Semantics.Param;
    emittedName: string;
  }>,
  rootDrops: readonly Declaration[],
): JSIM.LetStatement[] {
  const shadows: JSIM.LetStatement[] = [];
  for (const { param, emittedName } of emittedParams) {
    if (!isSimpleBindingPattern(param.pattern)) {
      shadows.push(
        ...destructuredPatternDropShadows(ctx, param.pattern, rootDrops),
      );
      continue;
    }
    if (simpleBindingMutable(param.pattern)) continue;
    const identity = simpleBindingIdentity(param.pattern);
    const needsDrop = rootDrops.some((d) => d.id === identity.tokenId);
    if (!needsDrop) continue;
    const shadowName = bindLocalName(ctx, identity.text);
    shadows.push({
      kind: "LetStatement",
      name: shadowName,
      mutable: false,
      value: some({ kind: "Identifier", value: emittedName, type: none() }),
      docComment: none(),
      span: resolveSpan(ctx.tokens, identity.tokenId, identity.tokenId),
      dispose: true,
    });
  }
  return shadows;
}

/** A destructuring parameter's real JS parameter is a synthesized plain
 * name (see `parseFunction`); builds the statements that destructure it,
 * mirroring `lowerDestructuringLetStatement`. A simple param contributes
 * nothing here. */
function destructureFunctionParams(
  ctx: JsimContext,
  emittedParams: ReadonlyArray<{
    param: Semantics.Param;
    emittedName: string;
  }>,
): JSIM.Statement[] {
  return emittedParams.flatMap(({ param, emittedName }) => {
    if (isSimpleBindingPattern(param.pattern)) return [];
    const paramIdent: JSIM.Expression = {
      kind: "Identifier",
      value: emittedName,
      type: none(),
    };
    const predecls: JSIM.LetStatement[] = [];
    const continuation = compilePatternInto(
      ctx,
      param.pattern,
      paramIdent,
      false,
      false,
      predecls,
    );
    return [...predecls, ...withRefutablePatternThrow(continuation([]))];
  });
}

function parseFunctionBody(
  ctx: JsimContext,
  fn: Semantics.FunctionDecl,
  emittedParams: ReadonlyArray<{
    param: Semantics.Param;
    emittedName: string;
  }>,
): JSIM.FunctionDecl {
  const innerDoc = toDocComment(fn.body.innerAttributes);
  const outerDoc = toDocComment(fn.attributes);
  const docComment = isSome(innerDoc) ? innerDoc : outerDoc;

  // A declared, non-unit return type. When Some, Gap-A's return-type-mismatch
  // check (checkFunctionReturnType in analyzer.ts) already guarantees
  // fn.body.trailingExpression is Some and its type matches - no defensive
  // handling needed here for "declared return type but missing/wrong trailing
  // expression."
  const declaredReturnType: Option<Semantics.Type> =
    isSome(fn.returnType) && fn.returnType.value.kind !== "UnitType"
      ? fn.returnType
      : none();

  // Param shadows must be computed (and their `bindLocalName` side effects
  // applied) before the body is lowered, so `lookupLocalName` inside the
  // body resolves references to the shadow, not the original parameter.
  const rootDrops = scopeDrops(ctx, fn.body.tokenId);
  const paramDestructures = destructureFunctionParams(ctx, emittedParams);
  const paramShadows = dropParamShadows(ctx, emittedParams, rootDrops);
  const statements: JSIM.Statement[] = [
    ...paramDestructures,
    ...paramShadows,
    ...lowerStatementsWithDropFlags(ctx, fn.body.statements, rootDrops),
  ];
  // The guard-check must run before any `return` the trailing expression
  // produces, or it would be dead code -- but after everything else, so it
  // sees whichever branch actually ran. A declared return type turns the
  // trailing expression into a real `return` (via jsimTailStatements), so
  // the guard goes immediately before it; otherwise the trailing expression
  // is just evaluated in place and the guard can safely follow it.
  if (isSome(fn.body.trailingExpression)) {
    const trailing = fn.body.trailingExpression.value;
    if (isSome(declaredReturnType)) {
      statements.push(
        ...dropCheckStatements(ctx, fn.body.tokenId),
        ...jsimTailStatements(ctx, trailing),
      );
    } else {
      statements.push(
        parseExpression(ctx, trailing),
        ...dropCheckStatements(ctx, fn.body.tokenId),
      );
    }
  } else {
    statements.push(...dropCheckStatements(ctx, fn.body.tokenId));
  }

  const scope: JSIM.FunctionDecl["scope"] = mapSome(
    fn.visibility,
    (visibility) =>
      isSome(visibility.scope) && visibility.scope.value === "package"
        ? "package"
        : "public",
  );

  return {
    kind: "FunctionDecl",
    scope,
    name: fn.name.text,
    params: emittedParams.map(
      ({ param: p, emittedName }): JSIM.FunctionParam => ({
        kind: "FunctionParam",
        name: emittedName,
        type: semanticTypeToJsPrimitive(p.type),
      }),
    ),
    returnType: isSome(declaredReturnType)
      ? semanticTypeToJsPrimitive(declaredReturnType.value)
      : none(),
    span: resolveSpan(
      ctx.tokens,
      fn.tokenId,
      findMatchingCloseBraceTokenId(ctx.tokens, fn.body.tokenId),
    ),
    body: statements,
    docComment,
  };
}

/**
 * `scopeDrops` is the enclosing block's own scope-end drop list, passed
 * in by the caller (rather than looked up here) because `parseStatement`
 * itself doesn't know which `Semantics.Block` it's being lowered for;
 * only the block-lowering call sites (`parseFunctionBody`,
 * `jsimBlockStatement`, `jsimBranchBody`) do.
 */
// eslint-disable-next-line complexity -- Routing function
function parseStatement(
  ctx: JsimContext,
  statement: Semantics.Statement,
  scopeDrops: readonly Declaration[] = [],
): JSIM.Statement[] {
  switch (statement.kind) {
    case "LetStatement": {
      if (!isSimpleBindingPattern(statement.pattern)) {
        return lowerDestructuringLetStatement(ctx, statement, scopeDrops);
      }
      // Evaluate the initializer BEFORE binding the name so that
      // `let x = x + 1` resolves the RHS `x` to the *outer* binding.
      const value = mapSome(statement.initializer, (expr) =>
        parseExpression(ctx, expr),
      );
      const identity = simpleBindingIdentity(statement.pattern);
      const mutable = simpleBindingMutable(statement.pattern);
      const name = bindLocalName(ctx, identity.text);
      recordEmittedName(ctx, identity.tokenId, name);
      const dispose =
        !mutable && scopeDrops.some((d) => d.id === identity.tokenId);
      return [
        {
          kind: "LetStatement",
          name,
          mutable,
          value,
          docComment: toDocComment(statement.attributes),
          span: resolveSpan(
            ctx.tokens,
            statement.tokenId,
            findStatementEndTokenId(ctx.tokens, statement.tokenId),
          ),
          dispose,
        },
      ];
    }
    case "ExpressionStatement":
      if (statement.expression.kind === "Block") {
        return [jsimBlockStatement(ctx, statement.expression)];
      }
      if (statement.expression.kind === "IfExpression") {
        return jsimIfExpressionAsStatement(ctx, statement.expression);
      }
      if (
        statement.expression.kind === "AssignExpression" ||
        statement.expression.kind === "CompoundAssignExpression"
      ) {
        return [parseAssignStatement(ctx, statement.expression)];
      }
      return [parseExpression(ctx, statement.expression)];
    case "Function":
      return [parseFunction(ctx, statement)];
    case "Struct":
      // Struct declarations are type-only - no JS runtime representation.
      return [{ kind: "BlockStatement", body: [] }];
    case "Enum":
      // A local enum's own declaration is still type-only, same as a
      // struct's - `.d.ts` generation only ever walks top-level
      // `program.items`, so a block-scoped enum has no `.d.ts`-visible
      // consequence regardless. Construction (`Local::Variant`) and match
      // against it both lower independently of this declaration, driven
      // entirely by the Semantics AST's own type info.
      return [{ kind: "BlockStatement", body: [] }];
    case "Const":
      // Same erasure as a top-level const (see `parseItem`) - every
      // reference already lowered to a literal at analysis time.
      return [{ kind: "BlockStatement", body: [] }];
    case "Static":
      // The parser rejects `static` in block position (see
      // `parser/statement.ts`'s local item dispatch) - a local static's
      // initializer could otherwise capture an enclosing call's local
      // state despite only ever running once. This case can't be reached
      // by a real parse.
      throw new Error(
        "a Static statement reached JSIM lowering, which should be structurally impossible",
      );
    default:
      assertNever(
        statement,
        `JSIM lowering for "${JSON.stringify(statement)}" is not yet implemented`,
      );
  }
}

function jsimBranchHasResult(
  branch: Semantics.Block | Semantics.IfExpression,
): boolean {
  if (branch.kind === "IfExpression") {
    return (
      jsimBranchHasResult(branch.thenBranch) ||
      (isSome(branch.elseBranch) &&
        jsimBranchHasResult(branch.elseBranch.value))
    );
  }
  return isSome(branch.trailingExpression);
}

function jsimBlockStatement(
  ctx: JsimContext,
  block: Semantics.Block,
): JSIM.Statement {
  if (isSome(block.trailingExpression)) return jsimBlockExpression(ctx, block);
  pushRenameFrame(ctx);
  try {
    const drops = scopeDrops(ctx, block.tokenId);
    const body = [
      ...lowerStatementsWithDropFlags(ctx, block.statements, drops),
      ...dropCheckStatements(ctx, block.tokenId),
    ];
    return { kind: "BlockStatement", body };
  } finally {
    popRenameFrame(ctx);
  }
}

function jsimIfExpressionAsStatement(
  ctx: JsimContext,
  ifExpr: Semantics.IfExpression,
): JSIM.Statement[] {
  const hasResult =
    jsimBranchHasResult(ifExpr.thenBranch) ||
    (isSome(ifExpr.elseBranch) && jsimBranchHasResult(ifExpr.elseBranch.value));
  if (hasResult) return [jsimIfExpression(ctx, ifExpr)];
  return jsimIfStatement(ctx, ifExpr);
}

// eslint-disable-next-line complexity -- This is a routing function
function parseExpression(
  ctx: JsimContext,
  expression: Semantics.Expression,
): JSIM.Expression {
  switch (expression.kind) {
    case "StringLiteral":
      return { kind: "StringLiteral", value: expression.value };
    case "IntLiteral":
      return jsimIntLiteral(expression);
    case "FloatLiteral":
      return { kind: "NumberLiteral", value: expression.value };
    case "BoolLiteral":
      return { kind: "BooleanLiteral", value: expression.value };
    case "CharLiteral":
      return { kind: "StringLiteral", value: expression.value };
    case "PathExpression":
      if (
        expression.path.segments.length === 2 &&
        expression.type.kind === "EnumType"
      ) {
        return jsimEnumUnitVariantConstruction(expression.path.segments);
      }
      if (expression.path.segments.length === 1 && !expression.path.absolute) {
        const value = expression.path.segments[0];
        assert(value !== undefined, "Unexpected undefined segment");
        return {
          kind: "Identifier",
          value: lookupLocalName(ctx, value),
          type: none(),
        };
      }
      return { kind: "PathExpression", path: expression.path.segments };
    case "CallExpression":
      if (
        expression.type.kind === "EnumType" &&
        expression.callee.kind === "PathExpression" &&
        expression.callee.path.segments.length === 2
      ) {
        return jsimEnumTupleVariantConstruction(
          ctx,
          expression.callee.path.segments,
          expression.arguments,
        );
      }
      // A tuple struct constructor call - checked on the *callee's* type,
      // not the call's result type, so `fn makePoint() -> Point` (a
      // FunctionType callee) isn't misread as construction.
      if (
        expression.callee.kind === "PathExpression" &&
        expression.callee.type.kind === "StructType"
      ) {
        return jsimTupleStructConstruction(ctx, expression.arguments);
      }
      return {
        kind: "CallExpression",
        callee: parseExpression(ctx, expression.callee),
        arguments: expression.arguments.map((arg) => parseExpression(ctx, arg)),
      };
    case "ReferenceExpression":
      // A shared borrow is transparent in JS - emit the operand directly. A
      // `&mut` borrow needs the getter/setter cell.
      return expression.mutable
        ? parseMutableReferenceExpression(ctx, expression)
        : parseExpression(ctx, expression.operand);
    case "DereferenceExpression":
      // A shared borrow's referent reads transparently; a `&mut` borrow
      // reads through the cell's `.v` accessor.
      return throughMutableReferenceCell(
        parseExpression(ctx, expression.operand),
        expression.operand,
      );
    case "BinaryExpression":
      return parseBinaryExpression(ctx, expression);
    case "UnaryExpression":
      return parseUnaryExpression(ctx, expression);
    case "AssignExpression":
      return parseAssignExpression(ctx, expression);
    case "CompoundAssignExpression":
      return parseCompoundAssignExpression(ctx, expression);
    case "FieldAccessExpression":
      return parseFieldAccessExpression(ctx, expression);
    case "MethodCallExpression":
      return jsimMethodCallExpression(ctx, expression);
    case "IndexExpression":
      return jsimIndexExpression(ctx, expression);
    case "TupleExpression":
      return jsimTupleExpression(ctx, expression);
    case "ArrayExpression":
      return jsimArrayExpression(ctx, expression);
    case "ArrayRepeatExpression":
      return jsimArrayRepeatExpression(ctx, expression);
    case "RangeExpression":
      return jsimRangeExpression(ctx, expression);
    case "StructExpression":
      return jsimStructExpression(ctx, expression);
    case "IfExpression":
      return jsimIfExpression(ctx, expression);
    case "LetExpression":
      // Only ever consumed as an IfExpression's own condition, handled by
      // jsimIfStatement before reaching here - impossible otherwise.
      throw new Error(
        "a LetExpression reached generic JSIM expression lowering outside an if condition, which should be structurally impossible",
      );
    case "MatchExpression":
      return jsimMatchExpression(ctx, expression);
    case "Block":
      return jsimBlockExpression(ctx, expression);

    default:
      assertNever(
        expression,
        `JSIM codegen for "${JSON.stringify(expression)}" is not yet implemented`,
      );
  }
}

function jsimMethodCallExpression(
  ctx: JsimContext,
  methodCallExpression: Semantics.MethodCallExpression,
): JSIM.Expression {
  return {
    kind: "MethodCallExpression",
    receiver: parseExpression(ctx, methodCallExpression.receiver),
    method: methodCallExpression.method.text,
    arguments: methodCallExpression.arguments.map((arg) =>
      parseExpression(ctx, arg),
    ),
  };
}

function jsimBlockExpression(
  ctx: JsimContext,
  block: Semantics.Block,
): JSIM.Expression {
  return {
    kind: "CallExpression",
    callee: {
      kind: "ArrowFunctionExpression",
      params: [],
      body: jsimBranchBody(ctx, block),
    },
    arguments: [],
  };
}

function jsimBranchBody(
  ctx: JsimContext,
  block: Semantics.Block,
): JSIM.Statement[] {
  pushRenameFrame(ctx);
  try {
    const drops = scopeDrops(ctx, block.tokenId);
    const stmts: JSIM.Statement[] = [
      ...lowerStatementsWithDropFlags(ctx, block.statements, drops),
      ...dropCheckStatements(ctx, block.tokenId),
    ];
    if (isSome(block.trailingExpression)) {
      stmts.push({
        kind: "ReturnStatement",
        value: some(parseExpression(ctx, block.trailingExpression.value)),
      });
    }
    return stmts;
  } finally {
    popRenameFrame(ctx);
  }
}

function jsimBranchElse(
  ctx: JsimContext,
  branch: Semantics.IfExpression | Semantics.Block,
): JSIM.Statement[] {
  if (branch.kind === "IfExpression") return jsimIfStatement(ctx, branch);
  return jsimBranchBody(ctx, branch);
}

/**
 * `using <shadow> = <original>;` declarations for every declaration a
 * static duplication (`move-check.ts`'s `attributeConditionalMoves`)
 * attributed to `branch` of the `if` expression `ifTokenId` names.
 * Prepended to the front of the branch's own statement list (see
 * `jsimIfStatement`) rather than emitted as an explicit dispose call at the
 * end: within its own branch the drop is unconditional (that's the whole
 * point of static duplication), so `using`'s native scope-exit semantics
 * handle every exit path correctly -- normal fall-through, an early
 * `return`, a thrown exception -- without the branch needing to track
 * where its own last statement is. An explicit call placed near the end
 * would also run *before* a more-nested `using`-declared local's own
 * scope-exit disposal, inverting reverse-declaration-order; a `using`
 * declared first in the branch disposes last, which is correct since the
 * original binding is always the "oldest" declaration in scope here.
 * Mirrors `dropParamShadows`'s existing shadow-rebind pattern -- the
 * original binding can't itself become `using` (`using x = x;` is a
 * `SyntaxError`, and rebinding the same name would just shadow it).
 */
function branchAttributedDropDeclarations(
  ctx: JsimContext,
  ifTokenId: number,
  branch: "then" | "else",
): JSIM.LetStatement[] {
  const drops = ctx.branchDrops.at(-1) ?? [];
  return drops
    .filter((d) => d.ifTokenId === ifTokenId && d.branch === branch)
    .map((d): JSIM.LetStatement => ({
      kind: "LetStatement",
      name: reserveLocalName(ctx, `dropShadow_${d.declaration.name}`),
      mutable: false,
      value: some({
        kind: "Identifier",
        value: emittedNameForBinding(ctx, d.declaration),
        type: none(),
      }),
      docComment: none(),
      span: resolveSpan(
        ctx.tokens,
        d.declaration.tokenId,
        d.declaration.tokenId,
      ),
      dispose: true,
    }));
}

function jsimIfStatement(
  ctx: JsimContext,
  ifExpr: Semantics.IfExpression,
): JSIM.Statement[] {
  if (ifExpr.condition.kind === "LetExpression") {
    return jsimIfLetStatement(ctx, ifExpr, ifExpr.condition);
  }
  const condition = parseExpression(ctx, ifExpr.condition);
  const thenBranch = [
    ...branchAttributedDropDeclarations(ctx, ifExpr.tokenId, "then"),
    ...jsimBranchBody(ctx, ifExpr.thenBranch),
  ];
  return [
    {
      kind: "IfStatement",
      condition,
      thenBranch,
      elseBranch: jsimElseBranch(ctx, ifExpr),
    },
  ];
}

/** The `else` branch's own statements (shadows + lowered else-body), shared
 * by the plain-`if` and `if let` lowering paths. `none()` only when there's
 * truly nothing to carry - no source `else` and no attributed shadows. */
function jsimElseBranch(
  ctx: JsimContext,
  ifExpr: Semantics.IfExpression,
): Option<JSIM.Statement[]> {
  const elseShadows = branchAttributedDropDeclarations(
    ctx,
    ifExpr.tokenId,
    "else",
  );
  return isSome(ifExpr.elseBranch)
    ? some([...elseShadows, ...jsimBranchElse(ctx, ifExpr.elseBranch.value)])
    : elseShadows.length > 0
      ? some(elseShadows)
      : none();
}

/**
 * The scrutinee is evaluated once into a synthesized temp - re-emitting it
 * at every condition/destructure site would re-run a side-effecting
 * scrutinee multiple times. `compilePatternInto` nests conditions/bindings
 * around `thenBranch`'s statements; every mismatch falls through to the
 * real `else`-branch via `fillMissingElseBranch` - unlike match/`let`,
 * `if let` has one arm and a real `else` to fall back to.
 *
 * An unconditional pattern (e.g. a bare binding) leaves nothing to test,
 * so this falls back to a literal `true` condition - rare, but still a
 * valid `if` shape.
 */
function jsimIfLetStatement(
  ctx: JsimContext,
  ifExpr: Semantics.IfExpression,
  letExpr: Semantics.LetExpression,
): JSIM.Statement[] {
  pushRenameFrame(ctx);
  try {
    const scrutineeValue = parseExpression(ctx, letExpr.scrutinee);
    const scrutineeName = reserveLocalName(ctx, "ifLetScrutinee");
    const scrutineeDecl: JSIM.LetStatement = {
      kind: "LetStatement",
      name: scrutineeName,
      mutable: false,
      value: some(scrutineeValue),
      docComment: none(),
      span: resolveSpan(ctx.tokens, letExpr.tokenId, letExpr.tokenId),
      dispose: false,
    };
    const scrutineeIdent: JSIM.Expression = {
      kind: "Identifier",
      value: scrutineeName,
      type: none(),
    };

    const thenBranch = [
      ...branchAttributedDropDeclarations(ctx, ifExpr.tokenId, "then"),
      ...jsimBranchBody(ctx, ifExpr.thenBranch),
    ];
    const continuation = compilePatternInto(
      ctx,
      letExpr.pattern,
      scrutineeIdent,
      false,
    );
    // `thenBranch` is user code, wrapped in its own block before entering
    // the continuation - `fillMissingElseBranch` below fills any elseless
    // `IfStatement` it finds, and only pattern-generated guard `IfStatement`s
    // may lack an else at this point. Splicing `thenBranch` in flat would let
    // that same recursive fill reach into a user-written `if` with no else
    // and wrongly attach this `if let`'s own else-branch to it.
    const compiled = continuation([
      { kind: "BlockStatement", body: thenBranch },
    ]);

    const elseBranch = jsimElseBranch(ctx, ifExpr);
    const withElse = fillMissingElseBranch(
      compiled,
      isSome(elseBranch) ? elseBranch.value : [],
    );

    const first = withElse[0];
    if (
      withElse.length === 1 &&
      first !== undefined &&
      first.kind === "IfStatement"
    ) {
      return [scrutineeDecl, first];
    }
    return [
      scrutineeDecl,
      {
        kind: "IfStatement",
        condition: { kind: "BooleanLiteral", value: true },
        thenBranch: withElse,
        elseBranch: none(),
      },
    ];
  } finally {
    popRenameFrame(ctx);
  }
}

/**
 * Lowers a function's own trailing expression into tail-position statements
 * ending in `return`, used only when the function has a declared non-unit
 * return type. `IfExpression` and `Block` reuse the existing leaf-return
 * lowering (`jsimIfStatement` / `jsimBranchBody`) spliced directly into the
 * function body - no IIFE. Anything else becomes a single `ReturnStatement`.
 *
 * Scoped to exactly one level: a branch/block nested *inside* the function's
 * own trailing `Block`/`IfExpression` still goes through the general
 * IIFE-wrapping `parseExpression` path (e.g. a bare block whose own trailing
 * expression is itself an `if`). Deliberately not chased further - this is
 * an obscure, non-idiomatic construct.
 */
function jsimTailStatements(
  ctx: JsimContext,
  expr: Semantics.Expression,
): JSIM.Statement[] {
  if (expr.kind === "IfExpression") return jsimIfStatement(ctx, expr);
  if (expr.kind === "Block") return jsimBranchBody(ctx, expr);
  return [{ kind: "ReturnStatement", value: some(parseExpression(ctx, expr)) }];
}

/**
 * Indexing reaches through a reference automatically (mirrors field access) -
 * resolve against the referent before checking for a real `ArrayType`.
 */
function isArrayIndexTarget(objectType: Semantics.Type): boolean {
  const resolved =
    objectType.kind === "ReferenceType" ? objectType.referent : objectType;
  return resolved.kind === "ArrayType";
}

function jsimIndexExpression(
  ctx: JsimContext,
  indexExpression: Semantics.IndexExpression,
): JSIM.Expression {
  const object = parseExpression(ctx, indexExpression.object);
  // Indexing reaches through a borrow automatically (spec 0005), mirroring
  // field access.
  return {
    kind: "IndexExpression",
    object: throughMutableReferenceCell(object, indexExpression.object),
    index: parseExpression(ctx, indexExpression.index),
    isArrayIndex: isArrayIndexTarget(indexExpression.object.type),
  };
}

function jsimTupleExpression(
  ctx: JsimContext,
  tupleExpression: Semantics.TupleExpression,
): JSIM.Expression {
  return {
    kind: "TupleExpression",
    elements: tupleExpression.elements.map((elem) =>
      parseExpression(ctx, elem),
    ),
  };
}

/**
 * A successfully-analyzed `ArrayExpression`'s own `type` is always
 * `ArrayType` - an otherwise-rejected element type (e.g. a mismatched or
 * unresolved one) is a compile error, so `driver.compile()` never reaches
 * JSIM lowering for it. A non-Copy element type is not itself rejected -
 * `[T; N]` is always move-only regardless of `T`, and a non-Copy element
 * disposes via the recursive array-disposal helper
 * (`codegen/generator.ts`'s `ARRAY_DISPOSE_HELPER`).
 */
function jsimArrayExpression(
  ctx: JsimContext,
  arrayExpression: Semantics.ArrayExpression,
): JSIM.Expression {
  assert(
    arrayExpression.type.kind === "ArrayType",
    `Expected an ArrayExpression to resolve to ArrayType, got "${arrayExpression.type.kind}"`,
  );
  return {
    kind: "ArrayExpression",
    elements: arrayExpression.elements.map((elem) =>
      parseExpression(ctx, elem),
    ),
    numericKind: hedgeTypeToNumericKind(arrayExpression.type.elementType),
  };
}

function jsimArrayRepeatExpression(
  ctx: JsimContext,
  repeatExpression: Semantics.ArrayRepeatExpression,
): JSIM.Expression {
  assert(
    repeatExpression.type.kind === "ArrayType",
    `Expected an ArrayRepeatExpression to resolve to ArrayType, got "${repeatExpression.type.kind}"`,
  );
  return {
    kind: "ArrayRepeatExpression",
    value: parseExpression(ctx, repeatExpression.value),
    count: repeatExpression.count,
    numericKind: hedgeTypeToNumericKind(repeatExpression.type.elementType),
  };
}

/** The view a slice pattern's rest binding (`..tail`) binds to - see
 * `JSIM.ArraySliceViewExpression` for the codegen split this defers to. */
function jsimArraySliceView(
  source: JSIM.Expression,
  elementType: Semantics.Type,
  start: number,
  length: number,
): JSIM.Expression {
  return {
    kind: "ArraySliceViewExpression",
    source,
    start,
    length,
    numericKind: hedgeTypeToNumericKind(elementType),
  };
}

function jsimRangeExpression(
  ctx: JsimContext,
  rangeExpression: Semantics.RangeExpression,
): JSIM.Expression {
  return {
    kind: "RangeExpression",
    start: mapSome(rangeExpression.start, (expr) => parseExpression(ctx, expr)),
    end: mapSome(rangeExpression.end, (expr) => parseExpression(ctx, expr)),
    inclusive: rangeExpression.inclusive,
  };
}

function jsimStructExpression(
  ctx: JsimContext,
  { base, fields, path, type }: Semantics.StructExpression,
): JSIM.Expression {
  const spreads = [base]
    .filter(isSome)
    .map((b) => parseExpression(ctx, b.value))
    .map(makeSpread);
  const ownFields = [...spreads, ...fields.map((f) => makeStructField(ctx, f))];
  const disposableFields = nonCopyFieldNames(fields);
  if (path.segments.length === 2 && type.kind === "EnumType") {
    const variantName = path.segments[1];
    assert(variantName !== undefined, "Unexpected undefined segment");
    return {
      kind: "StructExpression",
      fields: [
        jsimEnumTagField(variantName),
        jsimEnumDataField({
          kind: "StructExpression",
          fields: ownFields,
          disposableFields,
        }),
      ],
      disposableFields: [],
    };
  }
  return { kind: "StructExpression", fields: ownFields, disposableFields };
}

/** A tagged object with no `data` payload - a unit variant has no fields. */
function jsimEnumUnitVariantConstruction(
  segments: readonly string[],
): JSIM.Expression {
  const variantName = segments[1];
  assert(variantName !== undefined, "Unexpected undefined segment");
  return {
    kind: "StructExpression",
    fields: [jsimEnumTagField(variantName)],
    disposableFields: [],
  };
}

/** Payload lowers to `JSIM.TupleExpression`, not `ArrayExpression` - same
 * as a plain tuple expression, since it has no Vec/array runtime semantics. */
function jsimEnumTupleVariantConstruction(
  ctx: JsimContext,
  segments: readonly string[],
  args: readonly Semantics.Expression[],
): JSIM.Expression {
  const variantName = segments[1];
  assert(variantName !== undefined, "Unexpected undefined segment");
  return {
    kind: "StructExpression",
    fields: [
      jsimEnumTagField(variantName),
      jsimEnumDataField({
        kind: "TupleExpression",
        elements: args.map((arg) => parseExpression(ctx, arg)),
      }),
    ],
    disposableFields: [],
  };
}

/** `Pair(3, 4)` lowers to `{"0": 3, "1": 4, [Symbol.dispose]() {}}` - the
 * numeric-string keys are what `TupleStructPattern` reads back via
 * `dataExpr[i]`, reusing the same `StructExpression` codegen. */
function jsimTupleStructConstruction(
  ctx: JsimContext,
  args: readonly Semantics.Expression[],
): JSIM.Expression {
  return {
    kind: "StructExpression",
    fields: args.map((arg, i): JSIM.StructField => ({
      kind: "StructField",
      name: String(i),
      value: some(parseExpression(ctx, arg)),
    })),
    disposableFields: args
      .map((arg, i) => ({ arg, name: String(i) }))
      .filter(({ arg }) => !hasCapability(arg.type, "copy"))
      .map(({ name }) => name),
  };
}

/** Fields whose values own something the struct's disposer must release. */
function nonCopyFieldNames(
  fields: readonly Semantics.FieldInit[],
): readonly string[] {
  return fields
    .filter((f) => !hasCapability(f.type, "copy"))
    .map((f) => f.name.text);
}

function jsimEnumTagField(variantName: string): JSIM.StructField {
  return {
    kind: "StructField",
    name: "tag",
    value: some({ kind: "StringLiteral", value: variantName }),
  };
}

function jsimEnumDataField(value: JSIM.Expression): JSIM.StructField {
  return { kind: "StructField", name: "data", value: some(value) };
}

/* ---------- match -> switch lowering ---------- */

function jsimMatchExpression(
  ctx: JsimContext,
  matchExpr: Semantics.MatchExpression,
): JSIM.Expression {
  return {
    kind: "CallExpression",
    callee: {
      kind: "ArrowFunctionExpression",
      params: [],
      body: jsimMatchBody(ctx, matchExpr),
    },
    arguments: [],
  };
}

/** Evaluates the scrutinee once into a synthesized local, then lowers to a
 * `switch` on its `.tag` for an enum scrutinee, or an `if` chain
 * (`buildNonEnumMatchChain`) for anything else. */
function jsimMatchBody(
  ctx: JsimContext,
  matchExpr: Semantics.MatchExpression,
): JSIM.Statement[] {
  pushRenameFrame(ctx);
  try {
    const scrutineeValue = parseExpression(ctx, matchExpr.scrutinee);
    const scrutineeName = reserveLocalName(ctx, "matchScrutinee");
    const span = resolveSpan(ctx.tokens, matchExpr.tokenId, matchExpr.tokenId);
    const scrutineeDecl: JSIM.LetStatement = {
      kind: "LetStatement",
      name: scrutineeName,
      mutable: false,
      value: some(scrutineeValue),
      docComment: none(),
      span,
      dispose: false,
    };
    const scrutineeIdent: JSIM.Expression = {
      kind: "Identifier",
      value: scrutineeName,
      type: none(),
    };
    const dispatch: JSIM.Statement[] =
      matchExpr.scrutinee.type.kind === "EnumType"
        ? [buildEnumMatchSwitch(ctx, matchExpr, scrutineeIdent)]
        : buildNonEnumMatchChain(ctx, matchExpr, scrutineeIdent);
    return [scrutineeDecl, ...dispatch];
  } finally {
    popRenameFrame(ctx);
  }
}

/** One arm resolved to the sub-pattern applicable for a given tag - for a
 * top-level or-pattern, whichever alternative names that tag. */
interface DispatchedArm {
  readonly pattern: Semantics.Pattern;
  readonly guard: Option<Semantics.Expression>;
  readonly body: Semantics.Expression;
}

type TagDispatch = "universal" | ReadonlyMap<string, Semantics.Pattern>;

/** Which tag(s) an arm's pattern dispatches on, or `"universal"` for a
 * wildcard/binding catch-all. Only sees pattern kinds real semantic
 * analysis produces for an enum scrutinee - anything else was already
 * guardrail-substituted to `WildcardPattern` upstream. */
function topLevelPatternDispatch(pattern: Semantics.Pattern): TagDispatch {
  if (pattern.kind === "WildcardPattern" || pattern.kind === "BindingPattern") {
    return "universal";
  }
  if (pattern.kind === "OrPattern") {
    const map = new Map<string, Semantics.Pattern>();
    for (const alt of pattern.alternatives) {
      if (alt.kind === "WildcardPattern" || alt.kind === "BindingPattern") {
        return "universal";
      }
      map.set(variantTagOf(alt), alt);
    }
    return map;
  }
  return new Map([[variantTagOf(pattern), pattern]]);
}

function variantTagOf(pattern: Semantics.Pattern): string {
  if (
    pattern.kind !== "PathPattern" &&
    pattern.kind !== "TupleStructPattern" &&
    pattern.kind !== "StructPattern"
  ) {
    throw new Error(
      `JSIM codegen for a match arm's top-level pattern kind "${pattern.kind}" against an enum scrutinee is not yet implemented`,
    );
  }
  const tag = pattern.path.segments.at(-1);
  assert(tag !== undefined, "Unexpected empty path segments");
  return tag;
}

/**
 * Appends the throw only when `chain` isn't already guaranteed to return -
 * a trailing `ReturnStatement` (vs. `IfStatement`) proves every arm was
 * unconditional, avoiding dead code after it.
 */
function withDefenseInDepthThrow(
  chain: readonly JSIM.Statement[],
): JSIM.Statement[] {
  if (chain.at(-1)?.kind === "ReturnStatement") return [...chain];
  return [...chain, { kind: "ThrowStatement", message: "unreachable" }];
}

/**
 * Drops every arm after the first provably-unconditional one - anything
 * past it is dead code, since match evaluates arms top-to-bottom. Without
 * this, a tag whose own arm is already unconditional still drags in every
 * later wildcard arm's statements.
 */
function truncateAtFirstUnconditionalArm(
  arms: readonly DispatchedArm[],
): DispatchedArm[] {
  const index = arms.findIndex(
    (arm) => !isSome(arm.guard) && isPatternUnconditional(arm.pattern, true),
  );
  return index === -1 ? [...arms] : arms.slice(0, index + 1);
}

/**
 * `true` only when `pattern` is guaranteed to match with no runtime test -
 * conservatively `false` otherwise (including every `OrPattern`, not worth
 * the extra analysis here). `isTopLevel` mirrors `compilePatternInto`'s
 * `includeOwnTag`.
 */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function isPatternUnconditional(
  pattern: Semantics.Pattern,
  isTopLevel: boolean,
): boolean {
  switch (pattern.kind) {
    case "WildcardPattern":
    case "BindingPattern":
      return true;
    case "PathPattern":
      return isTopLevel;
    case "TupleStructPattern":
      if (pattern.type.kind === "EnumType" && !isTopLevel) return false;
      return pattern.elements.every((el) => isPatternUnconditional(el, false));
    case "StructPattern":
      if (pattern.type.kind === "EnumType" && !isTopLevel) return false;
      return pattern.fields.every(
        (f) =>
          !isSome(f.pattern) || isPatternUnconditional(f.pattern.value, false),
      );
    case "LiteralPattern":
    case "RangePattern":
    case "OrPattern":
    case "TuplePattern":
    case "SlicePattern":
      return false;
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

function buildEnumMatchSwitch(
  ctx: JsimContext,
  matchExpr: Semantics.MatchExpression,
  scrutineeExpr: JSIM.Expression,
): JSIM.SwitchStatement {
  const dispatched = matchExpr.arms.map((arm) => ({
    arm,
    dispatch: topLevelPatternDispatch(arm.pattern),
  }));

  const explicitTags = new Set<string>();
  for (const { dispatch } of dispatched) {
    if (dispatch !== "universal") {
      for (const tag of dispatch.keys()) explicitTags.add(tag);
    }
  }

  const armsForTag = (tag: string): DispatchedArm[] => {
    const applicable = dispatched.flatMap(
      ({ arm, dispatch }): DispatchedArm[] => {
        if (dispatch === "universal") {
          return [{ pattern: arm.pattern, guard: arm.guard, body: arm.body }];
        }
        const specific = dispatch.get(tag);
        return specific === undefined
          ? []
          : [{ pattern: specific, guard: arm.guard, body: arm.body }];
      },
    );
    return truncateAtFirstUnconditionalArm(applicable);
  };

  // Every chain gets its own defense-in-depth throw, not just the switch's
  // overall default - exhaustiveness checking tracks coverage by outer
  // variant name only, not nested refinement, so a chain that looks
  // exhaustive to semantics can still fail to match at runtime. Without
  // this, falling off the end would silently fall through into the next
  // case via ordinary switch fallthrough.
  const cases: JSIM.SwitchCase[] = [...explicitTags].map((tag) => ({
    kind: "SwitchCase",
    tag,
    body: withDefenseInDepthThrow(
      lowerMatchArmChain(ctx, armsForTag(tag), scrutineeExpr),
    ),
  }));

  const universalArms: DispatchedArm[] = truncateAtFirstUnconditionalArm(
    dispatched
      .filter(({ dispatch }) => dispatch === "universal")
      .map(({ arm }) => ({
        pattern: arm.pattern,
        guard: arm.guard,
        body: arm.body,
      })),
  );

  const defaultBody: JSIM.Statement[] =
    universalArms.length > 0
      ? withDefenseInDepthThrow(
          lowerMatchArmChain(ctx, universalArms, scrutineeExpr),
        )
      : [{ kind: "ThrowStatement", message: "unreachable" }];

  return {
    kind: "SwitchStatement",
    discriminant: jsimFieldAccess(scrutineeExpr, "tag"),
    cases,
    defaultBody,
  };
}

/** Non-enum scrutinee (e.g. `bool`): no `.tag` to bucket on, so every arm is
 * tried in order via the same `compilePatternInto`/`lowerMatchArmChain`
 * machinery the enum switch's per-tag chains already use. */
function buildNonEnumMatchChain(
  ctx: JsimContext,
  matchExpr: Semantics.MatchExpression,
  scrutineeExpr: JSIM.Expression,
): JSIM.Statement[] {
  const arms: DispatchedArm[] = truncateAtFirstUnconditionalArm(
    matchExpr.arms.map((arm) => ({
      pattern: arm.pattern,
      guard: arm.guard,
      body: arm.body,
    })),
  );
  return withDefenseInDepthThrow(lowerMatchArmChain(ctx, arms, scrutineeExpr));
}

/** Lowers a tag's (or the default's) applicable arms, in order, to a flat
 * sequence of destructure-then-conditionally-return statements - a guard's
 * failure (or a nested sub-pattern's own tag mismatch) falls through
 * textually to the next arm, matching `match`'s own top-to-bottom
 * evaluation order. Callers append their own defense-in-depth throw (see
 * `withDefenseInDepthThrow`) since this chain isn't always guaranteed to
 * end in a match. */
function lowerMatchArmChain(
  ctx: JsimContext,
  arms: readonly DispatchedArm[],
  scrutineeExpr: JSIM.Expression,
): JSIM.Statement[] {
  const stmts: JSIM.Statement[] = [];
  for (const arm of arms) {
    pushRenameFrame(ctx);
    try {
      // `continuation`'s call registers every name the pattern binds
      // before the guard is parsed, so a guard referencing one resolves
      // normally.
      const continuation = compilePatternInto(
        ctx,
        arm.pattern,
        scrutineeExpr,
        false,
        false,
      );
      const returnStmt: JSIM.Statement = {
        kind: "ReturnStatement",
        value: some(parseExpression(ctx, arm.body)),
      };
      const rest: JSIM.Statement[] = isSome(arm.guard)
        ? [
            {
              kind: "IfStatement",
              condition: parseExpression(ctx, arm.guard.value),
              thenBranch: [returnStmt],
              elseBranch: none(),
            },
          ]
        : [returnStmt];
      stmts.push(...continuation(rest));
    } finally {
      popRenameFrame(ctx);
    }
  }
  return stmts;
}

/**
 * A pattern compiled against a value expression, as a function from
 * "statements once this pattern is confirmed" to "the full sequence
 * including its own checks/bindings". Continuation-passing (not flat
 * condition/binding lists) keeps nested binding extraction inside the `if`
 * that confirmed it's safe - `Outer::Wrap(Inner::A(x))` must check
 * `data[0].tag === "A"` before reading `data[0].data[0]`, or a mismatched
 * `Inner::B` throws a raw `TypeError` instead of falling through.
 */
type PatternContinuation = (
  rest: readonly JSIM.Statement[],
) => readonly JSIM.Statement[];

function guardedBy(condition: JSIM.Expression): PatternContinuation {
  return (rest) => [
    { kind: "IfStatement", condition, thenBranch: rest, elseBranch: none() },
  ];
}

function composeContinuations(
  continuations: readonly PatternContinuation[],
): PatternContinuation {
  return (rest) =>
    continuations.reduceRight(
      (acc: readonly JSIM.Statement[], cont) => cont(acc),
      rest,
    );
}

/**
 * Recursively compiles a pattern against a lowered value expression -
 * shared by the top-level arm-chain builder and any nested sub-pattern.
 * Only sees pattern kinds `analyzePattern` actually produces (see
 * `topLevelPatternDispatch`'s doc comment).
 */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function compilePatternInto(
  ctx: JsimContext,
  pattern: Semantics.Pattern,
  valueExpr: JSIM.Expression,
  ambientMutable: boolean,
  // `false` only for a match arm's top-level pattern - the switch case
  // already guarantees the tag. Every recursive call leaves this at `true`.
  includeOwnTag: boolean = true,
  // `undefined` (match's usage): each binding declares its own `const`/`let`
  // inline, scoped to wherever it's nested - fine, since an arm's bindings
  // are only used within that arm. An array (let's usage): each binding
  // instead pre-declares an uninitialized `let` into it and assigns in
  // place, since a destructured name must stay visible after the whole
  // statement even when nested inside a defensive `if`.
  predecls?: JSIM.LetStatement[],
): PatternContinuation {
  switch (pattern.kind) {
    case "WildcardPattern":
      return (rest) => rest;
    case "BindingPattern": {
      const binding = bindPatternName(
        ctx,
        pattern.name,
        valueExpr,
        pattern.mutable || ambientMutable,
        pattern.byRef,
        predecls,
      );
      return (rest) => [binding, ...rest];
    }
    case "LiteralPattern": {
      const literalExpr = literalPatternExpression(
        ctx,
        pattern.literal,
        pattern.negative,
      );
      return guardedBy(
        jsimBinaryExpression(
          ctx,
          "Eq",
          valueExpr,
          literalExpr,
          pattern.tokenId,
        ),
      );
    }
    case "RangePattern": {
      const startExpr = literalPatternExpression(
        ctx,
        pattern.start.literal,
        pattern.start.negative,
      );
      const endExpr = literalPatternExpression(
        ctx,
        pattern.end.literal,
        pattern.end.negative,
      );
      const condition = jsimBinaryExpression(
        ctx,
        "And",
        jsimBinaryExpression(ctx, "Ge", valueExpr, startExpr, pattern.tokenId),
        jsimBinaryExpression(ctx, "Le", valueExpr, endExpr, pattern.tokenId),
        pattern.tokenId,
      );
      return guardedBy(condition);
    }
    case "PathPattern":
      return includeOwnTag
        ? guardedBy(
            variantTagCondition(
              ctx,
              valueExpr,
              variantTagOf(pattern),
              pattern.tokenId,
            ),
          )
        : (rest: readonly JSIM.Statement[]): readonly JSIM.Statement[] => rest;
    case "TupleStructPattern": {
      const isEnumVariant = pattern.type.kind === "EnumType";
      const effectiveMutable = pattern.mutable || ambientMutable;
      const dataExpr = isEnumVariant
        ? jsimFieldAccess(valueExpr, "data")
        : valueExpr;
      const elementsContinuation = composeContinuations(
        pattern.elements.map((el, i) =>
          compilePatternInto(
            ctx,
            el,
            {
              kind: "IndexExpression",
              object: dataExpr,
              index: { kind: "NumberLiteral", value: String(i) },
              isArrayIndex: false,
            },
            effectiveMutable,
            true,
            predecls,
          ),
        ),
      );
      if (!isEnumVariant || !includeOwnTag) return elementsContinuation;
      const tagCondition = variantTagCondition(
        ctx,
        valueExpr,
        variantTagOf(pattern),
        pattern.tokenId,
      );
      return (rest) => guardedBy(tagCondition)(elementsContinuation(rest));
    }
    case "StructPattern": {
      const isEnumVariant = pattern.type.kind === "EnumType";
      const effectiveMutable = pattern.mutable || ambientMutable;
      const dataExpr = isEnumVariant
        ? jsimFieldAccess(valueExpr, "data")
        : valueExpr;
      const fieldsContinuation = composeContinuations(
        pattern.fields.map((field): PatternContinuation => {
          const fieldValueExpr = jsimFieldAccess(dataExpr, field.name.text);
          if (isSome(field.pattern)) {
            return compilePatternInto(
              ctx,
              field.pattern.value,
              fieldValueExpr,
              effectiveMutable,
              true,
              predecls,
            );
          }
          const binding = bindPatternName(
            ctx,
            field.name,
            fieldValueExpr,
            effectiveMutable,
            false,
            predecls,
          );
          return (rest) => [binding, ...rest];
        }),
      );
      if (!isEnumVariant || !includeOwnTag) return fieldsContinuation;
      const tagCondition = variantTagCondition(
        ctx,
        valueExpr,
        variantTagOf(pattern),
        pattern.tokenId,
      );
      return (rest) => guardedBy(tagCondition)(fieldsContinuation(rest));
    }
    case "OrPattern": {
      // Reachable for a nested or-pattern, and also top-level for a
      // non-enum scrutinee (no tag to dispatch on there). Only binding-free
      // alternatives are supported; a binding one would need a conditional
      // merge this pass doesn't build.
      const altResults = pattern.alternatives.map((alt) =>
        patternCondition(alt, ctx, valueExpr),
      );
      if (altResults.some((r) => r.kind === "unsupported")) {
        throw new Error(
          "JSIM codegen for a nested or-pattern that binds names is not yet implemented",
        );
      }
      // Any unconditional alternative makes the whole disjunction
      // unconditional - mirrors `isIrrefutablePattern`'s `.some`, not
      // `.every`.
      if (altResults.some((r) => r.kind === "unconditional"))
        return (rest) => rest;
      let disjunction: Option<JSIM.Expression> = none();
      for (const r of altResults) {
        if (r.kind !== "condition") continue;
        disjunction = isSome(disjunction)
          ? some(
              jsimBinaryExpression(
                ctx,
                "Or",
                disjunction.value,
                r.expr,
                pattern.tokenId,
              ),
            )
          : some(r.expr);
      }
      return isSome(disjunction)
        ? guardedBy(disjunction.value)
        : (rest: readonly JSIM.Statement[]): readonly JSIM.Statement[] => rest;
    }
    case "SlicePattern": {
      // Always resolved against a same-length ArrayType, so it's
      // statically irrefutable - no guard needed, unlike an enum variant.
      assert(
        pattern.type.kind === "ArrayType",
        `Expected a SlicePattern to resolve to ArrayType, got "${pattern.type.kind}"`,
      );
      const { elementType, length: totalLength } = pattern.type;
      const restIndex = pattern.elements.findIndex(
        (el) => el.kind === "RestPattern",
      );
      const hasRest = restIndex !== -1;
      const beforeCount = hasRest ? restIndex : pattern.elements.length;
      const afterCount = hasRest ? pattern.elements.length - restIndex - 1 : 0;
      const continuations = pattern.elements.map(
        (el, i): PatternContinuation => {
          if (el.kind !== "RestPattern") {
            const index =
              i < beforeCount ? i : totalLength - (pattern.elements.length - i);
            return compilePatternInto(
              ctx,
              el,
              {
                kind: "IndexExpression",
                object: valueExpr,
                index: { kind: "NumberLiteral", value: String(index) },
                isArrayIndex: true,
              },
              ambientMutable,
              true,
              predecls,
            );
          }
          // Anonymous rest (`..`) - nothing to bind.
          if (!isSome(el.name)) return (rest) => rest;
          const restLength = totalLength - beforeCount - afterCount;
          const viewExpr = jsimArraySliceView(
            valueExpr,
            elementType,
            beforeCount,
            restLength,
          );
          const restMutable = el.mutable || ambientMutable;
          // Only a `&mut` rest binding's accessor cell needs a real lvalue
          // to close over (the view expression itself isn't assignable) -
          // every other rest binding can bind straight to the view.
          if (!(el.byRef && restMutable)) {
            const binding = bindPatternName(
              ctx,
              el.name.value,
              viewExpr,
              restMutable,
              el.byRef,
              predecls,
            );
            return (rest) => [binding, ...rest];
          }
          const viewTempName = reserveLocalName(ctx, "restView");
          const viewDecl: JSIM.LetStatement = {
            kind: "LetStatement",
            name: viewTempName,
            // Reached only for a `&mut` rest binding (see the branch above)
            // - its accessor cell's setter reassigns this temp, so it must
            // be a real JS `let`, not `const`.
            mutable: true,
            value: some(viewExpr),
            docComment: none(),
            span: resolveSpan(ctx.tokens, el.tokenId, el.tokenId),
            dispose: false,
          };
          const viewIdent: JSIM.Expression = {
            kind: "Identifier",
            value: viewTempName,
            type: none(),
          };
          const binding = bindPatternName(
            ctx,
            el.name.value,
            viewIdent,
            restMutable,
            el.byRef,
            predecls,
          );
          return (rest) => [viewDecl, binding, ...rest];
        },
      );
      return composeContinuations(continuations);
    }
    default:
      throw new Error(
        `JSIM codegen for enum-match pattern kind "${pattern.kind}" is not yet implemented`,
      );
  }
}

type OrAlternativeResult =
  | { readonly kind: "unconditional" }
  | { readonly kind: "condition"; readonly expr: JSIM.Expression }
  | { readonly kind: "unsupported" };

/**
 * A binding-free pattern's own match condition, used only for an
 * `OrPattern`'s alternatives (see `compilePatternInto`'s `OrPattern` case)
 * - `"unsupported"` for any pattern kind that would bind a name, since
 * this helper never registers bindings itself.
 */
function patternCondition(
  pattern: Semantics.Pattern,
  ctx: JsimContext,
  valueExpr: JSIM.Expression,
): OrAlternativeResult {
  switch (pattern.kind) {
    case "WildcardPattern":
      return { kind: "unconditional" };
    case "LiteralPattern":
      return {
        kind: "condition",
        expr: jsimBinaryExpression(
          ctx,
          "Eq",
          valueExpr,
          literalPatternExpression(ctx, pattern.literal, pattern.negative),
          pattern.tokenId,
        ),
      };
    case "RangePattern": {
      const startExpr = literalPatternExpression(
        ctx,
        pattern.start.literal,
        pattern.start.negative,
      );
      const endExpr = literalPatternExpression(
        ctx,
        pattern.end.literal,
        pattern.end.negative,
      );
      return {
        kind: "condition",
        expr: jsimBinaryExpression(
          ctx,
          "And",
          jsimBinaryExpression(
            ctx,
            "Ge",
            valueExpr,
            startExpr,
            pattern.tokenId,
          ),
          jsimBinaryExpression(ctx, "Le", valueExpr, endExpr, pattern.tokenId),
          pattern.tokenId,
        ),
      };
    }
    case "PathPattern":
      return {
        kind: "condition",
        expr: variantTagCondition(
          ctx,
          valueExpr,
          variantTagOf(pattern),
          pattern.tokenId,
        ),
      };
    case "BindingPattern":
    case "OrPattern":
    case "TuplePattern":
    case "StructPattern":
    case "TupleStructPattern":
    case "SlicePattern":
      return { kind: "unsupported" };
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

/**
 * `byRef && mutable` (`&mut name`) gets the same getter/setter accessor
 * cell a top-level `&mut` expression does; `byRef && !mutable` (`&name`)
 * reads transparently. A declared `byRef` binding's JS binding is never
 * `let` - its local slot is never reassignable, only the place behind it
 * is. `predecls` modes: see `compilePatternInto`. In assign mode, the
 * pre-declared `let` (vs `const`) is a mechanical necessity, not a change
 * in the binding's own Hedge-level mutability.
 */
function bindPatternName(
  ctx: JsimContext,
  name: Semantics.Identifier,
  valueExpr: JSIM.Expression,
  mutable: boolean,
  byRef: boolean,
  predecls: JSIM.LetStatement[] | undefined,
): JSIM.Statement {
  const emittedName = bindLocalName(ctx, name.text);
  recordEmittedName(ctx, name.tokenId, emittedName);
  const boundValue: JSIM.Expression =
    byRef && mutable
      ? { kind: "RefCellExpression", place: valueExpr }
      : valueExpr;
  const span = resolveSpan(ctx.tokens, name.tokenId, name.tokenId);
  if (predecls === undefined) {
    return {
      kind: "LetStatement",
      name: emittedName,
      mutable: !byRef && mutable,
      value: some(boundValue),
      docComment: none(),
      span,
      dispose: false,
    };
  }
  predecls.push({
    kind: "LetStatement",
    name: emittedName,
    mutable: true,
    value: none(),
    docComment: none(),
    span,
    dispose: false,
  });
  return {
    kind: "AssignExpression",
    operator: "Assign",
    lhs: { kind: "Identifier", value: emittedName, type: none() },
    rhs: boundValue,
    span: none(),
  };
}

function literalPatternExpression(
  ctx: JsimContext,
  literal:
    | Semantics.StringLiteral
    | Semantics.IntLiteral
    | Semantics.FloatLiteral
    | Semantics.CharLiteral
    | Semantics.BoolLiteral,
  negative: boolean,
): JSIM.Expression {
  const lowered = parseExpression(ctx, literal);
  if (!negative) return lowered;
  return {
    kind: "UnaryExpression",
    operator: "Neg",
    operand: lowered,
    numericKind: hedgeTypeToNumericKind(literal.type),
  };
}

function variantTagCondition(
  ctx: JsimContext,
  valueExpr: JSIM.Expression,
  tag: string,
  tokenId: number,
): JSIM.Expression {
  return jsimBinaryExpression(
    ctx,
    "Eq",
    jsimFieldAccess(valueExpr, "tag"),
    { kind: "StringLiteral", value: tag },
    tokenId,
  );
}

function jsimFieldAccess(
  object: JSIM.Expression,
  field: string,
): JSIM.Expression {
  return { kind: "FieldAccessExpression", object, field };
}

function jsimBinaryExpression(
  ctx: JsimContext,
  operator: JSIM.BinaryOperator,
  left: JSIM.Expression,
  right: JSIM.Expression,
  tokenId: number,
): JSIM.Expression {
  return {
    kind: "BinaryExpression",
    operator,
    left,
    right,
    numericKind: none(),
    span: resolveSpan(ctx.tokens, tokenId, tokenId),
  };
}

function makeStructField(
  ctx: JsimContext,
  field: Semantics.FieldInit,
): JSIM.StructField {
  const value = isSome(field.value)
    ? some(parseExpression(ctx, field.value.value))
    : some<JSIM.Expression>({
        kind: "Identifier",
        value: lookupLocalName(ctx, field.name.text),
        type: none(),
      });
  return { kind: "StructField", name: field.name.text, value };
}

function makeSpread(expression: JSIM.Expression): JSIM.SpreadExpression {
  return { kind: "SpreadExpression", expression };
}

function jsimIfExpression(
  ctx: JsimContext,
  ifExpression: Semantics.IfExpression,
): JSIM.Expression {
  return {
    kind: "CallExpression",
    callee: {
      kind: "ArrowFunctionExpression",
      params: [],
      body: jsimIfStatement(ctx, ifExpression),
    },
    arguments: [],
  };
}

function jsimIntLiteral({
  base,
  value,
  type,
}: Semantics.IntLiteral): JSIM.Expression {
  const basePrefix =
    base === 2 ? "0b" : base === 8 ? "0o" : base === 16 ? "0x" : "";
  const isBigInt =
    type.kind === "PrimitiveI64Type" || type.kind === "PrimitiveU64Type";
  const numStr = String(BigInt(basePrefix + value));
  return { kind: "NumberLiteral", value: isBigInt ? numStr + "n" : numStr };
}

/**
 * A shift's amount need not share the shifted value's type, but JS refuses to
 * mix a BigInt with a Number, so a non-bigint amount is converted when the
 * shifted value is `i64`/`u64`. Every other operand passes through unchanged.
 */
function shiftAmount(
  ctx: JsimContext,
  binExp: Semantics.BinaryExpression,
): JSIM.Expression {
  const right = parseExpression(ctx, binExp.right);
  const isShift = binExp.operator === "Shl" || binExp.operator === "Shr";
  if (!isShift) return right;
  const shifted = hedgeTypeToNumericKind(binExp.left.type);
  const amount = hedgeTypeToNumericKind(binExp.right.type);
  const shiftedIsBigint = isSome(shifted) && shifted.value.kind === "bigint";
  const amountIsBigint = isSome(amount) && amount.value.kind === "bigint";
  if (!shiftedIsBigint || amountIsBigint) return right;
  return {
    kind: "CallExpression",
    callee: { kind: "Identifier", value: "BigInt", type: none() },
    arguments: [right],
  };
}

function parseBinaryExpression(
  ctx: JsimContext,
  binExp: Semantics.BinaryExpression,
): JSIM.Expression {
  const numericKind: Option<JSIM.NumericKind> = ARITHMETIC_OPS.has(
    binExp.operator,
  )
    ? hedgeTypeToNumericKind(binExp.type)
    : none();
  const startTokenId = leftmostExpressionTokenId(binExp);
  return {
    kind: binExp.kind,
    operator: binExp.operator,
    left: parseExpression(ctx, binExp.left),
    right: shiftAmount(ctx, binExp),
    numericKind,
    span: resolveSpan(
      ctx.tokens,
      startTokenId,
      findExpressionEndTokenId(ctx.tokens, startTokenId),
    ),
  };
}

function parseUnaryExpression(
  ctx: JsimContext,
  unaryExp: Semantics.UnaryExpression,
): JSIM.Expression {
  const numericKind = hedgeTypeToNumericKind(unaryExp.type);
  // A numeric `!` is bitwise, and needs the same width wrapping `Neg` gets.
  const operator: JSIM.UnaryOperator =
    unaryExp.operator === "Not" && isSome(numericKind)
      ? "BitNot"
      : unaryExp.operator;
  return {
    kind: unaryExp.kind,
    operator,
    operand: parseExpression(ctx, unaryExp.operand),
    numericKind: operator === "Not" ? none() : numericKind,
  };
}

function parseAssignExpression(
  ctx: JsimContext,
  assignExp: Semantics.AssignExpression,
): JSIM.AssignExpression {
  return {
    kind: "AssignExpression",
    operator: "Assign",
    lhs: parseExpression(ctx, assignExp.lhs),
    rhs: parseExpression(ctx, assignExp.rhs),
    span: none(),
  };
}

function parseCompoundAssignExpression(
  ctx: JsimContext,
  compoundAssignExp: Semantics.CompoundAssignExpression,
): JSIM.AssignExpression {
  return {
    kind: "AssignExpression",
    operator: compoundAssignExp.operator,
    lhs: parseExpression(ctx, compoundAssignExp.lhs),
    rhs: parseExpression(ctx, compoundAssignExp.rhs),
    span: none(),
  };
}

/**
 * An assignment used as a bare statement (`*r = 1;`) gets its own
 * source-map span, from its lhs's leftmost token through the matching
 * depth-0 `;` - the same technique `LetStatement` already uses. A nested
 * occurrence (inside a larger expression) keeps `span: none()` from
 * `parseAssignExpression`/`parseCompoundAssignExpression` instead, since it
 * has no statement-level `;` of its own to bound a span with.
 */
function parseAssignStatement(
  ctx: JsimContext,
  expression: Semantics.AssignExpression | Semantics.CompoundAssignExpression,
): JSIM.Statement {
  const lowered =
    expression.kind === "AssignExpression"
      ? parseAssignExpression(ctx, expression)
      : parseCompoundAssignExpression(ctx, expression);
  return {
    ...lowered,
    span: some(
      resolveSpan(
        ctx.tokens,
        expression.lhs.tokenId,
        findStatementEndTokenId(ctx.tokens, expression.lhs.tokenId),
      ),
    ),
  };
}

function isMutableReferenceTyped(expression: Semantics.Expression): boolean {
  const type = expression.type;
  return type.kind === "ReferenceType" && type.mutable;
}

/**
 * Applies the `.v` hop needed to read through a `&mut` borrow's cell before
 * projecting into its referent. No-op unless `semanticExpr`'s type is a
 * mutable `ReferenceType` - a shared reference's `lowered` form is already
 * transparent.
 */
function throughMutableReferenceCell(
  lowered: JSIM.Expression,
  semanticExpr: Semantics.Expression,
): JSIM.Expression {
  return isMutableReferenceTyped(semanticExpr)
    ? { kind: "FieldAccessExpression", object: lowered, field: "v" }
    : lowered;
}

/**
 * The analyzer's borrowable-place check ({@link isBorrowablePlace}) guarantees
 * a `&mut` borrow's operand is always some place - a bare local/parameter, or
 * a {@link FieldAccessExpression}/{@link IndexExpression}/{@link DereferenceExpression}
 * projection chain grounded in one - by the time a program reaches
 * JSIM lowering. Lowering the operand the same way an ordinary read of that
 * place would ({@link parseExpression}, already `.v`-hop-aware via
 * {@link parseFieldAccessExpression}/`parseDereferenceExpression`)
 * gives the cell's own get/set body: closing over a bare local's
 * {@link Identifier} is the degenerate one-node case of the same mechanism.
 */
function parseMutableReferenceExpression(
  ctx: JsimContext,
  expression: Semantics.ReferenceExpression,
): JSIM.Expression {
  const place = parseExpression(ctx, expression.operand);
  return { kind: "RefCellExpression", place };
}

function parseFieldAccessExpression(
  ctx: JsimContext,
  fieldAccessExp: Semantics.FieldAccessExpression,
): JSIM.Expression {
  const object = parseExpression(ctx, fieldAccessExp.object);
  // Field access reaches through a borrow automatically (spec 0005).
  return {
    kind: "FieldAccessExpression",
    object: throughMutableReferenceCell(object, fieldAccessExp.object),
    field: fieldAccessExp.field.text,
  };
}
