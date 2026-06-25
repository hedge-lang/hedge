import { assertNever } from "../assert.js";
import { isSome, none, some } from "../option.js";
import type {
  AssignOperator,
  BinaryOperator,
  UnaryOperator,
  BlockStatement,
  DocComment,
  Expression,
  FunctionDecl,
  IfStatement,
  Item,
  LetStatement,
  Program,
  ReturnStatement,
  Statement,
} from "../jsim/ast.js";
import type { Code } from "./output.js";

const BINARY_OPS: Record<BinaryOperator, string> = {
  Add: "+",
  Sub: "-",
  Mul: "*",
  Div: "/",
  Rem: "%",
  Shl: "<<",
  Shr: ">>",
  BitAnd: "&",
  BitXor: "^",
  BitOr: "|",
  Eq: "===",
  Ne: "!==",
  Lt: "<",
  Gt: ">",
  Le: "<=",
  Ge: ">=",
  And: "&&",
  Or: "||",
};

const UNARY_OPS: Record<UnaryOperator, string> = {
  Neg: "-",
  Not: "!",
};

const ASSIGN_OPS: Record<AssignOperator, string> = {
  Assign: "=",
  AddAssign: "+=",
  SubAssign: "-=",
  MulAssign: "*=",
  DivAssign: "/=",
  RemAssign: "%=",
  BitAndAssign: "&=",
  BitOrAssign: "|=",
  BitXorAssign: "^=",
  ShlAssign: "<<=",
  ShrAssign: ">>=",
};

type PrecKey =
  | "BooleanLiteral"
  | "StringLiteral"
  | "NumberLiteral"
  | "PathExpression"
  | "CallExpression"
  | "UnaryExpression"
  | "AssignExpression"
  | "FieldAccessExpression"
  | "Identifier"
  | "MethodCallExpression"
  | "ArrowFunctionExpression"
  | "IndexExpression"
  | "TupleExpression"
  | "StructExpression"
  | BinaryOperator;

function precGroup(...keys: PrecKey[]): readonly PrecKey[] {
  return keys;
}

// Ascending precedence: earlier entries bind looser → more likely to need parens.
// Atoms (literals, identifiers, etc.) are absent; levelOf returns PREC_LEVELS.length,
// placing them above everything (they never need parens in any position).
const PREC_LEVELS: ReadonlyArray<readonly PrecKey[]> = [
  precGroup("ArrowFunctionExpression", "AssignExpression"),
  precGroup("Or"),
  precGroup("And"),
  precGroup("BitOr"),
  precGroup("BitXor"),
  precGroup("BitAnd"),
  precGroup("Eq", "Ne"),
  precGroup("Lt", "Gt", "Le", "Ge"),
  precGroup("Shl", "Shr"),
  precGroup("Add", "Sub"),
  precGroup("Mul", "Div", "Rem"),
  precGroup("UnaryExpression"),
  precGroup(
    "CallExpression",
    "MethodCallExpression",
    "FieldAccessExpression",
    "IndexExpression",
  ),
];

function levelOf(key: PrecKey): number {
  const idx = PREC_LEVELS.findIndex((group) => group.some((k) => k === key));
  return idx === -1 ? PREC_LEVELS.length : idx;
}

function precKey(expr: Expression): PrecKey {
  if (expr.kind === "BinaryExpression") return expr.operator;
  return expr.kind;
}

// Left operand of a left-assoc op: same level is fine (x + y + z → no parens on `x + y`)
function needsAtLeast(expr: Expression, levelKey: PrecKey): string {
  const s = emitExpression(expr);
  return levelOf(precKey(expr)) < levelOf(levelKey) ? `(${s})` : s;
}

// Right operand of a left-assoc op: same level must be parenthesised (x + (y + z))
function needsStrictlyAbove(expr: Expression, levelKey: PrecKey): string {
  const s = emitExpression(expr);
  return levelOf(precKey(expr)) <= levelOf(levelKey) ? `(${s})` : s;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line: string): string => (line === "" ? line : `  ${line}`))
    .join("\n");
}

function emitDocComment(doc: DocComment, isModule: boolean = false): string {
  const lines = doc.text.split("\n");
  const body = isModule
    ? ["@module", ...lines].map((l) => ` * ${l}`)
    : lines.map((l) => ` * ${l}`);
  return ["/**", ...body, " */"].join("\n");
}

// eslint-disable-next-line complexity -- This is a routing function
function emitExpression(expression: Expression): string {
  switch (expression.kind) {
    case "BooleanLiteral":
      return expression.value ? "true" : "false";
    case "StringLiteral":
      return JSON.stringify(expression.value);
    case "NumberLiteral":
      return expression.value;
    case "Identifier":
      return expression.value;
    case "PathExpression":
      return expression.path.join(".");
    case "CallExpression": {
      const args = expression.arguments.map(emitExpression).join(", ");
      // `(0, a.b)(c)` detaches `this` so the callee runs without an implicit
      // receiver, distinguishing it from MethodCallExpression in JS semantics.
      const k = expression.callee.kind;
      const callee =
        k === "FieldAccessExpression" || k === "IndexExpression"
          ? `(0, ${emitExpression(expression.callee)})`
          : needsAtLeast(expression.callee, "CallExpression");
      return `${callee}(${args})`;
    }
    case "BinaryExpression":
      return `${needsAtLeast(expression.left, expression.operator)} ${BINARY_OPS[expression.operator]} ${needsStrictlyAbove(expression.right, expression.operator)}`;
    case "UnaryExpression":
      return `(${UNARY_OPS[expression.operator]}${emitExpression(expression.operand)})`;
    case "AssignExpression":
      return `${emitExpression(expression.lhs)} ${ASSIGN_OPS[expression.operator]} ${emitExpression(expression.rhs)}`;
    case "FieldAccessExpression":
      return `${needsAtLeast(expression.object, "FieldAccessExpression")}.${expression.field}`;
    case "MethodCallExpression":
      return `${needsAtLeast(expression.receiver, "MethodCallExpression")}.${expression.method}(${expression.arguments.map(emitExpression).join(", ")})`;
    case "ArrowFunctionExpression": {
      const params = expression.params.join(", ");
      const lines = expression.body
        .map(emitStatement)
        .filter((s) => s.length > 0);
      const body =
        lines.length === 0 ? "{}" : `{\n${lines.map(indent).join("\n")}\n}`;
      return `(${params}) => ${body}`;
    }
    case "IndexExpression":
      return `${needsAtLeast(expression.object, "IndexExpression")}[${emitExpression(expression.index)}]`;
    case "TupleExpression":
      return `[${expression.elements.map(emitExpression).join(", ")}]`;
    case "StructExpression": {
      const fields = expression.fields.map((f) =>
        f.kind === "SpreadExpression"
          ? `...${emitExpression(f.expression)}`
          : isSome(f.value)
            ? `${f.name}: ${emitExpression(f.value.value)}`
            : f.name,
      );
      return `({${fields.join(", ")}})`;
    }
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

function branchHasReturn(stmts: readonly Statement[]): boolean {
  return stmts.some((s) => s.kind === "ReturnStatement");
}

function emitBranchBlock(
  stmts: readonly Statement[],
  multiline: boolean,
): string {
  const lines = stmts.map(emitStatement).filter((s) => s.length > 0);
  if (lines.length === 0) return "{}";
  if (multiline) return `{\n${lines.map(indent).join("\n")}\n}`;
  return `{ ${lines.join(" ")} }`;
}

function emitIfStatement(stmt: IfStatement): string {
  const cond = emitExpression(stmt.condition);
  const multiline =
    branchHasReturn(stmt.then) ||
    (isSome(stmt.else) && branchHasReturn(stmt.else.value));
  const thenStr = emitBranchBlock(stmt.then, multiline);
  if (!isSome(stmt.else)) return `if (${cond}) ${thenStr}`;
  const elseStmts = stmt.else.value;
  if (elseStmts.length === 1 && elseStmts[0]?.kind === "IfStatement") {
    return `if (${cond}) ${thenStr} else ${emitIfStatement(elseStmts[0])}`;
  }
  return `if (${cond}) ${thenStr} else ${emitBranchBlock(elseStmts, multiline)}`;
}

function emitBlockStatement(stmt: BlockStatement): string {
  const lines = stmt.body.map(emitStatement).filter((s) => s.length > 0);
  if (lines.length === 0) return "";
  if (lines.length === 1) return `{ ${lines[0]} }`;
  return `{\n${lines.map(indent).join("\n")}\n}`;
}

function emitReturn(stmt: ReturnStatement): string {
  return isSome(stmt.value)
    ? `return ${emitExpression(stmt.value.value)};`
    : `return;`;
}

function emitLet(statement: LetStatement): string {
  if (!statement.mutable && !isSome(statement.value)) return "";
  const keyword = statement.mutable ? "let" : "const";
  const value = statement.value;
  return isSome(value)
    ? `${keyword} ${statement.name} = ${emitExpression(value.value)};`
    : `let ${statement.name};`;
}

function emitStatement(statement: Statement): string {
  switch (statement.kind) {
    case "LetStatement":
      return emitLet(statement);
    case "BlockStatement":
      return emitBlockStatement(statement);
    case "IfStatement":
      return emitIfStatement(statement);
    case "ReturnStatement":
      return emitReturn(statement);
    default:
      return `${emitExpression(statement)};`;
  }
}

function emitFunction(decl: FunctionDecl): string {
  const bodyLines = decl.body.map(emitStatement).filter((s) => s.length > 0);
  const bodyStr =
    bodyLines.length === 0 ? "{}" : `{\n${bodyLines.map(indent).join("\n")}\n}`;
  const keyword = isSome(decl.scope) ? "export function" : "function";
  const params = decl.params.map((p) => p.name).join(", ");
  return `${keyword} ${decl.name}(${params}) ${bodyStr}`;
}

function emitItem(item: Item): string {
  switch (item.kind) {
    case "FunctionDecl":
      return emitFunction(item);
    case "LetStatement":
      return emitLet(item);
    case "BlockStatement":
      return emitBlockStatement(item);
    case "IfStatement":
      return emitIfStatement(item);
    case "ReturnStatement":
      return emitReturn(item);
    default:
      return `${emitExpression(item)};`;
  }
}

function emitDtsFunction(
  decl: FunctionDecl,
  scope: "public" | "package",
): string {
  const params = decl.params
    .map((p) => `${p.name}: ${p.type.value}`)
    .join(", ");
  const returnType = isSome(decl.returnType)
    ? decl.returnType.value.value
    : "void";
  const declaration = `export declare function ${decl.name}(${params}): ${returnType};`;
  const parts: string[] = [];
  if (scope === "package") {
    const text = isSome(decl.docComment)
      ? `@internal\n${decl.docComment.value.text}`
      : "@internal";
    parts.push(emitDocComment({ kind: "DocComment", text }));
  } else if (isSome(decl.docComment)) {
    parts.push(emitDocComment(decl.docComment.value));
  }
  parts.push(declaration);
  return parts.join("\n");
}

function emitDtsItem(item: Item): string | null {
  if (item.kind !== "FunctionDecl" || !isSome(item.scope)) {
    return null;
  }
  return emitDtsFunction(item, item.scope.value);
}

function hasMain(program: Program): boolean {
  return program.items.some(
    (item: Item): boolean =>
      item.kind === "FunctionDecl" && item.name === "main",
  );
}

/**
 * Generate JavaScript and a TypeScript declaration from a JSIM program.
 * Slice-1 subset: a `fn main` is invoked as the entry point, and the `.d.ts`
 * is empty until `export "js"` items exist (slice 9).
 */
export function generate(program: Program): Code {
  const parts: string[] = [];

  for (const item of program.items) {
    const emitted = emitItem(item);
    if (emitted.length > 0) parts.push(emitted);
  }

  if (hasMain(program)) {
    parts.unshift("#!/usr/bin/env node");
    parts.push("main();");
  }

  const dtsParts: string[] = [];
  if (isSome(program.docComment)) {
    dtsParts.push(emitDocComment(program.docComment.value, true));
  }
  for (const item of program.items) {
    const dts = emitDtsItem(item);
    if (dts !== null) {
      dtsParts.push(dts);
    }
  }

  return {
    javascript: parts.length ? some(`${parts.join("\n\n")}\n`) : none(),
    typedef: dtsParts.length ? some(`${dtsParts.join("\n\n")}\n`) : none(),
  };
}
