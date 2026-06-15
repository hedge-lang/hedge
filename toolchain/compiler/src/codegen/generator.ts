import { isSome } from "../option.js";
import type {
  DocComment,
  Expression,
  FunctionDecl,
  Item,
  LetStatement,
  Program,
  Statement,
} from "../jsim/ast.js";
import type { Code } from "./output.js";

function assertNever(value: never): never {
  throw new Error(`Unexpected AST node: ${JSON.stringify(value)}`);
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

function emitExpression(expression: Expression): string {
  switch (expression.kind) {
    case "StringLiteral":
      return JSON.stringify(expression.value);
    case "NumberLiteral":
      return String(expression.value);
    case "PathExpression":
      return expression.path.join(".");
    case "CallExpression": {
      const args = expression.arguments.map(emitExpression).join(", ");
      return `${emitExpression(expression.callee)}(${args})`;
    }
    default:
      return assertNever(expression);
  }
}

function emitLet(statement: LetStatement): string {
  const keyword = statement.mutable ? "let" : "const";
  const value = statement.value;
  if (isSome(value)) {
    return `${keyword} ${statement.name} = ${emitExpression(value.value)};`;
  }
  return `${keyword} ${statement.name};`;
}

function emitStatement(statement: Statement): string {
  switch (statement.kind) {
    case "LetStatement":
      return emitLet(statement);
    case "StringLiteral":
    case "NumberLiteral":
    case "PathExpression":
    case "CallExpression":
      return `${emitExpression(statement)};`;
    default:
      return assertNever(statement);
  }
}

function emitFunction(decl: FunctionDecl): string {
  const bodyLines = decl.body.map(emitStatement);
  const hasDoc = isSome(decl.docComment);
  // Documented functions use explicit braces on separate lines for readability.
  const bodyStr =
    bodyLines.length === 0 && !hasDoc
      ? "{}"
      : bodyLines.length === 0
        ? "{\n}"
        : `{\n${bodyLines.map(indent).join("\n")}\n}`;
  const fn = `function ${decl.name}() ${bodyStr}`;
  if (hasDoc) {
    return `${emitDocComment(decl.docComment.value)}\n${fn}`;
  }
  return fn;
}

function emitItem(item: Item): string {
  switch (item.kind) {
    case "FunctionDecl":
      return emitFunction(item);
    case "Export":
      return emitFunction(item.target);
    case "LetStatement":
      return emitLet(item);
    case "StringLiteral":
    case "NumberLiteral":
    case "PathExpression":
    case "CallExpression":
      return `${emitExpression(item)};`;
    default:
      return assertNever(item);
  }
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

  if (isSome(program.docComment)) {
    parts.push(emitDocComment(program.docComment.value, true));
  }

  for (const item of program.items) {
    parts.push(emitItem(item));
  }

  if (hasMain(program)) {
    parts.unshift("#!/usr/bin/env node");
    parts.push("main();");
  }

  return { javascript: parts.join("\n\n"), typedef: "" };
}
