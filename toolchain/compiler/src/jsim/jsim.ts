import { isSome, none, type Option, some } from "../option.js";
import { HEDGE_PRIMITIVE_TYPES } from "../primitives.js";
import type * as Parser from "../parser/ast.js";
import type * as JSIM from "./ast.js";
import { toDocComment } from "./parts/doc-comment.js";

export function toJsim(program: Parser.Program): JSIM.Program {
  return {
    kind: "Program",
    docComment: toDocComment(program.attributes),
    items: program.items.flatMap((item): JSIM.Item | JSIM.Item[] => {
      return parseItem(item);
    }),
  };
}

interface PrimitiveType {
  kind: "PrimitiveType";
  value: "string" | "number" | "bigint" | "boolean" | "null";
}

function parsePrimitiveType(type: Parser.Type): Option<PrimitiveType> {
  if (type.kind === "NamedType" && type.path.segments.length === 1) {
    const segment = type.path.segments[0];
    if (segment === undefined) {
      return none();
    }
    const value = HEDGE_PRIMITIVE_TYPES[segment];
    if (value !== undefined) return some({ kind: "PrimitiveType", value });
  }
  return none();
}

function parseItem(item: Parser.Item): JSIM.Item | JSIM.Item[] {
  if (item.kind === "Function") {
    return parseFunction(item);
  }

  if (item.kind === "LetStatement" || item.kind === "ExpressionStatement") {
    return parseStatement(item);
  }

  if (item.kind === "Struct") {
    return parseStruct(item);
  }

  return parseExpression(item);
}

function parseStruct(struct: Parser.StructDecl): JSIM.Item[] {
  void struct;
  // TODO: Implement how structs are represented in JS (interface for .d.ts)
  return [];
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
    params: fn.params.flatMap((p) => {
      const type =
        p.type.kind === "UnitType"
          ? some({ kind: "PrimitiveType" as const, value: "null" as const })
          : parsePrimitiveType(p.type);
      return isSome(type)
        ? [
            {
              kind: "FunctionParam" as const,
              name: p.pattern.name.text,
              type: type.value,
            },
          ]
        : [];
    }),
    returnType: isSome(fn.returnType)
      ? parsePrimitiveType(fn.returnType.value)
      : none(),
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

/**
 * Parse an expression into a JSIM AST.
 *
 * @param expression The expression to parse.
 *
 * @returns The parsed expression.
 */
function parseExpression(expression: Parser.Expression): JSIM.Expression {
  switch (expression.kind) {
    case "StringLiteral":
      return { kind: "StringLiteral", value: expression.value };
    case "IntLiteral": {
      const basePrefix =
        expression.base === 2
          ? "0b"
          : expression.base === 8
            ? "0o"
            : expression.base === 16
              ? "0x"
              : "";
      return {
        kind: "NumberLiteral",
        value: String(BigInt(basePrefix + expression.value)),
      };
    }
    case "FloatLiteral":
      return { kind: "NumberLiteral", value: expression.value };
    case "BoolLiteral":
      return { kind: "BooleanLiteral", value: expression.value };
    case "CharLiteral":
      return { kind: "StringLiteral", value: expression.value };
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
