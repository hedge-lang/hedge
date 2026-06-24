import { assertNever } from "../assert.js";
import { isSome, none, some } from "../option.js";
import type {
  AssignOperator,
  BinaryOperator,
  UnaryOperator,
  DocComment,
  Expression,
  FunctionDecl,
  Item,
  LetStatement,
  Program,
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
      return `${emitExpression(expression.callee)}(${args})`;
    }
    case "BinaryExpression":
      return `(${emitExpression(expression.left)} ${BINARY_OPS[expression.operator]} ${emitExpression(expression.right)})`;
    case "UnaryExpression":
      return `${UNARY_OPS[expression.operator]}${emitExpression(expression.operand)}`;
    case "AssignExpression":
      return `${emitExpression(expression.lhs)} ${ASSIGN_OPS[expression.operator]} ${emitExpression(expression.rhs)}`;
    case "FieldAccessExpression":
      return `${emitExpression(expression.object)}.${expression.field}`;
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
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
    case "BooleanLiteral":
    case "StringLiteral":
    case "NumberLiteral":
    case "Identifier":
    case "PathExpression":
    case "CallExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "AssignExpression":
    case "FieldAccessExpression":
      return `${emitExpression(statement)};`;
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
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

/**
 * Emits the appropriate string representation for a given item based on its kind.
 *
 * @param item The item to be emitted, containing a kind property that determines how it is processed.
 * @return A string representation of the given item based on its kind.
 */
// eslint-disable-next-line complexity -- This is a routing function
function emitItem(item: Item): string {
  switch (item.kind) {
    case "FunctionDecl":
      return emitFunction(item);
    case "LetStatement":
      return emitLet(item);
    case "BooleanLiteral":
    case "StringLiteral":
    case "NumberLiteral":
    case "Identifier":
    case "PathExpression":
    case "CallExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "AssignExpression":
    case "FieldAccessExpression":
      return `${emitExpression(item)};`;
    default:
      assertNever(item, `Unexpected AST node: ${JSON.stringify(item)}`);
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
