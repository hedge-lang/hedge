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
  readonly name: string; // the borrowing binding
  readonly base: string; // the borrowed variable
  readonly mutable: boolean;
  readonly declIndex: number; // statement index where the borrow is created
  readonly tokenId: number; // the reference token, for diagnostics
}

function assertNever(value: never): never {
  throw new Error(`Unexpected AST node: ${JSON.stringify(value)}`);
}

/** Collect the names of single-segment paths referenced in an expression. */
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
    case "StringLiteral":
    case "IntLiteral":
      return;
    default:
      assertNever(expression);
  }
}

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
      assertNever(statement);
  }
}

/** Map each binding to whether it was declared with the `write` capability. */
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

/** Collect borrows created by `let r = &[write] base;`. */
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

/** Last statement index at which each binding is used: its NLL end-of-life. */
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

function borrowEnd(borrow: Borrow, lastUse: Map<string, number>): number {
  return lastUse.get(borrow.name) ?? borrow.declIndex;
}

function liveRangesOverlap(
  a: Borrow,
  b: Borrow,
  lastUse: Map<string, number>,
): boolean {
  return (
    a.declIndex <= borrowEnd(b, lastUse) && b.declIndex <= borrowEnd(a, lastUse)
  );
}

function describeBorrow(borrow: Borrow): string {
  return borrow.mutable ? "&write" : "&";
}

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
