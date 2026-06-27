import { assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { IntSuffix, Token } from "../lexer/token.js";
import {
  isSome,
  mapSome,
  none,
  some,
  type Option,
  unwrapSomeOr,
} from "../option.js";
import type * as Parser from "../parser/ast.js";
import type * as Semantics from "./ast.js";

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly program: Semantics.Program;
}

/**
 * Mutable analysis context threaded explicitly through every pass function.
 * Maps onto `struct AnalysisContext { scopes: ..., diagnostics: ... }` in Hedge.
 */
interface AnalysisContext {
  readonly scopes: Map<string, Semantics.Type>[];
  readonly diagnostics: Diagnostic[];
  readonly tokens: readonly Token[];
}

/** Synthetic unit type used for nodes that produce no value. */
const UNIT: Semantics.UnitType = { kind: "UnitType", tokenId: 0 };

function getType(expr: Semantics.Expression): Semantics.Type {
  return expr.type;
}

/** Names and types available before any user code — Slice 1 prelude. */
const BUILTIN_SCOPE: [string, Semantics.Type][] = [
  [
    "print",
    {
      kind: "FunctionType",
      params: [{ kind: "PrimitiveStringType" }],
      returnType: UNIT,
    },
  ],
];

function bind(ctx: AnalysisContext, name: string, type: Semantics.Type): void {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (scope !== undefined) {
    scope.set(name, type);
  }
}

function resolve(ctx: AnalysisContext, name: string): Option<Semantics.Type> {
  for (let i = ctx.scopes.length - 1; i >= 0; i -= 1) {
    const scope = ctx.scopes[i];
    if (scope !== undefined) {
      const type = scope.get(name);
      if (type !== undefined) return some(type);
    }
  }
  return none();
}

function emitError(
  ctx: AnalysisContext,
  message: string,
  tokenId: number,
): void {
  const token = ctx.tokens[tokenId];
  ctx.diagnostics.push({
    severity: "error",
    message,
    span: token !== undefined ? some(token.span) : none(),
  });
}

// eslint-disable-next-line complexity -- Routing function
function namedTypeToPrimitive(name: string): Option<Semantics.PrimitiveType> {
  switch (name) {
    case "bool":
      return some({ kind: "PrimitiveBooleanType" });
    case "str":
      return some({ kind: "PrimitiveStringType" });
    case "char":
      return some({ kind: "PrimitiveCharType" });
    case "i8":
      return some({ kind: "PrimitiveI8Type" });
    case "i16":
      return some({ kind: "PrimitiveI16Type" });
    case "i32":
      return some({ kind: "PrimitiveI32Type" });
    case "i64":
      return some({ kind: "PrimitiveI64Type" });
    case "u8":
      return some({ kind: "PrimitiveU8Type" });
    case "u16":
      return some({ kind: "PrimitiveU16Type" });
    case "u32":
      return some({ kind: "PrimitiveU32Type" });
    case "u64":
      return some({ kind: "PrimitiveU64Type" });
    case "usize":
      return some({ kind: "PrimitiveUsizeType" });
    case "isize":
      return some({ kind: "PrimitiveIsizeType" });
    case "f32":
      return some({ kind: "PrimitiveF32Type" });
    case "f64":
      return some({ kind: "PrimitiveF64Type" });
    default:
      return none();
  }
}

function intSuffixToPrimitive(suffix: IntSuffix): Semantics.PrimitiveType {
  switch (suffix) {
    case "i8":
      return { kind: "PrimitiveI8Type" };
    case "i16":
      return { kind: "PrimitiveI16Type" };
    case "i32":
      return { kind: "PrimitiveI32Type" };
    case "i64":
      return { kind: "PrimitiveI64Type" };
    case "isize":
      return { kind: "PrimitiveIsizeType" };
    case "u8":
      return { kind: "PrimitiveU8Type" };
    case "u16":
      return { kind: "PrimitiveU16Type" };
    case "u32":
      return { kind: "PrimitiveU32Type" };
    case "u64":
      return { kind: "PrimitiveU64Type" };
    case "usize":
      return { kind: "PrimitiveUsizeType" };
  }
}

function validateSlice1Type(
  ctx: AnalysisContext,
  type: Parser.Type,
  tokenId: number,
): Semantics.Type {
  if (type.kind === "NamedType" && type.path.segments.length === 1) {
    const name = String(type.path.segments[0]);
    const prim = namedTypeToPrimitive(name);
    if (isSome(prim)) {
      return prim.value;
    }
  }
  if (type.kind === "UnitType") return type;
  emitError(ctx, "type is not supported in Slice 1", tokenId);
  return { kind: "UnitType", tokenId };
}

function analyzeItem(ctx: AnalysisContext, item: Parser.Item): Semantics.Item {
  switch (item.kind) {
    case "Function":
      return analyzeFunctionDecl(ctx, item);
    case "Struct":
      return analyzeStruct(ctx, item);
    case "LetStatement":
    case "ExpressionStatement": {
      emitError(
        ctx,
        "only function and struct declarations are allowed at the top level",
        item.tokenId,
      );
      const prevLen = ctx.diagnostics.length;
      const analyzed = analyzeStatement(ctx, item);
      ctx.diagnostics.splice(prevLen); // suppress cascading errors — the restriction error is good enough
      return analyzed;
    }
    default:
      emitError(
        ctx,
        "only function and struct declarations are allowed at the top level",
        item.tokenId,
      );
      return analyzeExpression(ctx, item);
  }
}

function analyzeStruct(
  ctx: AnalysisContext,
  item: Parser.StructDecl,
): Semantics.StructDecl {
  const scopedName = `scoped(${ctx.scopes.length})::${item.name.text}`;
  return {
    ...item,
    name: { ...item.name, type: { kind: "StructType", name: scopedName } },
    attributes: item.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    body: analyzeStructBody(ctx, item.body),
    type: {
      kind: "StructType",
      name: scopedName,
    },
  };
}

function analyzeStructBody(
  ctx: AnalysisContext,
  body: Parser.StructBody,
): Semantics.StructBody {
  switch (body.kind) {
    case "Unit":
      return body;
    case "NamedFields":
      return {
        ...body,
        fields: body.fields.map(
          (field: Parser.StructField): Semantics.StructField => {
            const fieldType = validateSlice1Type(
              ctx,
              field.type,
              field.type.tokenId,
            );
            return {
              ...field,
              name: analyzeIdentifier(ctx, field.name, fieldType),
              attributes: field.attributes.map((attr) =>
                analyzeAttribute(ctx, attr),
              ),
              type: fieldType,
            };
          },
        ),
      };
    case "TupleFields":
      return {
        ...body,
        fields: body.fields.map(
          (field: Parser.TupleField): Semantics.TupleField => ({
            ...field,
            attributes: field.attributes.map((attr) =>
              analyzeAttribute(ctx, attr),
            ),
            type: validateSlice1Type(ctx, field.type, field.type.tokenId),
          }),
        ),
      };
    default:
      assertNever(body, `Unexpected AST node: ${JSON.stringify(body)}`);
  }
}

function analyzeAttribute(
  ctx: AnalysisContext,
  attribute: Parser.Attribute,
): Semantics.Attribute {
  return {
    ...attribute,
    name: analyzeIdentifier(ctx, attribute.name, {
      kind: "PrimitiveStringType",
    }),
    arguments: mapSome(attribute.arguments, (args) =>
      args.map((arg) => ({
        path: arg.path,
        literal: mapSome(arg.literal, (literal) => {
          switch (literal.kind) {
            case "StringLiteral":
              return analyzeStringLiteral(ctx, literal);
            case "IntLiteral":
              return analyzeIntLiteral(ctx, literal);
            default:
              return assertNever(
                literal,
                `Unexpected AST node: ${JSON.stringify(literal)}`,
              );
          }
        }),
      })),
    ),
  };
}

function analyzeStringLiteral(
  _ctx: AnalysisContext,
  stringLiteral: Parser.StringLiteral,
): Semantics.StringLiteral {
  return { ...stringLiteral, type: { kind: "PrimitiveStringType" } };
}

function analyzeIntLiteral(
  _ctx: AnalysisContext,
  intLiteral: Parser.IntLiteral,
): Semantics.IntLiteral {
  const type: Semantics.PrimitiveType = isSome(intLiteral.suffix)
    ? intSuffixToPrimitive(intLiteral.suffix.value)
    : { kind: "PrimitiveI32Type" };
  return { ...intLiteral, type };
}

function analyzeFloatLiteral(
  _ctx: AnalysisContext,
  floatLiteral: Parser.FloatLiteral,
): Semantics.FloatLiteral {
  const type: Semantics.PrimitiveType =
    isSome(floatLiteral.suffix) && floatLiteral.suffix.value === "f32"
      ? { kind: "PrimitiveF32Type" }
      : { kind: "PrimitiveF64Type" };
  return { ...floatLiteral, type };
}

function analyzeBoolLiteral(
  _ctx: AnalysisContext,
  boolLiteral: Parser.BoolLiteral,
): Semantics.BoolLiteral {
  return { ...boolLiteral, type: { kind: "PrimitiveBooleanType" } };
}

function analyzeCharLiteral(
  _ctx: AnalysisContext,
  charLiteral: Parser.CharLiteral,
): Semantics.CharLiteral {
  return { ...charLiteral, type: { kind: "PrimitiveCharType" } };
}

function analyzeFunctionDecl(
  ctx: AnalysisContext,
  decl: Parser.FunctionDecl,
): Semantics.FunctionDecl {
  ctx.scopes.push(new Map());
  const analyzedParams = decl.params.map(
    (param: Parser.Param): Semantics.Param => {
      const paramType = validateSlice1Type(ctx, param.type, param.type.tokenId);
      bind(ctx, param.pattern.name.text, paramType);
      return {
        ...param,
        type: paramType,
        pattern: {
          ...param.pattern,
          name: { ...param.pattern.name, type: paramType },
        },
      };
    },
  );
  const result: Semantics.FunctionDecl = {
    ...decl,
    name: {
      ...decl.name,
      type: { kind: "UnitType", tokenId: decl.name.tokenId },
    },
    attributes: decl.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    params: analyzedParams,
    returnType: mapSome(
      decl.returnType,
      (returnType: Parser.Type): Semantics.Type =>
        validateSlice1Type(ctx, returnType, returnType.tokenId),
    ),
    body: analyzeBlock(ctx, decl.body),
  };
  ctx.scopes.pop();
  return result;
}

function analyzeBlock(
  ctx: AnalysisContext,
  block: Parser.Block,
): Semantics.Block {
  ctx.scopes.push(new Map());
  const analyzedStatements = block.statements.map((statement) =>
    analyzeStatement(ctx, statement),
  );
  const analyzedTrailing = mapSome(block.trailingExpression, (expr) =>
    analyzeExpression(ctx, expr),
  );
  const type: Semantics.Type = isSome(analyzedTrailing)
    ? getType(analyzedTrailing.value)
    : { kind: "UnitType", tokenId: block.tokenId };
  const result: Semantics.Block = {
    ...block,
    innerAttributes: block.innerAttributes.map((attr) =>
      analyzeAttribute(ctx, attr),
    ),
    statements: analyzedStatements,
    trailingExpression: analyzedTrailing,
    type,
  };
  ctx.scopes.pop();
  return result;
}

function analyzeStatement(
  ctx: AnalysisContext,
  statement: Parser.Statement,
): Semantics.Statement {
  switch (statement.kind) {
    case "LetStatement":
      return analyzeLetStatement(ctx, statement);
    case "ExpressionStatement":
      return {
        ...statement,
        expression: analyzeExpression(ctx, statement.expression),
        type: { kind: "UnitType", tokenId: statement.tokenId },
      };
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
  }
}

function analyzeLetStatement(
  ctx: AnalysisContext,
  statement: Parser.LetStatement,
): Semantics.LetStatement {
  const analyzedInitializer: Option<Semantics.Expression> = mapSome(
    statement.initializer,
    (initializer) => analyzeExpression(ctx, initializer),
  );

  let bindingType: Semantics.Type;
  if (isSome(analyzedInitializer)) {
    bindingType = getType(analyzedInitializer.value);
    if (isSome(statement.type)) {
      const annotationType = validateSlice1Type(
        ctx,
        statement.type.value,
        statement.tokenId,
      );
      if (!typesEqual(annotationType, bindingType)) {
        emitError(
          ctx,
          "type mismatch: explicit annotation does not match initializer type",
          statement.tokenId,
        );
      }
      bindingType = annotationType;
    }
  } else if (isSome(statement.type)) {
    bindingType = validateSlice1Type(
      ctx,
      statement.type.value,
      statement.tokenId,
    );
  } else {
    bindingType = { kind: "UnitType", tokenId: statement.tokenId };
  }

  bind(ctx, statement.pattern.name.text, bindingType);

  return {
    ...statement,
    pattern: {
      ...statement.pattern,
      name: { ...statement.pattern.name, type: bindingType },
    },
    attributes: statement.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    initializer: analyzedInitializer,
    type: { kind: "UnitType", tokenId: statement.tokenId },
  };
}

function typesEqual(a: Semantics.Type, b: Semantics.Type): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "StructType" && b.kind === "StructType")
    return a.name === b.name;
  return true;
}

function isNumericType(type: Semantics.Type): boolean {
  return (
    isIntegerType(type) ||
    type.kind === "PrimitiveF32Type" ||
    type.kind === "PrimitiveF64Type"
  );
}

function isIntegerType(type: Semantics.Type): boolean {
  return (
    type.kind === "PrimitiveI8Type" ||
    type.kind === "PrimitiveI16Type" ||
    type.kind === "PrimitiveI32Type" ||
    type.kind === "PrimitiveI64Type" ||
    type.kind === "PrimitiveIsizeType" ||
    type.kind === "PrimitiveU8Type" ||
    type.kind === "PrimitiveU16Type" ||
    type.kind === "PrimitiveU32Type" ||
    type.kind === "PrimitiveU64Type" ||
    type.kind === "PrimitiveUsizeType"
  );
}

// eslint-disable-next-line complexity -- This is a routing function
function inferBinaryType(
  ctx: AnalysisContext,
  op: Parser.BinaryOperator,
  left: Semantics.Expression,
  right: Semantics.Expression,
  tokenId: number,
): Semantics.Type {
  const bool: Semantics.Type = { kind: "PrimitiveBooleanType" };

  const leftType = getType(left);
  const rightType = getType(right);

  // UnitType is the error-recovery type from failed name resolution.
  // Suppress cascading type errors when either operand already failed.
  const leftOk = leftType.kind !== "UnitType";
  const rightOk = rightType.kind !== "UnitType";

  switch (op) {
    case "Eq":
    case "Ne":
    case "Lt":
    case "Gt":
    case "Le":
    case "Ge": {
      if (leftOk && rightOk && !typesEqual(leftType, rightType)) {
        emitError(ctx, "comparison operands must have the same type", tokenId);
      }
      return bool;
    }

    case "And":
    case "Or": {
      if (leftOk && leftType.kind !== "PrimitiveBooleanType") {
        emitError(ctx, "logical operator operands must be `bool`", tokenId);
      }
      if (rightOk && rightType.kind !== "PrimitiveBooleanType") {
        emitError(ctx, "logical operator operands must be `bool`", tokenId);
      }
      return bool;
    }

    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "Rem": {
      if (leftOk && !isNumericType(leftType)) {
        emitError(ctx, "arithmetic operands must be numeric", tokenId);
      }
      if (rightOk && !isNumericType(rightType)) {
        emitError(ctx, "arithmetic operands must be numeric", tokenId);
      }
      if (leftOk && rightOk && !typesEqual(leftType, rightType)) {
        emitError(ctx, "arithmetic operands must have the same type", tokenId);
      }
      return leftOk ? leftType : rightType;
    }

    case "Shl":
    case "Shr":
    case "BitAnd":
    case "BitXor":
    case "BitOr": {
      if (leftOk && !isIntegerType(leftType)) {
        emitError(ctx, "bitwise operations require integer operands", tokenId);
      }
      if (rightOk && !isIntegerType(rightType)) {
        emitError(ctx, "bitwise operations require integer operands", tokenId);
      }
      if (leftOk && rightOk && !typesEqual(leftType, rightType)) {
        emitError(ctx, "bitwise operands must have the same type", tokenId);
      }
      return leftOk ? leftType : rightType;
    }
    default:
      assertNever(op, `Unexpected binary operator: ${JSON.stringify(op)}`);
  }
}

// eslint-disable-next-line complexity -- This is a routing function
function analyzeExpression(
  ctx: AnalysisContext,
  expression: Parser.Expression,
): Semantics.Expression {
  switch (expression.kind) {
    case "StringLiteral":
      return analyzeStringLiteral(ctx, expression);
    case "IntLiteral":
      return analyzeIntLiteral(ctx, expression);
    case "FloatLiteral":
      return analyzeFloatLiteral(ctx, expression);
    case "BoolLiteral":
      return analyzeBoolLiteral(ctx, expression);
    case "CharLiteral":
      return analyzeCharLiteral(ctx, expression);
    case "PathExpression":
      return analyzePath(ctx, expression);
    case "CallExpression":
      return analyzeCall(ctx, expression);
    case "ReferenceExpression":
      emitError(
        ctx,
        "borrow expressions are not supported in Slice 1",
        expression.tokenId,
      );
      return {
        ...expression,
        operand: analyzeExpression(ctx, expression.operand),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "BinaryExpression": {
      const left = analyzeExpression(ctx, expression.left);
      const right = analyzeExpression(ctx, expression.right);
      const type = inferBinaryType(
        ctx,
        expression.operator,
        left,
        right,
        expression.tokenId,
      );
      return { ...expression, left, right, type };
    }
    case "UnaryExpression": {
      const operand = analyzeExpression(ctx, expression.operand);
      const type: Semantics.Type =
        expression.operator === "Not"
          ? { kind: "PrimitiveBooleanType" }
          : getType(operand);
      return { ...expression, operand, type };
    }
    case "AssignExpression":
    case "CompoundAssignExpression":
      return {
        ...expression,
        lhs: analyzeExpression(ctx, expression.lhs),
        rhs: analyzeExpression(ctx, expression.rhs),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "FieldAccessExpression":
      return {
        ...expression,
        object: analyzeExpression(ctx, expression.object),
        field: {
          ...expression.field,
          type: { kind: "UnitType", tokenId: expression.field.tokenId },
        },
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "MethodCallExpression": {
      const receiver = analyzeExpression(ctx, expression.receiver);
      return {
        ...expression,
        receiver,
        method: {
          ...expression.method,
          type: { kind: "UnitType", tokenId: expression.method.tokenId },
        },
        arguments: expression.arguments.map((arg) =>
          analyzeExpression(ctx, arg),
        ),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    }
    case "IndexExpression":
      return {
        ...expression,
        object: analyzeExpression(ctx, expression.object),
        index: analyzeExpression(ctx, expression.index),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "TupleExpression":
      return {
        ...expression,
        elements: expression.elements.map((elem) =>
          analyzeExpression(ctx, elem),
        ),
        type: { kind: "UnitType", tokenId: expression.tokenId },
      };
    case "StructExpression":
      return analyzeStructExpression(ctx, expression);
    case "IfExpression":
      return analyzeIfExpression(ctx, expression);
    case "Block":
      return analyzeBlock(ctx, expression);
    case "Identifier":
      return analyzePath(ctx, {
        ...expression,
        kind: "PathExpression",
        path: { absolute: false, segments: [expression.text] },
      });
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

function analyzeStructExpression(
  ctx: AnalysisContext,
  structExpression: Parser.StructExpression,
): Semantics.StructExpression {
  return {
    ...structExpression,
    fields: structExpression.fields.map(
      (field: Parser.FieldInit): Semantics.FieldInit => {
        const analyzedValue = mapSome(field.value, (v) =>
          analyzeExpression(ctx, v),
        );
        return {
          ...field,
          name: analyzeIdentifier(ctx, field.name, {
            kind: "UnitType",
            tokenId: structExpression.tokenId,
          }),
          value: analyzedValue,
          type: unwrapSomeOr(mapSome(analyzedValue, getType), {
            kind: "UnitType",
            tokenId: structExpression.tokenId,
          }),
        };
      },
    ),
    base: mapSome(structExpression.base, (base) =>
      analyzeExpression(ctx, base),
    ),
    type: { kind: "UnitType", tokenId: structExpression.tokenId },
  };
}

function analyzeIfExpression(
  ctx: AnalysisContext,
  ifExpression: Parser.IfExpression,
): Semantics.IfExpression {
  const condition = analyzeExpression(ctx, ifExpression.condition);
  const thenBranch = analyzeBlock(ctx, ifExpression.thenBranch);
  const elseBranch = mapSome(ifExpression.elseBranch, (elseBranch) =>
    elseBranch.kind === "IfExpression"
      ? analyzeIfExpression(ctx, elseBranch)
      : analyzeBlock(ctx, elseBranch),
  );

  const condType = getType(condition);
  if (
    condType.kind !== "UnitType" &&
    condType.kind !== "PrimitiveBooleanType"
  ) {
    emitError(ctx, "if condition must be `bool`", ifExpression.tokenId);
  }

  if (isSome(elseBranch)) {
    const thenType = thenBranch.type;
    const elseType = elseBranch.value.type;
    if (
      thenType.kind !== "UnitType" &&
      elseType.kind !== "UnitType" &&
      !typesEqual(thenType, elseType)
    ) {
      emitError(
        ctx,
        "if expression branches have incompatible types",
        ifExpression.tokenId,
      );
    }
  }

  const type: Semantics.Type = isSome(elseBranch)
    ? thenBranch.type
    : { kind: "UnitType", tokenId: ifExpression.tokenId };
  return {
    ...ifExpression,
    condition,
    thenBranch,
    elseBranch,
    type,
  };
}

function analyzeIdentifier(
  _ctx: AnalysisContext,
  identifier: Parser.Identifier,
  type: Semantics.Type,
): Semantics.Identifier {
  return { ...identifier, type };
}

function analyzeCall(
  ctx: AnalysisContext,
  call: Parser.CallExpression,
): Semantics.CallExpression {
  const callee = analyzeExpression(ctx, call.callee);
  const args = call.arguments.map((arg) => analyzeExpression(ctx, arg));
  const calleeType = getType(callee);
  const returnType: Semantics.Type =
    calleeType.kind === "FunctionType"
      ? calleeType.returnType
      : { kind: "UnitType", tokenId: call.tokenId };
  return { ...call, callee, arguments: args, type: returnType };
}

function analyzePath(
  ctx: AnalysisContext,
  path: Parser.PathExpression,
): Semantics.PathExpression {
  const { segments } = path.path;
  // Multi-segment paths (modules, associated items) are a later slice.
  if (segments.length !== 1) {
    return { ...path, type: { kind: "UnitType", tokenId: path.tokenId } };
  }
  const name = segments[0];
  if (name === undefined) {
    return { ...path, type: { kind: "UnitType", tokenId: path.tokenId } };
  }
  const resolvedType = resolve(ctx, name);
  if (isSome(resolvedType)) {
    return { ...path, type: resolvedType.value };
  }
  emitError(ctx, `Cannot find name "${name}" in this scope.`, path.tokenId);
  return { ...path, type: { kind: "UnitType", tokenId: path.tokenId } };
}

/**
 * Run semantic analysis (name resolution and type inference) over a parsed program.
 *
 * Slice-1 scope: a builtin prelude, then per-function and per-block scopes;
 * `let` binds into the current scope after its initializer is analyzed.
 */
export function analyze(
  program: Parser.Program,
  tokens: readonly Token[],
): AnalysisResult {
  const ctx: AnalysisContext = {
    scopes: [new Map(BUILTIN_SCOPE)],
    diagnostics: [],
    tokens,
  };
  const attributes = program.attributes.map((attr) =>
    analyzeAttribute(ctx, attr),
  );
  const items = program.items.map((item) => analyzeItem(ctx, item));
  return {
    diagnostics: ctx.diagnostics,
    program: { ...program, attributes, items },
  };
}
