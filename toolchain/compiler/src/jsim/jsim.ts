import { isSome, none, some } from "../option.js";
import type * as Parser from "../parser/ast.js";
import type * as JSIM from "./ast.js";
import { toDocComment } from "./parts/doc-comment.js";

export function toJsim(program: Parser.Program): JSIM.Program {
  return {
    kind: "Program",
    docComment: toDocComment(program.attributes),
    items: program.items.map(parseItem),
  };
}

function parseItem(item: Parser.Item): JSIM.Item {
  if (item.kind === "Function") {
    return parseFunction(item);
  }

  if (item.kind === "LetStatement" || item.kind === "ExpressionStatement") {
    return parseStatement(item);
  }

  return parseExpression(item);
}

function parseFunction(fn: Parser.FunctionDecl): JSIM.FunctionDecl {
  const innerDoc = toDocComment(fn.body.innerAttributes);
  const outerDoc = toDocComment(fn.attributes);
  const docComment = isSome(innerDoc) ? innerDoc : outerDoc;

  const statements: JSIM.Statement[] = fn.body.statements.map(parseStatement);
  if (isSome(fn.body.trailingExpression)) {
    statements.push(parseExpression(fn.body.trailingExpression.value));
  }

  const scope: JSIM.FunctionDecl["scope"] = isSome(fn.visibility)
    ? some(
        isSome(fn.visibility.value.scope) &&
          fn.visibility.value.scope.value === "package"
          ? "package"
          : "public",
      )
    : none();

  return {
    kind: "FunctionDecl",
    scope,
    name: fn.name.text,
    params: [],
    returnType: none(),
    body: statements,
    docComment,
  };
}

function parseStatement(statement: Parser.Statement): JSIM.Statement {
  switch (statement.kind) {
    case "LetStatement":
      return {
        kind: "LetStatement",
        name: statement.pattern.name.text,
        mutable: statement.bind || statement.write,
        value: isSome(statement.initializer)
          ? some(parseExpression(statement.initializer.value))
          : none(),
        docComment: toDocComment(statement.attributes),
      };
    case "ExpressionStatement":
      return parseExpression(statement.expression);
  }
}

function parseExpression(expression: Parser.Expression): JSIM.Expression {
  switch (expression.kind) {
    case "StringLiteral":
      return { kind: "StringLiteral", value: expression.value };
    case "IntLiteral":
      // IntLiteral carries the numeric string (underscores stripped); pass through directly.
      return { kind: "NumberLiteral", value: expression.value };
    case "PathExpression":
      return { kind: "PathExpression", path: expression.path.segments };
    case "CallExpression":
      return {
        kind: "CallExpression",
        callee: parseExpression(expression.callee),
        arguments: expression.arguments.map(parseExpression),
      };
    case "ReferenceExpression":
      // References are transparent in JS — emit the operand directly.
      return parseExpression(expression.operand);
  }
}
