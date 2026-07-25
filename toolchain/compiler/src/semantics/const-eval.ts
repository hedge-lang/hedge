/**
 * @module
 * Compile-time constant folding for `const` initializers (spec 0008,
 * "Constants and statics") and for any other context that needs a
 * compile-time-known integer (starting with a `[T; N]` array length).
 * Operates directly on `Parser.Expression` rather than the analyzed
 * `Semantics.Expression` - a `const`'s value must be known before general
 * scope-based type analysis can even bind its name, since a later const may
 * be referenced by an earlier one (forward references are allowed).
 */

import { assertNever } from "../assert.js";
import { isSome, type Option } from "../option.js";
import type * as Parser from "../parser/ast.js";
import type { ConstValue } from "./ast.js";

/**
 * Base-prefix-aware `IntLiteral` string-to-`bigint` conversion. Shared with
 * `analyzer.ts`, which needs the same conversion for array-length/range-check
 * literals that have nothing to do with const-folding.
 */
export function intLiteralValue(literal: {
  readonly base: 2 | 8 | 10 | 16;
  readonly value: string;
}): bigint {
  const prefix =
    literal.base === 16
      ? "0x"
      : literal.base === 8
        ? "0o"
        : literal.base === 2
          ? "0b"
          : "";
  return BigInt(prefix + literal.value);
}

type IntWidth =
  | { readonly kind: "signed"; readonly bits: 8 | 16 | 32 }
  | { readonly kind: "unsigned"; readonly bits: 8 | 16 | 32 }
  | { readonly kind: "bigint"; readonly signed: boolean }
  /**
   * No wrap at all - used for folding an array length/repeat-count
   * (`analyzer.ts`'s `foldArrayLength`), which has no fixed runtime width
   * of its own and must never silently wrap an oversized value down into a
   * deceptively "valid" small one; the caller range-checks the exact
   * result itself instead.
   */
  | { readonly kind: "unbounded" };

export type FoldWidth =
  IntWidth | { readonly kind: "float"; readonly bits: 32 | 64 };

/** Two's-complement wrap matching `codegen/generator.ts`'s runtime wrapping. */
function wrapInt(value: bigint, width: IntWidth): bigint {
  switch (width.kind) {
    case "signed":
      return BigInt.asIntN(width.bits, value);
    case "unsigned":
      return BigInt.asUintN(width.bits, value);
    case "bigint":
      return width.signed
        ? BigInt.asIntN(64, value)
        : BigInt.asUintN(64, value);
    case "unbounded":
      return value;
    default:
      return assertNever(
        width,
        `Unexpected int width: ${JSON.stringify(width)}`,
      );
  }
}

function wrapFloat(value: number, width: { readonly bits: 32 | 64 }): number {
  return width.bits === 32 ? Math.fround(value) : value;
}

export type ConstFoldOutcome =
  | { readonly kind: "Ok"; readonly value: ConstValue }
  | { readonly kind: "NotFoldable"; readonly tokenId: number }
  | {
      readonly kind: "Undeclared";
      readonly tokenId: number;
      readonly name: string;
    }
  | { readonly kind: "DivideByZero"; readonly tokenId: number }
  /**
   * A `<<`/`>>` shift amount outside `[0, 64)` - negative is meaningless
   * (Hedge has no runtime `<<`/`>>` overload that reads a negative RHS as
   * "shift the other way"), and 64 already exceeds every Hedge integer
   * width, so nothing beyond it can mean anything either. Checked before
   * the shift ever runs: a sufficiently large positive amount would
   * otherwise try to materialize an astronomically large `bigint` and
   * throw `RangeError: Maximum BigInt size exceeded` mid-fold.
   */
  | { readonly kind: "InvalidShift"; readonly tokenId: number }
  /** A dependency already failed and was diagnosed at its own declaration - propagate silently, no cascade. */
  | { readonly kind: "AlreadyDiagnosed"; readonly tokenId: number };

/**
 * Resolves a bare-identifier reference inside a const-folded expression.
 * Supplied by the caller (`analyzer.ts`) since only it knows the set of
 * declared consts/statics and can do cycle-safe recursive resolution.
 */
export type ConstRefResolver = (
  name: string,
  tokenId: number,
) => ConstFoldOutcome;

function requireIntWidth(width: Option<FoldWidth>): IntWidth {
  if (isSome(width) && width.value.kind !== "float") {
    return width.value;
  }
  // No usable integer width in context (e.g. folding a const whose declared
  // type isn't a primitive numeric type at all) - fall back to i32, the
  // language's default integer width. The declared-type mismatch this
  // implies is caught separately once the fold outcome is compared back
  // against the const's actual declared type.
  return { kind: "signed", bits: 32 };
}

function requireFloatWidth(width: Option<FoldWidth>): { bits: 32 | 64 } {
  return isSome(width) && width.value.kind === "float"
    ? width.value
    : { bits: 64 };
}

const ARITHMETIC_OPS: ReadonlySet<Parser.BinaryOperator> = new Set([
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Rem",
]);
const BITWISE_OPS: ReadonlySet<Parser.BinaryOperator> = new Set([
  "Shl",
  "Shr",
  "BitAnd",
  "BitXor",
  "BitOr",
]);
const COMPARISON_OPS: ReadonlySet<Parser.BinaryOperator> = new Set([
  "Eq",
  "Ne",
  "Lt",
  "Gt",
  "Le",
  "Ge",
]);

function compare(op: Parser.BinaryOperator, order: -1 | 0 | 1): boolean {
  switch (op) {
    case "Eq":
      return order === 0;
    case "Ne":
      return order !== 0;
    case "Lt":
      return order < 0;
    case "Le":
      return order <= 0;
    case "Gt":
      return order > 0;
    case "Ge":
      return order >= 0;
    default:
      throw new Error(`Unexpected comparison operator: ${op}`);
  }
}

// eslint-disable-next-line complexity -- Binary-operator dispatch over a fixed, exhaustively-checked operator set.
function applyBinaryOp(
  op: Parser.BinaryOperator,
  left: ConstValue,
  right: ConstValue,
  width: Option<FoldWidth>,
  tokenId: number,
): ConstFoldOutcome {
  if (ARITHMETIC_OPS.has(op) || BITWISE_OPS.has(op)) {
    if (left.kind === "Int" && right.kind === "Int") {
      if (BITWISE_OPS.has(op)) {
        const intWidth = requireIntWidth(width);
        if (op === "Shl" || op === "Shr") {
          // The bound must track the resolved width's own bit count, not a
          // flat 64: a runtime (non-const) shift on an 8/16/32-bit value
          // lowers to JS's native `<<`/`>>` (see codegen/generator.ts),
          // which masks the shift count to 5 bits (mod 32) - a full-
          // precision BigInt fold that only rejects >=64 would silently
          // disagree with that for any shift amount in [width, 64).
          const maxShift =
            intWidth.kind === "signed" || intWidth.kind === "unsigned"
              ? BigInt(intWidth.bits)
              : 64n; // bigint (i64/u64) and unbounded (array-length context)
          if (right.value < 0n || right.value >= maxShift) {
            return { kind: "InvalidShift", tokenId };
          }
        }
        const raw =
          op === "Shl"
            ? left.value << right.value
            : op === "Shr"
              ? left.value >> right.value
              : op === "BitAnd"
                ? left.value & right.value
                : op === "BitXor"
                  ? left.value ^ right.value
                  : left.value | right.value;
        return {
          kind: "Ok",
          value: { kind: "Int", value: wrapInt(raw, intWidth) },
        };
      }
      if ((op === "Div" || op === "Rem") && right.value === 0n) {
        return { kind: "DivideByZero", tokenId };
      }
      const raw =
        op === "Add"
          ? left.value + right.value
          : op === "Sub"
            ? left.value - right.value
            : op === "Mul"
              ? left.value * right.value
              : op === "Div"
                ? left.value / right.value // BigInt division truncates toward zero
                : left.value % right.value;
      return {
        kind: "Ok",
        value: { kind: "Int", value: wrapInt(raw, requireIntWidth(width)) },
      };
    }
    if (
      left.kind === "Float" &&
      right.kind === "Float" &&
      ARITHMETIC_OPS.has(op)
    ) {
      const raw =
        op === "Add"
          ? left.value + right.value
          : op === "Sub"
            ? left.value - right.value
            : op === "Mul"
              ? left.value * right.value
              : op === "Div"
                ? left.value / right.value // IEEE 754 - no zero-guard
                : left.value % right.value;
      return {
        kind: "Ok",
        value: {
          kind: "Float",
          value: wrapFloat(raw, requireFloatWidth(width)),
        },
      };
    }
    return { kind: "NotFoldable", tokenId };
  }
  if (COMPARISON_OPS.has(op)) {
    if (
      (left.kind === "Int" && right.kind === "Int") ||
      (left.kind === "Float" && right.kind === "Float") ||
      (left.kind === "Char" && right.kind === "Char") ||
      (left.kind === "Str" && right.kind === "Str")
    ) {
      const order =
        left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
      return { kind: "Ok", value: { kind: "Bool", value: compare(op, order) } };
    }
    if (left.kind === "Bool" && right.kind === "Bool") {
      const order = left.value === right.value ? 0 : left.value ? 1 : -1;
      return { kind: "Ok", value: { kind: "Bool", value: compare(op, order) } };
    }
    return { kind: "NotFoldable", tokenId };
  }
  // "And" / "Or"
  if (left.kind === "Bool" && right.kind === "Bool") {
    const value =
      op === "And" ? left.value && right.value : left.value || right.value;
    return { kind: "Ok", value: { kind: "Bool", value } };
  }
  return { kind: "NotFoldable", tokenId };
}

function applyUnaryOp(
  op: "Neg" | "Not",
  operand: ConstValue,
  width: Option<FoldWidth>,
  tokenId: number,
): ConstFoldOutcome {
  if (op === "Not") {
    return operand.kind === "Bool"
      ? { kind: "Ok", value: { kind: "Bool", value: !operand.value } }
      : { kind: "NotFoldable", tokenId };
  }
  if (operand.kind === "Int") {
    return {
      kind: "Ok",
      value: {
        kind: "Int",
        value: wrapInt(-operand.value, requireIntWidth(width)),
      },
    };
  }
  if (operand.kind === "Float") {
    return {
      kind: "Ok",
      value: {
        kind: "Float",
        value: wrapFloat(-operand.value, requireFloatWidth(width)),
      },
    };
  }
  return { kind: "NotFoldable", tokenId };
}

/**
 * Folds a parser-level expression into a `ConstValue`, or reports why it
 * can't be folded. `width` is the target const/array-length's own derived
 * numeric width (from its declared type), threaded down unchanged through
 * the whole expression tree - Hedge has no implicit int-width coercion, so
 * every literal/sub-result within one const's initializer is assumed to
 * share its declared width.
 */
// eslint-disable-next-line complexity -- Expression-kind dispatch over the const-foldable subset; each case is a necessary, small branch.
export function foldConstExpression(
  expr: Parser.Expression,
  width: Option<FoldWidth>,
  resolveRef: ConstRefResolver,
): ConstFoldOutcome {
  switch (expr.kind) {
    case "IntLiteral":
      return {
        kind: "Ok",
        value: {
          kind: "Int",
          value: wrapInt(intLiteralValue(expr), requireIntWidth(width)),
        },
      };
    case "FloatLiteral":
      return {
        kind: "Ok",
        value: {
          kind: "Float",
          value: wrapFloat(Number(expr.value), requireFloatWidth(width)),
        },
      };
    case "BoolLiteral":
      return { kind: "Ok", value: { kind: "Bool", value: expr.value } };
    case "CharLiteral":
      return { kind: "Ok", value: { kind: "Char", value: expr.value } };
    case "StringLiteral":
      return { kind: "Ok", value: { kind: "Str", value: expr.value } };
    case "PathExpression": {
      if (expr.path.absolute || expr.path.segments.length !== 1) {
        return { kind: "NotFoldable", tokenId: expr.tokenId };
      }
      const name = expr.path.segments[0];
      if (name === undefined) {
        return { kind: "NotFoldable", tokenId: expr.tokenId };
      }
      return resolveRef(name, expr.tokenId);
    }
    case "UnaryExpression": {
      const operand = foldConstExpression(expr.operand, width, resolveRef);
      if (operand.kind !== "Ok") {
        return operand;
      }
      return applyUnaryOp(expr.operator, operand.value, width, expr.tokenId);
    }
    case "BinaryExpression": {
      const left = foldConstExpression(expr.left, width, resolveRef);
      if (left.kind !== "Ok") {
        return left;
      }
      const right = foldConstExpression(expr.right, width, resolveRef);
      if (right.kind !== "Ok") {
        return right;
      }
      return applyBinaryOp(
        expr.operator,
        left.value,
        right.value,
        width,
        expr.tokenId,
      );
    }
    case "CallExpression":
    case "ReferenceExpression":
    case "DereferenceExpression":
    case "AssignExpression":
    case "CompoundAssignExpression":
    case "FieldAccessExpression":
    case "MethodCallExpression":
    case "IndexExpression":
    case "TupleExpression":
    case "ArrayExpression":
    case "ArrayRepeatExpression":
    case "StructExpression":
    case "RangeExpression":
    case "IfExpression":
    case "LetExpression":
    case "MatchExpression":
    case "WhileExpression":
    case "Block":
    case "Identifier":
      return { kind: "NotFoldable", tokenId: expr.tokenId };
    default:
      return assertNever(
        expr,
        `Unexpected expression: ${JSON.stringify(expr)}`,
      );
  }
}
