import { assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type {
  Expression,
  FunctionDecl,
  Item,
  Program,
  Statement,
} from "../parser/ast.js";

/** A borrow introduced by `let r = &[write] base`. */
interface Borrow {
  /**
   * The borrowing binding.
   */
  readonly name: string;

  /**
   * The borrowed variable.
   */
  readonly base: string;

  /**
   * Whether the variable is mutable.
   */
  readonly mutable: boolean;

  /**
   * The index of the statement where the borrow is created.
   */
  readonly declIndex: number;

  /**
   * The token ID of the reference, used for diagnostics.
   */
  readonly tokenId: number;
}

/**
 * Collect the names of single-segment paths referenced in an expression.
 *
 * @param expression The expression to analyze.
 * @param out A set to which the names of referenced paths will be added.
 */
// eslint-disable-next-line complexity -- This is a routing function
function collectUses(expression: Expression, out: Set<string>): void {
  switch (expression.kind) {
    case "PathExpression": {
      const { segments } = expression.path;
      const name = segments.length === 1 ? segments[0] : undefined;
      if (name !== undefined) {
        out.add(name);
      }
      return;
    }
    case "CallExpression":
      collectUses(expression.callee, out);
      for (const argument of expression.arguments) {
        collectUses(argument, out);
      }
      return;
    case "ReferenceExpression":
      collectUses(expression.operand, out);
      return;
    case "BinaryExpression":
      collectUses(expression.left, out);
      collectUses(expression.right, out);
      return;
    case "UnaryExpression":
      collectUses(expression.operand, out);
      return;
    case "AssignExpression":
    case "CompoundAssignExpression":
      collectUses(expression.lhs, out);
      collectUses(expression.rhs, out);
      return;
    case "FieldAccessExpression":
      collectUses(expression.object, out);
      return;
    case "MethodCallExpression":
      collectUses(expression.receiver, out);
      for (const arg of expression.arguments) collectUses(arg, out);
      return;
    case "IndexExpression":
      collectUses(expression.object, out);
      collectUses(expression.index, out);
      return;
    case "TupleExpression":
      for (const elem of expression.elements) collectUses(elem, out);
      return;
    case "StructExpression":
      for (const field of expression.fields) {
        if (isSome(field.value)) collectUses(field.value.value, out);
      }
      if (isSome(expression.base)) collectUses(expression.base.value, out);
      return;
    case "IfExpression":
      collectUses(expression.condition, out);
      for (const stmt of expression.thenBranch.statements)
        statementUses(stmt, out);
      if (isSome(expression.thenBranch.trailingExpression)) {
        collectUses(expression.thenBranch.trailingExpression.value, out);
      }
      if (isSome(expression.elseBranch))
        collectUses(expression.elseBranch.value, out);
      return;
    case "Block":
      for (const stmt of expression.statements) statementUses(stmt, out);
      if (isSome(expression.trailingExpression)) {
        collectUses(expression.trailingExpression.value, out);
      }
      return;
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
    case "Identifier":
      return;
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

/**
 * Collect the names of single-segment paths referenced in a statement.
 *
 * @param statement The statement to analyze.
 * @param out A set to which the names of referenced paths will be added.
 */
function statementUses(statement: Statement, out: Set<string>): void {
  switch (statement.kind) {
    case "LetStatement":
      if (isSome(statement.initializer)) {
        collectUses(statement.initializer.value, out);
      }
      return;
    case "ExpressionStatement":
      collectUses(statement.expression, out);
      return;
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
  }
}

/**
 * Map each binding to whether it was declared with the `write` capability.
 *
 * @param statements The statements to analyze.
 * @returns A map from binding names to whether they were declared with the `write` capability.
 */
function writeCapabilities(
  statements: readonly Statement[],
): Map<string, boolean> {
  const capabilities = new Map<string, boolean>();
  for (const statement of statements) {
    if (statement.kind === "LetStatement") {
      capabilities.set(statement.pattern.name.text, statement.write);
    }
  }
  return capabilities;
}

/**
 * Collect borrows created by `let r = &[write] base;`.
 *
 * @param statements The statements to analyze.
 * @returns An array of borrows found in the statements.
 */
function collectBorrows(statements: readonly Statement[]): Borrow[] {
  const borrows: Borrow[] = [];
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined || statement.kind !== "LetStatement") {
      continue;
    }
    const { initializer } = statement;
    if (!isSome(initializer)) {
      continue;
    }
    const init = initializer.value;
    if (init.kind !== "ReferenceExpression") {
      continue;
    }
    const { operand } = init;
    if (operand.kind !== "PathExpression") {
      continue;
    }
    const { segments } = operand.path;
    const base = segments.length === 1 ? segments[0] : undefined;
    if (base === undefined) {
      continue;
    }
    borrows.push({
      name: statement.pattern.name.text,
      base,
      mutable: init.mutable,
      declIndex: index,
      tokenId: init.tokenId,
    });
  }
  return borrows;
}

/**
 * Last statement index at which each binding is used: its NLL end-of-life.
 *
 * @param statements The statements to analyze.
 * @returns A map from binding names to the last statement index at which they are used.
 */
function computeLastUse(statements: readonly Statement[]): Map<string, number> {
  const lastUse = new Map<string, number>();
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined) {
      continue;
    }
    const uses = new Set<string>();
    statementUses(statement, uses);
    for (const name of uses) {
      lastUse.set(name, index);
    }
  }
  return lastUse;
}

/**
 * Compute the end of a borrow's lifetime.
 *
 * @param borrow The borrow to analyze.
 * @param lastUse A map from binding names to the last statement index at which they are used.
 * @returns The index of the last statement at which the borrow is used.
 */
function borrowEnd(borrow: Borrow, lastUse: Map<string, number>): number {
  return lastUse.get(borrow.name) ?? borrow.declIndex;
}

/**
 * Determines whether two live ranges overlap based on their declaration indices
 * and the last use information.
 *
 * @param a The first borrow object, containing information about its live range.
 * @param b The second borrow object, containing information about its live range.
 * @param lastUse A map associating variable names with their last use index.
 * @returns Returns true if the live ranges of `a` and `b` overlap, otherwise false.
 */
function liveRangesOverlap(
  a: Borrow,
  b: Borrow,
  lastUse: Map<string, number>,
): boolean {
  return (
    a.declIndex <= borrowEnd(b, lastUse) && b.declIndex <= borrowEnd(a, lastUse)
  );
}

/**
 * Describe a borrow for diagnostic messages.
 *
 * @param borrow The borrow to describe.
 * @returns A string representation of the borrow.
 */
function describeBorrow(borrow: Borrow): string {
  return borrow.mutable ? "&write" : "&";
}

/**
 * Get the span of a token by its ID.
 *
 * @param tokens The array of tokens.
 * @param id The ID of the token.
 * @returns The span of the token, or `none` if the token is not found.
 */
function spanOf(tokens: readonly Token[], id: number): Option<Span> {
  const token = tokens[id];
  return token !== undefined ? some(token.span) : none();
}

function checkCapabilities(
  borrows: readonly Borrow[],
  capabilities: Map<string, boolean>,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  for (const borrow of borrows) {
    if (borrow.mutable && capabilities.get(borrow.base) === false) {
      diagnostics.push({
        severity: "error",
        message: `Cannot borrow "${borrow.base}" as &write because it is not declared write.`,
        span: spanOf(tokens, borrow.tokenId),
      });
    }
  }
}

function checkExclusivity(
  borrows: readonly Borrow[],
  lastUse: Map<string, number>,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  for (let i = 0; i < borrows.length; i += 1) {
    const a = borrows[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < borrows.length; j += 1) {
      const b = borrows[j];
      if (b === undefined || a.base !== b.base) {
        continue;
      }
      if (!a.mutable && !b.mutable) {
        continue; // any number of shared borrows may coexist
      }
      if (!liveRangesOverlap(a, b, lastUse)) {
        continue; // the borrows are not simultaneously live
      }
      diagnostics.push({
        severity: "error",
        message: `Conflicting borrows of "${a.base}": ${describeBorrow(a)} and ${describeBorrow(b)} are both live.`,
        span: spanOf(tokens, b.tokenId),
      });
    }
  }
}

function checkFunction(
  decl: FunctionDecl,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  const statements = decl.body.statements;
  checkCapabilities(
    collectBorrows(statements),
    writeCapabilities(statements),
    diagnostics,
    tokens,
  );
  checkExclusivity(
    collectBorrows(statements),
    computeLastUse(statements),
    diagnostics,
    tokens,
  );
}

function checkItem(
  item: Item,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  if (item.kind === "Function") {
    checkFunction(item, diagnostics, tokens);
  }
}

/**
 * Ownership analysis for slice 1: enforces `&write` capability and borrow
 * exclusivity (at most one `&write` xor any number of `&`) using last-use
 * liveness. Each function body is a single straight-line basic block; the
 * explicit multi-block CFG arrives with control flow (ADR 0002).
 *
 * @param program The parsed program.
 * @param tokens The array of tokens.
 *
 * @returns An array of diagnostics indicating any borrow-checking violations found in the program.
 */
export function checkBorrows(
  program: Program,
  tokens: readonly Token[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const item of program.items) {
    checkItem(item, diagnostics, tokens);
  }
  return diagnostics;
}
