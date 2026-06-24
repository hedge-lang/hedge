import { isSome, none, type Option, some } from "../option.js";
import { type BinaryExpression, type IntLiteral } from "../parser/ast.js";
import { HEDGE_PRIMITIVE_TYPES } from "../primitives.js";
import type * as Parser from "../parser/ast.js";
import { type FunctionParam } from "./ast.js";
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
    const value = HEDGE_PRIMITIVE_TYPES.get(segment);
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
    params: fn.params.flatMap((p): FunctionParam[] => {
      const type: Option<PrimitiveType> =
        p.type.kind === "UnitType"
          ? some({ kind: "PrimitiveType", value: "null" })
          : parsePrimitiveType(p.type);
      return isSome(type)
        ? [
            {
              kind: "FunctionParam",
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
// eslint-disable-next-line complexity -- This is a routing function
function parseExpression(expression: Parser.Expression): JSIM.Expression {
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
        if (value === undefined) {
          throw new Error("Unexpected undefined segment");
        }
        return { kind: "Identifier", value };
      }
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
    case "BinaryExpression":
      return parseBinaryExpression(expression);
    case "UnaryExpression":
      return parseUnaryExpression(expression);
    case "AssignExpression":
      return parseAssignExpression(expression);
    case "CompoundAssignExpression":
      return parseCompoundAssignExpression(expression);
    case "FieldAccessExpression":
      return parseFieldAccessExpression(expression);
    case "Identifier":
      return parseIdentifier(expression);
    default:
      const _exhaustive: never = expression;
      throw new Error(
        `JSIM codegen for "${JSON.stringify(_exhaustive)}" is not yet implemented`,
      );
  }
}

function jsimIntLiteral({ base, value }: IntLiteral): JSIM.Expression {
  const basePrefix =
    base === 2 ? "0b" : base === 8 ? "0o" : base === 16 ? "0x" : "";
  return {
    kind: "NumberLiteral",
    value: String(BigInt(basePrefix + value)),
  };
}

function parseBinaryExpression(binExp: BinaryExpression): JSIM.Expression {
  return {
    kind: binExp.kind,
    operator: binExp.operator,
    left: parseExpression(binExp.left),
    right: parseExpression(binExp.right),
  };
}

function parseUnaryExpression(
  unaryExp: Parser.UnaryExpression,
): JSIM.Expression {
  return {
    kind: unaryExp.kind,
    operator: unaryExp.operator,
    operand: parseExpression(unaryExp.operand),
  };
}

function parseAssignExpression(
  assignExp: Parser.AssignExpression,
): JSIM.Expression {
  return {
    kind: "AssignExpression",
    operator: "Assign",
    lhs: parseExpression(assignExp.lhs),
    rhs: parseExpression(assignExp.rhs),
  };
}

function parseCompoundAssignExpression(
  compoundAssignExp: Parser.CompoundAssignExpression,
): JSIM.Expression {
  return {
    kind: "AssignExpression",
    operator: compoundAssignExp.operator,
    lhs: parseExpression(compoundAssignExp.lhs),
    rhs: parseExpression(compoundAssignExp.rhs),
  };
}

function parseFieldAccessExpression(
  fieldAccessExp: Parser.FieldAccessExpression,
): JSIM.Expression {
  return {
    kind: "FieldAccessExpression",
    object: parseExpression(fieldAccessExp.object),
    field: fieldAccessExp.field.text,
  };
}

function parseIdentifier(identifier: Parser.Identifier): JSIM.Expression {
  return {
    kind: "Identifier",
    value: identifier.text,
  };
}
