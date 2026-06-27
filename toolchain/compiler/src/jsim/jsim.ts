import { isSome, mapSome, none, type Option, some } from "../option.js";
import type * as Semantics from "../semantics/ast.js";
import type * as JSIM from "./ast.js";
import { toDocComment } from "./parts/doc-comment.js";
import { assert, assertNever } from "../assert.js";

export function toJsim(program: Semantics.Program): JSIM.Program {
  return {
    kind: "Program",
    docComment: toDocComment(program.attributes),
    items: program.items.flatMap((item): JSIM.Item | JSIM.Item[] => {
      return parseItem(item);
    }),
  };
}

interface JsPrimitiveType {
  kind: "PrimitiveType";
  value: "string" | "number" | "bigint" | "boolean" | "null";
}

// eslint-disable-next-line complexity -- Routing function
function semanticTypeToJsPrimitive(
  type: Semantics.Type,
): Option<JsPrimitiveType> {
  switch (type.kind) {
    case "PrimitiveStringType":
    case "PrimitiveCharType":
      return some({ kind: "PrimitiveType", value: "string" });
    case "PrimitiveBooleanType":
      return some({ kind: "PrimitiveType", value: "boolean" });
    case "PrimitiveI64Type":
    case "PrimitiveU64Type":
      return some({ kind: "PrimitiveType", value: "bigint" });
    case "PrimitiveI8Type":
    case "PrimitiveI16Type":
    case "PrimitiveI32Type":
    case "PrimitiveIsizeType":
    case "PrimitiveU8Type":
    case "PrimitiveU16Type":
    case "PrimitiveU32Type":
    case "PrimitiveUsizeType":
    case "PrimitiveF32Type":
    case "PrimitiveF64Type":
      return some({ kind: "PrimitiveType", value: "number" });
    case "UnitType":
      return some({ kind: "PrimitiveType", value: "null" });
    default:
      return none();
  }
}

const ARITHMETIC_OPS = new Set<JSIM.BinaryOperator>([
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Rem",
  "Shl",
  "Shr",
  "BitAnd",
  "BitXor",
  "BitOr",
]);

// eslint-disable-next-line complexity -- Routing function
function hedgeTypeToNumericKind(
  type: Semantics.Type,
): Option<JSIM.NumericKind> {
  switch (type.kind) {
    case "PrimitiveI8Type":
      return some({ kind: "signed", bits: 8 });
    case "PrimitiveI16Type":
      return some({ kind: "signed", bits: 16 });
    case "PrimitiveI32Type":
      return some({ kind: "signed", bits: 32 });
    case "PrimitiveIsizeType":
      return some({ kind: "signed", bits: 32 });
    case "PrimitiveU8Type":
      return some({ kind: "unsigned", bits: 8 });
    case "PrimitiveU16Type":
      return some({ kind: "unsigned", bits: 16 });
    case "PrimitiveU32Type":
      return some({ kind: "unsigned", bits: 32 });
    case "PrimitiveUsizeType":
      return some({ kind: "unsigned", bits: 32 });
    case "PrimitiveI64Type":
      return some({ kind: "bigint", signed: true });
    case "PrimitiveU64Type":
      return some({ kind: "bigint", signed: false });
    case "PrimitiveF32Type":
      return some({ kind: "float", bits: 32 });
    case "PrimitiveF64Type":
      return some({ kind: "float", bits: 64 });
    default:
      return none();
  }
}

function parseItem(item: Semantics.Item): JSIM.Item | JSIM.Item[] {
  if (item.kind === "Function") return parseFunction(item);
  if (item.kind === "LetStatement" || item.kind === "ExpressionStatement")
    return parseStatement(item);
  if (item.kind === "Struct") return parseStruct(item);
  return parseExpression(item);
}

function parseStruct(struct: Semantics.StructDecl): JSIM.Item[] {
  void struct;
  // TODO: Implement how structs are represented in JS (interface for .d.ts)
  return [];
}

function parseFunction(fn: Semantics.FunctionDecl): JSIM.FunctionDecl {
  const innerDoc = toDocComment(fn.body.innerAttributes);
  const outerDoc = toDocComment(fn.attributes);
  const docComment = isSome(innerDoc) ? innerDoc : outerDoc;

  const statements: JSIM.Statement[] = fn.body.statements.map(parseStatement);
  if (isSome(fn.body.trailingExpression)) {
    statements.push(parseExpression(fn.body.trailingExpression.value));
  }

  const scope: JSIM.FunctionDecl["scope"] = mapSome(
    fn.visibility,
    (visibility) =>
      isSome(visibility.scope) && visibility.scope.value === "package"
        ? "package"
        : "public",
  );

  return {
    kind: "FunctionDecl",
    scope,
    name: fn.name.text,
    params: fn.params.flatMap((p): JSIM.FunctionParam[] => {
      const type: Option<JsPrimitiveType> = semanticTypeToJsPrimitive(p.type);
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
    returnType:
      isSome(fn.returnType) && fn.returnType.value.kind !== "UnitType"
        ? semanticTypeToJsPrimitive(fn.returnType.value)
        : none(),
    body: statements,
    docComment,
  };
}

function parseStatement(statement: Semantics.Statement): JSIM.Statement {
  switch (statement.kind) {
    case "LetStatement":
      return {
        kind: "LetStatement",
        name: statement.pattern.name.text,
        mutable: statement.bind || statement.write,
        value: mapSome(statement.initializer, parseExpression),
        docComment: toDocComment(statement.attributes),
      };
    case "ExpressionStatement":
      if (statement.expression.kind === "Block") {
        return jsimBlockStatement(statement.expression);
      }
      if (statement.expression.kind === "IfExpression") {
        return jsimIfExpressionAsStatement(statement.expression);
      }
      return parseExpression(statement.expression);
  }
}

function jsimBranchHasResult(
  branch: Semantics.Block | Semantics.IfExpression,
): boolean {
  if (branch.kind === "IfExpression") {
    return (
      jsimBranchHasResult(branch.thenBranch) ||
      (isSome(branch.elseBranch) &&
        jsimBranchHasResult(branch.elseBranch.value))
    );
  }
  return isSome(branch.trailingExpression);
}

function jsimBlockStatement(block: Semantics.Block): JSIM.Statement {
  if (isSome(block.trailingExpression)) return jsimBlockExpression(block);
  return {
    kind: "BlockStatement",
    body: block.statements.map(parseStatement),
  };
}

function jsimIfExpressionAsStatement(
  ifExpr: Semantics.IfExpression,
): JSIM.Statement {
  const hasResult =
    jsimBranchHasResult(ifExpr.thenBranch) ||
    (isSome(ifExpr.elseBranch) && jsimBranchHasResult(ifExpr.elseBranch.value));
  if (hasResult) return jsimIfExpression(ifExpr);
  return jsimIfStatement(ifExpr);
}

/**
 * Parse an expression into a JSIM AST.
 *
 * @param expression The expression to parse.
 *
 * @returns The parsed expression.
 */
// eslint-disable-next-line complexity -- This is a routing function
function parseExpression(expression: Semantics.Expression): JSIM.Expression {
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
        assert(value !== undefined, "Unexpected undefined segment");
        return { kind: "Identifier", value, type: none() };
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
    case "MethodCallExpression":
      return jsimMethodCallExpression(expression);
    case "IndexExpression":
      return jsimIndexExpression(expression);
    case "TupleExpression":
      return jsimTupleExpression(expression);
    case "StructExpression":
      return jsimStructExpression(expression);
    case "IfExpression":
      return jsimIfExpression(expression);
    case "Block":
      return jsimBlockExpression(expression);

    default:
      assertNever(
        expression,
        `JSIM codegen for "${JSON.stringify(expression)}" is not yet implemented`,
      );
  }
}

function jsimMethodCallExpression(
  methodCallExpression: Semantics.MethodCallExpression,
): JSIM.Expression {
  return {
    kind: "MethodCallExpression",
    receiver: parseExpression(methodCallExpression.receiver),
    method: methodCallExpression.method.text,
    arguments: methodCallExpression.arguments.map(parseExpression),
  };
}

function jsimBlockExpression(block: Semantics.Block): JSIM.Expression {
  return {
    kind: "CallExpression",
    callee: {
      kind: "ArrowFunctionExpression",
      params: [],
      body: jsimBranchBody(block),
    },
    arguments: [],
  };
}

function jsimBranchBody(block: Semantics.Block): JSIM.Statement[] {
  const stmts: JSIM.Statement[] = block.statements.map(parseStatement);
  if (isSome(block.trailingExpression)) {
    stmts.push({
      kind: "ReturnStatement",
      value: some(parseExpression(block.trailingExpression.value)),
    });
  }
  return stmts;
}

function jsimBranchElse(
  branch: Semantics.IfExpression | Semantics.Block,
): JSIM.Statement[] {
  if (branch.kind === "IfExpression") return [jsimIfStatement(branch)];
  return jsimBranchBody(branch);
}

function jsimIfStatement(ifExpr: Semantics.IfExpression): JSIM.IfStatement {
  return {
    kind: "IfStatement",
    condition: parseExpression(ifExpr.condition),
    then: jsimBranchBody(ifExpr.thenBranch),
    else: mapSome(ifExpr.elseBranch, jsimBranchElse),
  };
}

function jsimIndexExpression(
  indexExpression: Semantics.IndexExpression,
): JSIM.Expression {
  return {
    kind: "IndexExpression",
    object: parseExpression(indexExpression.object),
    index: parseExpression(indexExpression.index),
  };
}

function jsimTupleExpression(
  tupleExpression: Semantics.TupleExpression,
): JSIM.Expression {
  return {
    kind: "TupleExpression",
    elements: tupleExpression.elements.map(parseExpression),
  };
}

function jsimStructExpression({
  base,
  fields,
}: Semantics.StructExpression): JSIM.Expression {
  return {
    kind: "StructExpression",
    fields: [
      ...[base]
        .filter(isSome)
        .map((b) => parseExpression(b.value))
        .map(makeSpread),
      ...fields.map(makeStructField),
    ],
  };
}

function makeStructField(field: Semantics.FieldInit): JSIM.StructField {
  return {
    kind: "StructField",
    name: field.name.text,
    value: mapSome(field.value, parseExpression),
  };
}

function makeSpread(expression: JSIM.Expression): JSIM.SpreadExpression {
  return { kind: "SpreadExpression", expression };
}

function jsimIfExpression(
  ifExpression: Semantics.IfExpression,
): JSIM.Expression {
  return {
    kind: "CallExpression",
    callee: {
      kind: "ArrowFunctionExpression",
      params: [],
      body: [jsimIfStatement(ifExpression)],
    },
    arguments: [],
  };
}

function jsimIntLiteral({
  base,
  value,
}: Semantics.IntLiteral): JSIM.Expression {
  const basePrefix =
    base === 2 ? "0b" : base === 8 ? "0o" : base === 16 ? "0x" : "";
  return {
    kind: "NumberLiteral",
    value: String(BigInt(basePrefix + value)),
  };
}

function parseBinaryExpression(
  binExp: Semantics.BinaryExpression,
): JSIM.Expression {
  const numericKind: Option<JSIM.NumericKind> = ARITHMETIC_OPS.has(
    binExp.operator,
  )
    ? hedgeTypeToNumericKind(binExp.type)
    : none();
  return {
    kind: binExp.kind,
    operator: binExp.operator,
    left: parseExpression(binExp.left),
    right: parseExpression(binExp.right),
    numericKind,
  };
}

function parseUnaryExpression(
  unaryExp: Semantics.UnaryExpression,
): JSIM.Expression {
  return {
    kind: unaryExp.kind,
    operator: unaryExp.operator,
    operand: parseExpression(unaryExp.operand),
  };
}

function parseAssignExpression(
  assignExp: Semantics.AssignExpression,
): JSIM.Expression {
  return {
    kind: "AssignExpression",
    operator: "Assign",
    lhs: parseExpression(assignExp.lhs),
    rhs: parseExpression(assignExp.rhs),
  };
}

function parseCompoundAssignExpression(
  compoundAssignExp: Semantics.CompoundAssignExpression,
): JSIM.Expression {
  return {
    kind: "AssignExpression",
    operator: compoundAssignExp.operator,
    lhs: parseExpression(compoundAssignExp.lhs),
    rhs: parseExpression(compoundAssignExp.rhs),
  };
}

function parseFieldAccessExpression(
  fieldAccessExp: Semantics.FieldAccessExpression,
): JSIM.Expression {
  return {
    kind: "FieldAccessExpression",
    object: parseExpression(fieldAccessExp.object),
    field: fieldAccessExp.field.text,
  };
}

function parseIdentifier(identifier: Semantics.Identifier): JSIM.Expression {
  return {
    kind: "Identifier",
    value: identifier.text,
    type: none(),
  };
}
