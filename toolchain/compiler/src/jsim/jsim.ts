import { isSome, mapSome, none, type Option, some } from "../option.js";
import type { Token } from "../lexer/token.js";
import type {
  BindingId,
  Declaration,
} from "../ownership/control-flow-graph.js";
import type {
  BranchDrop,
  ConditionalDrop,
  FunctionOwnership,
} from "../ownership/move-check.js";
import { constValueToLiteralExpression } from "../semantics/analyzer.js";
import type * as Semantics from "../semantics/ast.js";
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
  const allocated = bindLocalName(ctx, `dropFlag_${declaration.name}`);
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
  const result: JSIM.Statement[] = [lowered];

  if (statement.kind === "LetStatement" && lowered.kind === "LetStatement") {
    const conditional = allConditionalDrops(ctx).find(
      (c) => c.declaration.id === statement.pattern.name.tokenId,
    );
    if (conditional !== undefined) {
      result.push(
        dropFlagDeclareStatement(ctx, conditional.declaration, lowered.span),
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

function bindLocalName(ctx: JsimContext, sourceName: string): string {
  const renameCtx = getCurrentRenameContext(ctx);
  if (!isSome(renameCtx)) {
    return sourceName;
  }
  const visible = renameCtx.value.frames.some((f) => f.has(sourceName));
  const frame = renameCtx.value.frames.at(-1);
  assert(frame !== undefined, "Expected a rename frame to be present");
  // emittedNames is maintained incrementally to avoid O(N²) flatMap on each
  // bind call. It catches value collisions: if a shadow of x already emitted
  // x$1, a subsequent user-defined x$1 must also be renamed.
  const { emittedNames } = renameCtx.value;
  if (visible || emittedNames.has(sourceName)) {
    let k = (renameCtx.value.counters.get(sourceName) ?? 0) + 1;
    let emitted = `${sourceName}$${k}`;
    while (
      renameCtx.value.frames.some((f) => f.has(emitted)) ||
      emittedNames.has(emitted)
    ) {
      k += 1;
      emitted = `${sourceName}$${k}`;
    }
    renameCtx.value.counters.set(sourceName, k);
    frame.set(sourceName, emitted);
    emittedNames.add(emitted);
    return emitted;
  }
  emittedNames.add(sourceName);
  frame.set(sourceName, sourceName);
  return sourceName;
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
    default:
      return none();
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
    default:
      return none();
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
  // TODO (Hedge-48): enum -> tagged-object lowering isn't implemented yet -
  // a bare declaration erases to nothing, same as a non-pub const.
  if (item.kind === "Enum") return [];
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
  // TODO: Implement how structs are represented in JS (interface for .d.ts)
  return [];
}

function parseFunction(
  ctx: JsimContext,
  fn: Semantics.FunctionDecl,
): JSIM.FunctionDecl {
  return withFunctionCtx(ctx, fn.name.text, () => {
    // Pre-bind params so inner `let` with the same name gets a unique suffix.
    // Capture the emitted name so the function declaration stays in sync with
    // whatever the rename context assigns (defensive: currently always identity
    // since params are the first things bound in a fresh function scope).
    const emittedParams = fn.params.map((p) => {
      const emittedName = bindLocalName(ctx, p.pattern.name.text);
      recordEmittedName(ctx, p.pattern.name.tokenId, emittedName);
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
    param: Semantics.FunctionDecl["params"][number];
    emittedName: string;
  }>,
  rootDrops: readonly Declaration[],
): JSIM.LetStatement[] {
  const shadows: JSIM.LetStatement[] = [];
  for (const { param, emittedName } of emittedParams) {
    if (param.mutable) continue;
    const needsDrop = rootDrops.some(
      (d) => d.id === param.pattern.name.tokenId,
    );
    if (!needsDrop) continue;
    const shadowName = bindLocalName(ctx, param.pattern.name.text);
    shadows.push({
      kind: "LetStatement",
      name: shadowName,
      mutable: false,
      value: some({ kind: "Identifier", value: emittedName, type: none() }),
      docComment: none(),
      span: resolveSpan(
        ctx.tokens,
        param.pattern.name.tokenId,
        param.pattern.name.tokenId,
      ),
      dispose: true,
    });
  }
  return shadows;
}

function parseFunctionBody(
  ctx: JsimContext,
  fn: Semantics.FunctionDecl,
  emittedParams: ReadonlyArray<{
    param: Semantics.FunctionDecl["params"][number];
    emittedName: string;
  }>,
): JSIM.FunctionDecl {
  const innerDoc = toDocComment(fn.body.innerAttributes);
  const outerDoc = toDocComment(fn.attributes);
  const docComment = isSome(innerDoc) ? innerDoc : outerDoc;

  // A declared, non-unit return type. When Some, Gap-A's return-type-mismatch
  // check (checkFunctionReturnType in analyzer.ts) already guarantees
  // fn.body.trailingExpression is Some and its type matches — no defensive
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
  const paramShadows = dropParamShadows(ctx, emittedParams, rootDrops);
  const statements: JSIM.Statement[] = [
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
): JSIM.Statement {
  switch (statement.kind) {
    case "LetStatement": {
      // Evaluate the initializer BEFORE binding the name so that
      // `let x = x + 1` resolves the RHS `x` to the *outer* binding.
      const value = mapSome(statement.initializer, (expr) =>
        parseExpression(ctx, expr),
      );
      const name = bindLocalName(ctx, statement.pattern.name.text);
      recordEmittedName(ctx, statement.pattern.name.tokenId, name);
      const dispose =
        !statement.mutable &&
        scopeDrops.some((d) => d.id === statement.pattern.name.tokenId);
      return {
        kind: "LetStatement",
        name,
        mutable: statement.mutable,
        value,
        docComment: toDocComment(statement.attributes),
        span: resolveSpan(
          ctx.tokens,
          statement.tokenId,
          findStatementEndTokenId(ctx.tokens, statement.tokenId),
        ),
        dispose,
      };
    }
    case "ExpressionStatement":
      if (statement.expression.kind === "Block") {
        return jsimBlockStatement(ctx, statement.expression);
      }
      if (statement.expression.kind === "IfExpression") {
        return jsimIfExpressionAsStatement(ctx, statement.expression);
      }
      if (
        statement.expression.kind === "AssignExpression" ||
        statement.expression.kind === "CompoundAssignExpression"
      ) {
        return parseAssignStatement(ctx, statement.expression);
      }
      return parseExpression(ctx, statement.expression);
    case "Function":
      return parseFunction(ctx, statement);
    case "Struct":
      // Struct declarations are type-only — no JS runtime representation.
      return { kind: "BlockStatement", body: [] };
    case "Enum":
      // TODO (Hedge-48): same erasure as Struct above - enum-to-tagged-object
      // codegen isn't implemented yet.
      return { kind: "BlockStatement", body: [] };
    case "Const":
      // Same erasure as a top-level const (see `parseItem`) - every
      // reference already lowered to a literal at analysis time.
      return { kind: "BlockStatement", body: [] };
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
): JSIM.Statement {
  const hasResult =
    jsimBranchHasResult(ifExpr.thenBranch) ||
    (isSome(ifExpr.elseBranch) && jsimBranchHasResult(ifExpr.elseBranch.value));
  if (hasResult) return jsimIfExpression(ctx, ifExpr);
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
    case "MatchExpression":
      // TODO (Hedge-48): real match->switch codegen isn't implemented yet -
      // a match that passes semantic analysis cleanly still can't be
      // lowered, so this throws rather than silently erasing the arm
      // values it would otherwise discard.
      throw new Error(
        "JSIM codegen for match expressions is not yet implemented",
      );
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
  if (branch.kind === "IfExpression") return [jsimIfStatement(ctx, branch)];
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
      name: bindLocalName(ctx, `dropShadow_${d.declaration.name}`),
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
): JSIM.IfStatement {
  const condition = parseExpression(ctx, ifExpr.condition);
  const thenBranch = [
    ...branchAttributedDropDeclarations(ctx, ifExpr.tokenId, "then"),
    ...jsimBranchBody(ctx, ifExpr.thenBranch),
  ];
  const elseShadows = branchAttributedDropDeclarations(
    ctx,
    ifExpr.tokenId,
    "else",
  );
  // A source-written `else` (even an empty one) always survives as `Some`,
  // matching the pre-existing behavior for an explicit empty else block --
  // only a *synthesized* else (no source else at all) collapses back to
  // `none()` when there's nothing to carry.
  const elseBranch: Option<JSIM.Statement[]> = isSome(ifExpr.elseBranch)
    ? some([...elseShadows, ...jsimBranchElse(ctx, ifExpr.elseBranch.value)])
    : elseShadows.length > 0
      ? some(elseShadows)
      : none();
  return {
    kind: "IfStatement",
    condition,
    thenBranch,
    elseBranch,
  };
}

/**
 * Lowers a function's own trailing expression into tail-position statements
 * ending in `return`, used only when the function has a declared non-unit
 * return type. `IfExpression` and `Block` reuse the existing leaf-return
 * lowering (`jsimIfStatement` / `jsimBranchBody`) spliced directly into the
 * function body — no IIFE. Anything else becomes a single `ReturnStatement`.
 *
 * Scoped to exactly one level: a branch/block nested *inside* the function's
 * own trailing `Block`/`IfExpression` still goes through the general
 * IIFE-wrapping `parseExpression` path (e.g. a bare block whose own trailing
 * expression is itself an `if`). Deliberately not chased further — this is
 * an obscure, non-idiomatic construct.
 */
function jsimTailStatements(
  ctx: JsimContext,
  expr: Semantics.Expression,
): JSIM.Statement[] {
  if (expr.kind === "IfExpression") return [jsimIfStatement(ctx, expr)];
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
  { base, fields }: Semantics.StructExpression,
): JSIM.Expression {
  return {
    kind: "StructExpression",
    fields: [
      ...[base]
        .filter(isSome)
        .map((b) => parseExpression(ctx, b.value))
        .map(makeSpread),
      ...fields.map((f) => makeStructField(ctx, f)),
    ],
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
      body: [jsimIfStatement(ctx, ifExpression)],
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
    right: parseExpression(ctx, binExp.right),
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
  const numericKind: Option<JSIM.NumericKind> =
    unaryExp.operator === "Neg"
      ? hedgeTypeToNumericKind(unaryExp.type)
      : none();
  return {
    kind: unaryExp.kind,
    operator: unaryExp.operator,
    operand: parseExpression(ctx, unaryExp.operand),
    numericKind,
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
 * {@link parseFieldAccessExpression}/{@link parseDereferenceExpression})
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
