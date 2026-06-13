import type {
  Block,
  Expression,
  FunctionDecl,
  Item,
  LetStatement,
  Program,
  Statement,
} from "../parser/ast.js";
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

function emitExpression(expression: Expression): string {
  switch (expression.kind) {
    case "StringLiteral":
      return JSON.stringify(expression.value);
    case "IntLiteral":
      return expression.text;
    case "PathExpression":
      return expression.path.segments.join(".");
    case "CallExpression": {
      const args = expression.arguments.map(emitExpression).join(", ");
      return `${emitExpression(expression.callee)}(${args})`;
    }
    case "ReferenceExpression":
      // References are not exercised by the tracer; emit the operand for now.
      return emitExpression(expression.operand);
    default:
      return assertNever(expression);
  }
}

function emitLet(statement: LetStatement): string {
  // Read-only `let` lowers to `const`; `let write`/`let bind` to `let`.
  const keyword = statement.bind || statement.write ? "let" : "const";
  const name = statement.pattern.name.text;
  if (statement.initializer === null) {
    return `${keyword} ${name};`;
  }
  return `${keyword} ${name} = ${emitExpression(statement.initializer)};`;
}

function emitStatement(statement: Statement): string {
  switch (statement.kind) {
    case "LetStatement":
      return emitLet(statement);
    case "ExpressionStatement":
      return `${emitExpression(statement.expression)};`;
    default:
      return assertNever(statement);
  }
}

function emitBlock(block: Block): string {
  const lines = block.statements.map(emitStatement);
  if (block.trailingExpression !== null) {
    lines.push(`${emitExpression(block.trailingExpression)};`);
  }
  if (lines.length === 0) {
    return "{}";
  }
  return `{\n${lines.map(indent).join("\n")}\n}`;
}

function emitFunction(decl: FunctionDecl): string {
  return `function ${decl.name.text}() ${emitBlock(decl.body)}`;
}

function emitItem(item: Item): string {
  switch (item.kind) {
    case "Function":
      return emitFunction(item);
    case "LetStatement":
    case "ExpressionStatement":
      return emitStatement(item);
    default:
      return `${emitExpression(item)};`;
  }
}

function hasMain(program: Program): boolean {
  return program.items.some(
    (item: Item): boolean =>
      item.kind === "Function" && item.name.text === "main",
  );
}

/**
 * Generate JavaScript and a TypeScript declaration from a parsed program.
 * Slice-1 subset: a `fn main` is invoked as the entry point, and the `.d.ts` is
 * empty until `export "js"` items exist (slice 9). The explicit JS-AST +
 * source-map printer (ADR 0007) is the next codegen increment.
 */
export function generate(program: Program): Code {
  const parts = program.items.map(emitItem);
  if (hasMain(program)) {
    parts.push("main();");
  }
  return { javascript: parts.join("\n\n"), typedef: "" };
}
