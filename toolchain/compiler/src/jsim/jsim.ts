import { isSome, mapSome, none, type Option, some } from "../option.js";
import type { Token } from "../lexer/token.js";
import type { Declaration } from "../ownership/control-flow-graph.js";
import type { FunctionOwnership } from "../ownership/move-check.js";
import type * as Semantics from "../semantics/ast.js";
import type * as JSIM from "./ast.js";
import { toDocComment } from "./parts/doc-comment.js";
import {
  findExpressionEndTokenId,
  findLetStatementEndTokenId,
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
  /** Per-function stack of that function's own scope-end drop map, keyed by block tokenId. */
  readonly drops: ReadonlyMap<number, readonly Declaration[]>[];
}

/**
 * Creates a JsimContext object using the provided tokens and ownership mapping.
 *
 * @param tokens - A readonly array of Token objects to be included in
 *   the context.
 * @param ownership - A readonly map associating identifiers with their
 *   respective FunctionOwnership.
 *
 * @return The newly created JsimContext containing the provided tokens and
 *   ownership mapping, with empty rename and drops arrays.
 */
function createJsimContext(
  tokens: readonly Token[],
  ownership: ReadonlyMap<string, FunctionOwnership>,
): JsimContext {
  return {
    tokens,
    ownership,
    rename: [],
    drops: [],
  };
}

/**
 * Retrieves the declarations that need scope-end drop in the block owning
 * {@link blockTokenId}, for the function currently being lowered.
 *
 * @param ctx - The JsimContext object containing the current state of the
 *   JSIM creation process.
 * @param blockTokenId - The token ID of the block for which scope-end drops
 *   are being retrieved.
 *
 * @return A readonly array of Declaration objects that need scope-end drop in
 *   the specified block.
 */
function scopeDrops(
  ctx: JsimContext,
  blockTokenId: number,
): readonly Declaration[] {
  return ctx.drops.at(-1)?.get(blockTokenId) ?? [];
}

/**
 * Tracks the alpha-renames from source-name to emitted-name per scope frame.
 * Null outside function bodies (top-level items are not renamed).
 */
interface RenameCtx {
  /**
   * A collection of maps where each map contains string key-value pairs.
   * Each map represents a "frame" in the collection.
   *
   * This variable is typically used to store structured data,
   * with keys and values representing specific attributes or properties.
   */
  frames: Map<string, string>[];

  /**
   * A map to store counters, where each key is a string identifier and
   * the corresponding value is a numeric count.
   *
   * This variable is typically used for tracking occurrences or managing
   * counts of specific entities, identified by their string keys.
   */
  counters: Map<string, number>;

  /**
   * A Set that contains the names of events or signals that have been emitted.
   * This collection is used to track unique event names to prevent duplication
   * or for reference in event handling logic.
   */
  emittedNames: Set<string>;
}

/**
 * Executes a function within a specific context, managing the necessary setup
 * and teardown of the context stack.
 *
 * @param ctx - The context object that manages state for the function.
 * @param functionName - The name of the function being executed in the context.
 * @param fn - The function to be executed within the specified context.
 *
 * @return The result of the executed function.
 */
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
  try {
    return fn();
  } finally {
    ctx.rename.pop();
    ctx.drops.pop();
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
 * Converts a given semantic program representation into its equivalent
 * JSIM structure.
 *
 * @param program - The semantic program to be converted.
 * @param tokens - A readonly array of tokens associated with the program.
 * @param ownership - A readonly map defining function ownership details.
 *
 * @return The converted JSIM program representation.
 */
export function toJsim(
  program: Semantics.Program,
  tokens: readonly Token[],
  ownership: ReadonlyMap<string, FunctionOwnership> = new Map(),
): JSIM.Program {
  const ctx = createJsimContext(tokens, ownership);
  return {
    kind: "Program",
    docComment: toDocComment(program.attributes),
    items: program.items.flatMap((i) => parseItem(ctx, i)),
  };
}

interface JsPrimitiveType {
  kind: "PrimitiveType";
  value: "string" | "number" | "bigint" | "boolean" | "null";
}

// eslint-disable-next-line complexity -- Routing function
function semanticTypeToJsPrimitive(
  type: Semantics.Type,
): Option<JsPrimitiveType> {
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
      return some({ kind: "PrimitiveType", value: "null" });
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
  return parseExpression(ctx, item);
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
    const emittedParams = fn.params.map((p) => ({
      param: p,
      emittedName: bindLocalName(ctx, p.pattern.name.text),
    }));
    return parseFunctionBody(ctx, fn, emittedParams);
  });
}

/**
 * A struct-typed parameter still owned (unconditionally, per `analyzeOwnership`)
 * at the function's own top-level scope end needs scope-end drop, but a JS
 * `using` binding can't reuse its own parameter's name (`using p = p;` is a
 * `SyntaxError`) and can't be reassigned (so a `mut` parameter is excluded,
 * matching the same restriction on local `let` bindings — see `emitLet`).
 * Re-binds the parameter's source name to a fresh alpha-rename shadow via the
 * existing collision-avoidance machinery, then returns a synthetic
 * `using <shadow> = <original>;` statement to prepend to the body — every
 * later `lookupLocalName` reference resolves to the shadow for free.
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
    ...fn.body.statements.map((stmt) => parseStatement(ctx, stmt, rootDrops)),
  ];
  if (isSome(fn.body.trailingExpression)) {
    const trailing = fn.body.trailingExpression.value;
    statements.push(
      ...(isSome(declaredReturnType)
        ? jsimTailStatements(ctx, trailing)
        : [parseExpression(ctx, trailing)]),
    );
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
 * `scopeDrops` is the enclosing block's own scope-end drop list — passed in
 * by the caller (rather than looked up here) because `parseStatement` itself
 * doesn't know which `Semantics.Block` it's being lowered for; only the
 * block-lowering call sites (`parseFunctionBody`, `jsimBlockStatement`,
 * `jsimBranchBody`) do.
 */
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
          findLetStatementEndTokenId(ctx.tokens, statement.tokenId),
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
      return parseExpression(ctx, statement.expression);
    case "Function":
      return parseFunction(ctx, statement);
    case "Struct":
      // Struct declarations are type-only — no JS runtime representation.
      return { kind: "BlockStatement", body: [] };
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
    const body = block.statements.map((stmt) =>
      parseStatement(ctx, stmt, drops),
    );
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
      // References are transparent in JS — emit the operand directly.
      return parseExpression(ctx, expression.operand);
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
    case "StructExpression":
      return jsimStructExpression(ctx, expression);
    case "IfExpression":
      return jsimIfExpression(ctx, expression);
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
    const stmts: JSIM.Statement[] = block.statements.map((stmt) =>
      parseStatement(ctx, stmt, drops),
    );
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

function jsimIfStatement(
  ctx: JsimContext,
  ifExpr: Semantics.IfExpression,
): JSIM.IfStatement {
  return {
    kind: "IfStatement",
    condition: parseExpression(ctx, ifExpr.condition),
    thenBranch: jsimBranchBody(ctx, ifExpr.thenBranch),
    elseBranch: mapSome(ifExpr.elseBranch, (eb) => jsimBranchElse(ctx, eb)),
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

function jsimIndexExpression(
  ctx: JsimContext,
  indexExpression: Semantics.IndexExpression,
): JSIM.Expression {
  return {
    kind: "IndexExpression",
    object: parseExpression(ctx, indexExpression.object),
    index: parseExpression(ctx, indexExpression.index),
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
): JSIM.Expression {
  return {
    kind: "AssignExpression",
    operator: "Assign",
    lhs: parseExpression(ctx, assignExp.lhs),
    rhs: parseExpression(ctx, assignExp.rhs),
  };
}

function parseCompoundAssignExpression(
  ctx: JsimContext,
  compoundAssignExp: Semantics.CompoundAssignExpression,
): JSIM.Expression {
  return {
    kind: "AssignExpression",
    operator: compoundAssignExp.operator,
    lhs: parseExpression(ctx, compoundAssignExp.lhs),
    rhs: parseExpression(ctx, compoundAssignExp.rhs),
  };
}

function parseFieldAccessExpression(
  ctx: JsimContext,
  fieldAccessExp: Semantics.FieldAccessExpression,
): JSIM.Expression {
  return {
    kind: "FieldAccessExpression",
    object: parseExpression(ctx, fieldAccessExp.object),
    field: fieldAccessExp.field.text,
  };
}
