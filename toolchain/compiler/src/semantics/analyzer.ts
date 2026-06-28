import { assert, assertNever } from "../assert.js";
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

/**
 * Binds a given {@link name} to a specific {@link type} within the current scope of the analysis context.
 *
 * @param ctx - The analysis context containing the scope stack.
 * @param name - The identifier to bind within the current scope.
 * @param type - The type associated with the identifier.
 */
function bind(ctx: AnalysisContext, name: string, type: Semantics.Type): void {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (scope !== undefined) {
    scope.set(name, type);
  }
}

/**
 * Resolves the semantic type associated with a given {@link name} within the context's scopes.
 *
 * @param ctx - The analysis context containing scoped information.
 * @param name - The name of the entity to resolve within the context's scopes.
 * @return An optional semantic type if the name is found, or none if it is not.
 */
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

/**
 * Emits an error diagnostic message for a given token in the analysis context.
 *
 * @param ctx - The analysis context where the error will be recorded.
 * @param message - The error message to emit.
 * @param tokenId - The identifier of the token associated with the error.
 */
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
    const name = type.path.segments[0];
    assert(name !== undefined, "Name segment missing");
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
  ctx: AnalysisContext,
  intLiteral: Parser.IntLiteral,
  skipRangeCheck: boolean = false,
): Semantics.IntLiteral {
  const type: Semantics.PrimitiveType = isSome(intLiteral.suffix)
    ? intSuffixToPrimitive(intLiteral.suffix.value)
    : { kind: "PrimitiveI32Type" };
  const result = { ...intLiteral, type };
  if (!skipRangeCheck && isSome(intLiteral.suffix)) {
    checkPosLiteralRange(ctx, result, type);
  }
  return result;
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

// eslint-disable-next-line complexity -- This is difficult to split up
function analyzeLetStatement(
  ctx: AnalysisContext,
  statement: Parser.LetStatement,
): Semantics.LetStatement {
  const analyzedInitializer: Option<Semantics.Expression> = mapSome(
    statement.initializer,
    (initializer) => analyzeExpression(ctx, initializer),
  );

  let coercedInitializer: Option<Semantics.Expression> = analyzedInitializer;
  let bindingType: Semantics.Type;
  if (isSome(analyzedInitializer)) {
    bindingType = getType(analyzedInitializer.value);
    if (isSome(statement.type)) {
      const annotationType = validateSlice1Type(
        ctx,
        statement.type.value,
        statement.tokenId,
      );
      let typeMismatchSuppressed = false;
      if (
        isUnsuffixedLiteralExpr(analyzedInitializer.value) &&
        isIntegerType(annotationType)
      ) {
        coercedInitializer = some(
          coerceToIntegerType(analyzedInitializer.value, annotationType),
        );
        bindingType = annotationType;
        typeMismatchSuppressed = true;
      }
      const initExpr = isSome(coercedInitializer)
        ? coercedInitializer.value
        : analyzedInitializer.value;
      if (
        initExpr.kind === "UnaryExpression" &&
        initExpr.operator === "Neg" &&
        initExpr.operand.kind === "IntLiteral" &&
        !isSome(initExpr.operand.suffix)
      ) {
        const rangeError = checkNegLiteralRange(
          initExpr.operand,
          annotationType,
        );
        if (isSome(rangeError)) {
          emitError(ctx, rangeError.value, statement.tokenId);
          typeMismatchSuppressed = true;
        }
      }
      if (!typeMismatchSuppressed && !typesEqual(annotationType, bindingType)) {
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

  if (
    isSome(coercedInitializer) &&
    coercedInitializer.value.kind === "IntLiteral"
  ) {
    checkPosLiteralRange(ctx, coercedInitializer.value, bindingType);
  }

  bind(ctx, statement.pattern.name.text, bindingType);

  return {
    ...statement,
    pattern: {
      ...statement.pattern,
      name: { ...statement.pattern.name, type: bindingType },
    },
    attributes: statement.attributes.map((attr) => analyzeAttribute(ctx, attr)),
    initializer: coercedInitializer,
    type: { kind: "UnitType", tokenId: statement.tokenId },
  };
}

const INT_BOUNDS: Partial<Record<Semantics.Type["kind"], [bigint, bigint]>> = {
  PrimitiveI8Type: [-0x80n, 0x7fn],
  PrimitiveI16Type: [-0x8000n, 0x7fffn],
  PrimitiveI32Type: [-0x8000_0000n, 0x7fff_ffffn],
  PrimitiveI64Type: [-0x8000_0000_0000_0000n, 0x7fff_ffff_ffff_ffffn],
  PrimitiveU8Type: [0n, 0xffn],
  PrimitiveU16Type: [0n, 0xffffn],
  PrimitiveU32Type: [0n, 0xffff_ffffn],
  PrimitiveU64Type: [0n, 0xffff_ffff_ffff_ffffn],
  PrimitiveUsizeType: [0n, 0xffff_ffffn],
  PrimitiveIsizeType: [-0x8000_0000n, 0x7fff_ffffn],
};

const NEG_FLOAT_MAX: Partial<Record<Semantics.Type["kind"], number>> = {
  PrimitiveF32Type: 3.4028234663852886e38,
  PrimitiveF64Type: 1.7976931348623157e308,
};

const NUMERIC_TYPE_NAME: Partial<Record<Semantics.Type["kind"], string>> = {
  PrimitiveI8Type: "i8",
  PrimitiveI16Type: "i16",
  PrimitiveI32Type: "i32",
  PrimitiveI64Type: "i64",
  PrimitiveIsizeType: "isize",
  PrimitiveU8Type: "u8",
  PrimitiveU16Type: "u16",
  PrimitiveU32Type: "u32",
  PrimitiveU64Type: "u64",
  PrimitiveUsizeType: "usize",
  PrimitiveF32Type: "f32",
  PrimitiveF64Type: "f64",
};

// eslint-disable-next-line complexity -- This is difficult to split up
function checkNegLiteralRange(
  operand: Semantics.Expression,
  annotationType: Semantics.Type,
): Option<string> {
  const typeName = NUMERIC_TYPE_NAME[annotationType.kind];
  if (typeName === undefined) return none();

  if (operand.kind === "IntLiteral") {
    const prefix =
      operand.base === 16
        ? "0x"
        : operand.base === 8
          ? "0o"
          : operand.base === 2
            ? "0b"
            : "";
    const val = -BigInt(prefix + operand.value);
    const [min, max] = INT_BOUNDS[annotationType.kind] ?? [];
    if (min === undefined || max === undefined) {
      return some(`unexpected int-literal range check for type ${typeName}`);
    }
    if (val > max || val < min) {
      return some(`out of range for ${typeName}`);
    }
  } else if (operand.kind === "FloatLiteral") {
    const val = parseFloat(operand.value);
    const max = NEG_FLOAT_MAX[annotationType.kind];
    if (max === undefined) {
      return some(`unexpected float-literal range check for type ${typeName}`);
    }
    if (val > max) {
      return some(`out of range for ${typeName}`);
    }
  }
  return none();
}

function checkPosLiteralRange(
  ctx: AnalysisContext,
  literal: Semantics.IntLiteral,
  type: Semantics.Type,
): void {
  const bounds = INT_BOUNDS[type.kind];
  if (bounds === undefined) return;
  const prefix =
    literal.base === 16
      ? "0x"
      : literal.base === 8
        ? "0o"
        : literal.base === 2
          ? "0b"
          : "";
  const val = BigInt(prefix + literal.value);
  const [, max] = bounds;
  if (val > max) {
    const name = NUMERIC_TYPE_NAME[type.kind] ?? type.kind;
    emitError(ctx, `out of range for ${name}`, literal.tokenId);
  }
}

function isUnsuffixedLiteralExpr(expr: Semantics.Expression): boolean {
  if (expr.kind === "IntLiteral" && !isSome(expr.suffix)) return true;
  return (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral" &&
    !isSome(expr.operand.suffix)
  );
}

function coerceToIntegerType(
  expr: Semantics.Expression,
  targetType: Semantics.Type,
): Semantics.Expression {
  if (!isIntegerType(targetType)) return expr;
  if (expr.kind === "IntLiteral" && !isSome(expr.suffix)) {
    return { ...expr, type: targetType };
  }
  if (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral" &&
    !isSome(expr.operand.suffix)
  ) {
    return {
      ...expr,
      type: targetType,
      operand: { ...expr.operand, type: targetType },
    };
  }
  return expr;
}

function checkCoercedLiteralRange(
  ctx: AnalysisContext,
  expr: Semantics.Expression,
): void {
  if (expr.kind === "IntLiteral") {
    checkPosLiteralRange(ctx, expr, expr.type);
  } else if (
    expr.kind === "UnaryExpression" &&
    expr.operator === "Neg" &&
    expr.operand.kind === "IntLiteral"
  ) {
    const rangeError = checkNegLiteralRange(expr.operand, expr.type);
    if (isSome(rangeError)) {
      emitError(ctx, rangeError.value, expr.operand.tokenId);
    }
  }
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
  const isLeftTypeValid = leftType.kind !== "UnitType";
  const isRightTypeValid = rightType.kind !== "UnitType";

  switch (op) {
    case "Eq":
    case "Ne":
    case "Lt":
    case "Gt":
    case "Le":
    case "Ge": {
      if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "comparison operands must have the same type", tokenId);
      }
      return bool;
    }

    case "And":
    case "Or": {
      if (isLeftTypeValid && leftType.kind !== "PrimitiveBooleanType") {
        emitError(ctx, "logical operator operands must be `bool`", tokenId);
      }
      if (isRightTypeValid && rightType.kind !== "PrimitiveBooleanType") {
        emitError(ctx, "logical operator operands must be `bool`", tokenId);
      }
      return bool;
    }

    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "Rem": {
      if (isLeftTypeValid && !isNumericType(leftType)) {
        emitError(ctx, "arithmetic operands must be numeric", tokenId);
      }
      if (isRightTypeValid && !isNumericType(rightType)) {
        emitError(ctx, "arithmetic operands must be numeric", tokenId);
      }
      if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "arithmetic operands must have the same type", tokenId);
      }
      return isLeftTypeValid ? leftType : rightType;
    }

    case "Shl":
    case "Shr":
    case "BitAnd":
    case "BitXor":
    case "BitOr": {
      if (isLeftTypeValid && !isIntegerType(leftType)) {
        emitError(ctx, "bitwise operations require integer operands", tokenId);
      }
      if (isRightTypeValid && !isIntegerType(rightType)) {
        emitError(ctx, "bitwise operations require integer operands", tokenId);
      }
      if (
        isLeftTypeValid &&
        isRightTypeValid &&
        !typesEqual(leftType, rightType)
      ) {
        emitError(ctx, "bitwise operands must have the same type", tokenId);
      }
      return isLeftTypeValid ? leftType : rightType;
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
      let left = analyzeExpression(ctx, expression.left);
      let right = analyzeExpression(ctx, expression.right);
      const isLeftUnsuffixed = isUnsuffixedLiteralExpr(left);
      const isRightUnsuffixed = isUnsuffixedLiteralExpr(right);
      if (isLeftUnsuffixed && !isRightUnsuffixed) {
        left = coerceToIntegerType(left, getType(right));
        checkCoercedLiteralRange(ctx, left);
      } else if (!isLeftUnsuffixed && isRightUnsuffixed) {
        right = coerceToIntegerType(right, getType(left));
        checkCoercedLiteralRange(ctx, right);
      }
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
      const operand =
        expression.operator === "Neg" &&
        expression.operand.kind === "IntLiteral"
          ? analyzeIntLiteral(ctx, expression.operand, true)
          : analyzeExpression(ctx, expression.operand);
      const type: Semantics.Type =
        expression.operator === "Not"
          ? { kind: "PrimitiveBooleanType" }
          : getType(operand);
      if (
        expression.operator === "Neg" &&
        operand.kind === "IntLiteral" &&
        isSome(operand.suffix)
      ) {
        const rangeError = checkNegLiteralRange(operand, type);
        if (isSome(rangeError))
          emitError(ctx, rangeError.value, operand.tokenId);
      }
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
