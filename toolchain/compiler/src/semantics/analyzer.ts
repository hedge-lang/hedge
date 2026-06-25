import { assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some } from "../option.js";
import { HEDGE_PRIMITIVE_TYPES } from "../primitives.js";
import type {
  Block,
  CallExpression,
  Expression,
  FunctionDecl,
  Identifier,
  Item,
  LetStatement,
  PathExpression,
  Program,
  Statement,
  Type,
} from "../parser/ast.js";

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
}

/** Names available before any user code. A slice-1 stand-in for the prelude. */
const BUILTINS: readonly string[] = ["print"];

/**
 * Mutable analysis context threaded explicitly through every pass function.
 * Maps onto `struct AnalysisContext { scopes: ..., diagnostics: ... }` in Hedge.
 */
interface AnalysisContext {
  readonly scopes: Set<string>[];
  readonly diagnostics: Diagnostic[];
  readonly tokens: readonly Token[];
}

function analyzeItem(ctx: AnalysisContext, item: Item): void {
  switch (item.kind) {
    case "Function":
      analyzeFunctionDecl(ctx, item);
      return;
    case "Struct":
      return;
    default:
      emitError(
        ctx,
        "only function and struct declarations are allowed at the top level",
        item.tokenId,
      );
  }
}

function validateSlice1Type(
  ctx: AnalysisContext,
  type: Type,
  tokenId: number,
): void {
  if (
    type.kind === "NamedType" &&
    type.path.segments.length === 1 &&
    HEDGE_PRIMITIVE_TYPES.has(String(type.path.segments[0]))
  ) {
    return;
  }
  if (type.kind === "UnitType") return;
  emitError(
    ctx,
    "type is not supported in Slice 1 function signatures",
    tokenId,
  );
}

function analyzeFunctionDecl(ctx: AnalysisContext, decl: FunctionDecl): void {
  ctx.scopes.push(new Set());
  for (const param of decl.params) {
    validateSlice1Type(ctx, param.type, param.type.tokenId);
    bind(ctx, param.pattern.name.text);
  }
  if (isSome(decl.returnType)) {
    validateSlice1Type(
      ctx,
      decl.returnType.value,
      decl.returnType.value.tokenId,
    );
  }
  analyzeBlock(ctx, decl.body);
  ctx.scopes.pop();
}

function analyzeBlock(ctx: AnalysisContext, block: Block): void {
  ctx.scopes.push(new Set());
  for (const statement of block.statements) {
    analyzeStatement(ctx, statement);
  }
  if (isSome(block.trailingExpression)) {
    analyzeExpression(ctx, block.trailingExpression.value);
  }
  ctx.scopes.pop();
}

function analyzeStatement(ctx: AnalysisContext, statement: Statement): void {
  switch (statement.kind) {
    case "LetStatement":
      analyzeLetStatement(ctx, statement);
      return;
    case "ExpressionStatement":
      analyzeExpression(ctx, statement.expression);
      return;
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
  }
}

function analyzeLetStatement(
  ctx: AnalysisContext,
  statement: LetStatement,
): void {
  if (isSome(statement.initializer)) {
    analyzeExpression(ctx, statement.initializer.value);
  }
  bind(ctx, statement.pattern.name.text);
}

// eslint-disable-next-line complexity -- This is a routing function
function analyzeExpression(ctx: AnalysisContext, expression: Expression): void {
  switch (expression.kind) {
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
      return;
    case "PathExpression":
      analyzePath(ctx, expression);
      return;
    case "CallExpression":
      analyzeCall(ctx, expression);
      return;
    case "ReferenceExpression":
      emitError(
        ctx,
        "borrow expressions are not supported in Slice 1",
        expression.tokenId,
      );
      return;
    case "BinaryExpression":
      analyzeExpression(ctx, expression.left);
      analyzeExpression(ctx, expression.right);
      return;
    case "UnaryExpression":
      analyzeExpression(ctx, expression.operand);
      return;
    case "AssignExpression":
    case "CompoundAssignExpression":
      analyzeExpression(ctx, expression.lhs);
      analyzeExpression(ctx, expression.rhs);
      return;
    case "FieldAccessExpression":
      analyzeExpression(ctx, expression.object);
      return;
    case "MethodCallExpression":
      analyzeExpression(ctx, expression.receiver);
      for (const arg of expression.arguments) analyzeExpression(ctx, arg);
      return;
    case "IndexExpression":
      analyzeExpression(ctx, expression.object);
      analyzeExpression(ctx, expression.index);
      return;
    case "TupleExpression":
      for (const elem of expression.elements) analyzeExpression(ctx, elem);
      return;
    case "StructExpression":
      for (const field of expression.fields) {
        if (isSome(field.value)) analyzeExpression(ctx, field.value.value);
      }
      if (isSome(expression.base))
        analyzeExpression(ctx, expression.base.value);
      return;
    case "IfExpression":
      analyzeExpression(ctx, expression.condition);
      analyzeBlock(ctx, expression.thenBranch);
      if (isSome(expression.elseBranch))
        analyzeExpression(ctx, expression.elseBranch.value);
      return;
    case "Block":
      analyzeBlock(ctx, expression);
      return;
    case "Identifier":
      analyzeIdentifier(ctx, expression);
      return;
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

function analyzeIdentifier(ctx: AnalysisContext, identifier: Identifier): void {
  if (resolve(ctx, identifier.text)) {
    return;
  }
  emitError(
    ctx,
    `Cannot find name "${identifier.text}" in this scope.`,
    identifier.tokenId,
  );
}

function analyzeCall(ctx: AnalysisContext, call: CallExpression): void {
  analyzeExpression(ctx, call.callee);
  for (const argument of call.arguments) {
    analyzeExpression(ctx, argument);
  }
}

function analyzePath(ctx: AnalysisContext, path: PathExpression): void {
  const { segments } = path.path;
  // Multi-segment paths (modules, associated items) are a later slice.
  if (segments.length !== 1) {
    return;
  }
  const name = segments[0];
  if (name === undefined || resolve(ctx, name)) {
    return;
  }
  emitError(ctx, `Cannot find name "${name}" in this scope.`, path.tokenId);
}

function bind(ctx: AnalysisContext, name: string): void {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (scope !== undefined) {
    scope.add(name);
  }
}

function resolve(ctx: AnalysisContext, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
    const scope = ctx.scopes[i];
    if (scope !== undefined && scope.has(name)) {
      return true;
    }
  }
  return false;
}

function emitError(
  ctx: AnalysisContext,
  message: string,
  tokenId: number,
): void {
  const token = ctx.tokens[tokenId];
  ctx.diagnostics.push({
    severity: "error",
    message,
    span: token !== undefined ? some(token.span) : none(),
  });
}

/**
 * Run semantic analysis (name resolution) over a parsed program.
 *
 * Slice-1 scope: a builtin prelude, then per-function and per-block scopes;
 * `let` binds into the current scope after its initializer is analyzed.
 */
export function analyze(
  program: Program,
  tokens: readonly Token[],
): AnalysisResult {
  const ctx: AnalysisContext = {
    scopes: [new Set(BUILTINS)],
    diagnostics: [],
    tokens,
  };
  for (const item of program.items) {
    analyzeItem(ctx, item);
  }
  return { diagnostics: ctx.diagnostics };
}
