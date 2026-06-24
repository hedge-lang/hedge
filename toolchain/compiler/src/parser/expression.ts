import { assertNever } from "../assert.js";
import { resolveEscape } from "../lexer/escape.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  BinaryExpression,
  BinaryOperator,
  CompoundAssignOperator,
  Expression,
  FloatLiteral,
  IntLiteral,
  ReferenceExpression,
  UnaryExpression,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  isContextual,
  MUT_MESSAGE,
  parseIdentifier,
  stripPrefix,
  stripUnderscores,
  tokenAt,
  type PR,
} from "./parse-utils.js";
import { parsePath } from "./path.js";

export function parseIntLiteral(
  pos: number,
  token: Extract<Token, { kind: "int" }>,
): Parsed<IntLiteral> {
  const rawDigits = stripPrefix(token.text, token.radix);
  const digits = isSome(token.suffix)
    ? rawDigits.slice(0, -token.suffix.value.length)
    : rawDigits;
  const value = stripUnderscores(digits);
  return {
    node: {
      kind: "IntLiteral",
      tokenId: pos,
      value,
      base: token.radix,
      suffix: token.suffix,
    },
    next: pos + 1,
  };
}

function parseFloatLiteral(
  pos: number,
  token: Extract<Token, { kind: "float" }>,
): Parsed<FloatLiteral> {
  const floatText = isSome(token.suffix)
    ? token.text.slice(0, -token.suffix.value.length)
    : token.text;
  const value = stripUnderscores(floatText);
  return {
    node: { kind: "FloatLiteral", tokenId: pos, value, suffix: token.suffix },
    next: pos + 1,
  };
}

type InfixEntry =
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperator;
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    }
  | {
      readonly kind: "assign";
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    }
  | {
      readonly kind: "compound-assign";
      readonly operator: CompoundAssignOperator;
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    }
  | { readonly kind: "postfix-call"; readonly leftBp: number }
  | { readonly kind: "postfix-field"; readonly leftBp: number };

// eslint-disable-next-line complexity -- dispatch table; more readable than alternatives
function infixOp(token: Token): InfixEntry | null {
  switch (token.kind) {
    // Prec 1 — postfix (bp 26, left-to-right)
    case "lparen":
      return { kind: "postfix-call", leftBp: 26 };
    case "dot":
      return { kind: "postfix-field", leftBp: 26 };
    // Prec 3 — multiplicative (bp 22, left-assoc)
    case "star":
      return {
        kind: "binary",
        operator: "Mul",
        leftBp: 22,
        rightBp: 23,
        nonAssoc: false,
        sigil: "*",
      };
    case "slash":
      return {
        kind: "binary",
        operator: "Div",
        leftBp: 22,
        rightBp: 23,
        nonAssoc: false,
        sigil: "/",
      };
    case "percent":
      return {
        kind: "binary",
        operator: "Rem",
        leftBp: 22,
        rightBp: 23,
        nonAssoc: false,
        sigil: "%",
      };
    // Prec 4 — additive (bp 20, left-assoc)
    case "plus":
      return {
        kind: "binary",
        operator: "Add",
        leftBp: 20,
        rightBp: 21,
        nonAssoc: false,
        sigil: "+",
      };
    case "minus":
      return {
        kind: "binary",
        operator: "Sub",
        leftBp: 20,
        rightBp: 21,
        nonAssoc: false,
        sigil: "-",
      };
    // Prec 5 — bitshift (bp 18, left-assoc)
    case "lt_lt":
      return {
        kind: "binary",
        operator: "Shl",
        leftBp: 18,
        rightBp: 19,
        nonAssoc: false,
        sigil: "<<",
      };
    case "gt_gt":
      return {
        kind: "binary",
        operator: "Shr",
        leftBp: 18,
        rightBp: 19,
        nonAssoc: false,
        sigil: ">>",
      };
    // Prec 6 — bit-and (bp 16, left-assoc); infix position only — prefix & is ReferenceExpression
    case "amp":
      return {
        kind: "binary",
        operator: "BitAnd",
        leftBp: 16,
        rightBp: 17,
        nonAssoc: false,
        sigil: "&",
      };
    // Prec 7 — bit-xor (bp 14, left-assoc)
    case "caret":
      return {
        kind: "binary",
        operator: "BitXor",
        leftBp: 14,
        rightBp: 15,
        nonAssoc: false,
        sigil: "^",
      };
    // Prec 8 — bit-or (bp 12, left-assoc)
    case "pipe":
      return {
        kind: "binary",
        operator: "BitOr",
        leftBp: 12,
        rightBp: 13,
        nonAssoc: false,
        sigil: "|",
      };
    // Prec 9 — comparison (bp 10, non-associative)
    case "eq_eq":
      return {
        kind: "binary",
        operator: "Eq",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "==",
      };
    case "bang_eq":
      return {
        kind: "binary",
        operator: "Ne",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "!=",
      };
    case "lt":
      return {
        kind: "binary",
        operator: "Lt",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "<",
      };
    case "gt":
      return {
        kind: "binary",
        operator: "Gt",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: ">",
      };
    case "lt_eq":
      return {
        kind: "binary",
        operator: "Le",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "<=",
      };
    case "gt_eq":
      return {
        kind: "binary",
        operator: "Ge",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: ">=",
      };
    // Prec 10 — logical-and (bp 8, left-assoc)
    case "amp_amp":
      return {
        kind: "binary",
        operator: "And",
        leftBp: 8,
        rightBp: 9,
        nonAssoc: false,
        sigil: "&&",
      };
    // Prec 11 — logical-or (bp 6, left-assoc)
    case "pipe_pipe":
      return {
        kind: "binary",
        operator: "Or",
        leftBp: 6,
        rightBp: 7,
        nonAssoc: false,
        sigil: "||",
      };
    // Prec 13 — assignment (bp 2, right-assoc: rightBp < leftBp)
    case "eq":
      return {
        kind: "assign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "=",
      };
    case "plus_eq":
      return {
        kind: "compound-assign",
        operator: "AddAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "+=",
      };
    case "minus_eq":
      return {
        kind: "compound-assign",
        operator: "SubAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "-=",
      };
    case "star_eq":
      return {
        kind: "compound-assign",
        operator: "MulAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "*=",
      };
    case "slash_eq":
      return {
        kind: "compound-assign",
        operator: "DivAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "/=",
      };
    case "percent_eq":
      return {
        kind: "compound-assign",
        operator: "RemAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "%=",
      };
    case "amp_eq":
      return {
        kind: "compound-assign",
        operator: "BitAndAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "&=",
      };
    case "pipe_eq":
      return {
        kind: "compound-assign",
        operator: "BitOrAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "|=",
      };
    case "caret_eq":
      return {
        kind: "compound-assign",
        operator: "BitXorAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "^=",
      };
    case "lt_lt_eq":
      return {
        kind: "compound-assign",
        operator: "ShlAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "<<=",
      };
    case "gt_gt_eq":
      return {
        kind: "compound-assign",
        operator: "ShrAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: ">>=",
      };
    default:
      return null;
  }
}

/**
 * Parses a reference expression.
 *
 * Grammar:
 *
 * ```text
 * ReferenceExpression ::= "&" "write"? PrimaryExpression
 * ```
 *
 * Examples:
 *
 * ```hedge
 * &value
 * &write counter
 * ```
 */
function parseReference(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<ReferenceExpression>> {
  let cursor = pos + 1;
  let mutable = false;
  const aResult = tokenAt(tokens, cursor);
  if (isErr(aResult)) {
    return aResult;
  }
  const a = aResult.value;
  if (a.kind === "keyword" && a.text === "mut") {
    return err({
      severity: "error",
      span: some({ start: a.span.start, end: a.span.end }),
      message: MUT_MESSAGE,
    });
  }

  if (isContextual(a, "write")) {
    mutable = true;
    cursor += 1;
  }
  // Parse the operand at unary precedence (24) so postfix ops like . and () bind to
  // the operand rather than the surrounding expression: &a.b ⟹ &(a.b), &f() ⟹ &(f())
  const operandResult = parseExpression(tokens, cursor, 24);
  if (isErr(operandResult)) return operandResult;
  const operand = operandResult.value;
  const reference: ReferenceExpression = {
    kind: "ReferenceExpression",
    tokenId: pos,
    mutable,
    operand: operand.node,
  };
  return ok({ node: reference, next: operand.next });
}

/**
 * Parses a primary expression.
 *
 * Supported slice-1 forms:
 *
 * - String / integer / float / bool / char literals
 * - Path expressions
 * - Reference expressions
 *
 * Grammar:
 *
 * ```text
 * PrimaryExpression ::=
 *     StringLiteral
 *   | IntLiteral
 *   | FloatLiteral
 *   | BoolLiteral
 *   | CharLiteral
 *   | PathExpression
 *   | ReferenceExpression
 * ```
 */
// eslint-disable-next-line complexity -- This is a dispatch function and more readable this way.
function parsePrimary(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Expression>> {
  const tokenResult = tokenAt(tokens, pos);
  if (isErr(tokenResult)) return tokenResult;
  const token = tokenResult.value;
  if (token.kind === "string")
    return ok({
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    });
  if (token.kind === "int") return ok(parseIntLiteral(pos, token));
  if (token.kind === "float") return ok(parseFloatLiteral(pos, token));
  if (token.kind === "char")
    return ok({
      node: {
        kind: "CharLiteral",
        tokenId: pos,
        value: resolveEscape(token.text),
      },
      next: pos + 1,
    });
  if (
    token.kind === "keyword" &&
    (token.text === "true" || token.text === "false")
  )
    return ok({
      node: { kind: "BoolLiteral", tokenId: pos, value: token.text === "true" },
      next: pos + 1,
    });
  if (token.kind === "ident" || token.kind === "path_sep")
    return parsePath(tokens, pos);
  if (token.kind === "amp") return parseReference(tokens, pos);

  // Prefix unary: - and !
  if (token.kind === "minus") {
    const operandResult = parseExpression(tokens, pos + 1, 24);
    if (isErr(operandResult)) return operandResult;
    const unary: UnaryExpression = {
      kind: "UnaryExpression",
      tokenId: pos,
      operator: "Neg",
      operand: operandResult.value.node,
    };
    return ok({ node: unary, next: operandResult.value.next });
  }
  if (token.kind === "bang") {
    const operandResult = parseExpression(tokens, pos + 1, 24);
    if (isErr(operandResult)) return operandResult;
    const unary: UnaryExpression = {
      kind: "UnaryExpression",
      tokenId: pos,
      operator: "Not",
      operand: operandResult.value.node,
    };
    return ok({ node: unary, next: operandResult.value.next });
  }

  // Grouping: (expr) — transparent, no AST node emitted
  if (token.kind === "lparen") {
    const innerResult = parseExpression(tokens, pos + 1, 0);
    if (isErr(innerResult)) return innerResult;
    const closeToken = tokens[innerResult.value.next];
    if (closeToken === undefined || closeToken.kind !== "rparen") {
      return err({
        severity: "error",
        message: `Expected ')' to close grouped expression`,
        span: closeToken !== undefined ? some(closeToken.span) : none(),
      });
    }
    return ok({
      node: innerResult.value.node,
      next: innerResult.value.next + 1,
    });
  }

  // Guardrail: * in prefix position is dereference, not yet supported
  if (token.kind === "star")
    return err({
      severity: "error",
      message: "dereference (*) is not supported in Slice 1",
      span: some(token.span),
    });

  return err({
    severity: "error",
    message: `Expected an expression, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
  });
}

/**
 * Parses a parenthesized argument list.
 *
 * Grammar:
 *
 * ```text
 * Arguments ::= "(" (Expression ("," Expression)*)? ")"
 * ```
 */
function parseArguments(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Expression[]>> {
  const afterLparen = expect(tokens, pos, "lparen");
  if (isErr(afterLparen)) return afterLparen;
  let cursor = afterLparen.value;
  const args: Expression[] = [];
  for (;;) {
    if (tokens[cursor]?.kind === "rparen") break;
    const argResult = parseExpression(tokens, cursor, 0);
    if (isErr(argResult)) return argResult;
    args.push(argResult.value.node);
    cursor = argResult.value.next;
    if (tokens[cursor]?.kind !== "comma") break;
    cursor += 1;
  }
  const afterRparen = expect(tokens, cursor, "rparen");
  if (isErr(afterRparen)) return afterRparen;
  return ok({ node: args, next: afterRparen.value });
}

function parseInfixCall(
  tokens: readonly Token[],
  lhs: Parsed<Expression>,
  opPos: number,
): PR<Parsed<Expression>> {
  const argsResult = parseArguments(tokens, opPos);
  if (isErr(argsResult)) return argsResult;
  return ok({
    node: {
      kind: "CallExpression",
      tokenId: lhs.node.tokenId,
      callee: lhs.node,
      arguments: argsResult.value.node,
    },
    next: argsResult.value.next,
  });
}

function parseInfixField(
  tokens: readonly Token[],
  lhs: Parsed<Expression>,
  opPos: number,
): PR<Parsed<Expression>> {
  const fieldResult = parseIdentifier(tokens, opPos + 1);
  if (isErr(fieldResult)) return fieldResult;
  return ok({
    node: {
      kind: "FieldAccessExpression",
      tokenId: lhs.node.tokenId,
      object: lhs.node,
      field: fieldResult.value.node,
    },
    next: fieldResult.value.next,
  });
}

function parseInfixBinary(
  tokens: readonly Token[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: Extract<InfixEntry, { kind: "binary" }>,
): PR<Parsed<Expression>> {
  const rhsResult = parseExpression(tokens, opPos + 1, infix.rightBp);
  if (isErr(rhsResult)) return rhsResult;
  const node: BinaryExpression = {
    kind: "BinaryExpression",
    tokenId: opPos,
    operator: infix.operator,
    left: lhs.node,
    right: rhsResult.value.node,
  };
  const result: Parsed<Expression> = { node, next: rhsResult.value.next };
  if (infix.nonAssoc) {
    const peek = tokens[result.next];
    if (peek !== undefined) {
      const nextInfix = infixOp(peek);
      if (
        nextInfix !== null &&
        nextInfix.kind === "binary" &&
        nextInfix.nonAssoc &&
        nextInfix.leftBp === infix.leftBp
      ) {
        return err({
          severity: "error",
          message: `operator '${infix.sigil}' is non-associative and cannot be chained`,
          span: some(peek.span),
        });
      }
    }
  }
  return ok(result);
}

function parseInfixAssign(
  tokens: readonly Token[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: Extract<InfixEntry, { kind: "assign" }>,
): PR<Parsed<Expression>> {
  const rhsResult = parseExpression(tokens, opPos + 1, infix.rightBp);
  if (isErr(rhsResult)) return rhsResult;
  return ok({
    node: {
      kind: "AssignExpression",
      tokenId: opPos,
      lhs: lhs.node,
      rhs: rhsResult.value.node,
    },
    next: rhsResult.value.next,
  });
}

function parseInfixCompoundAssign(
  tokens: readonly Token[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: Extract<InfixEntry, { kind: "compound-assign" }>,
): PR<Parsed<Expression>> {
  const rhsResult = parseExpression(tokens, opPos + 1, infix.rightBp);
  if (isErr(rhsResult)) return rhsResult;
  return ok({
    node: {
      kind: "CompoundAssignExpression",
      tokenId: opPos,
      operator: infix.operator,
      lhs: lhs.node,
      rhs: rhsResult.value.node,
    },
    next: rhsResult.value.next,
  });
}

/**
 * Parses an expression from a sequence of tokens based on operator precedence.
 *
 * @param tokens The sequence of tokens to parse.
 * @param pos The current position in the token sequence to start parsing.
 * @param minBp The minimum binding precedence to consider while parsing.
 * @return The result of parsing, which includes either the parsed expression or an error.
 */
// eslint-disable-next-line complexity -- This is a dispatch function and more readable this way.
export function parseExpression(
  tokens: readonly Token[],
  pos: number,
  minBp: number,
): PR<Parsed<Expression>> {
  const primaryResult = parsePrimary(tokens, pos);
  if (isErr(primaryResult)) return primaryResult;
  let result = primaryResult.value;

  for (;;) {
    const nextToken = tokens[result.next];
    if (nextToken === undefined || nextToken.kind === "eof") break;
    const infix = infixOp(nextToken);
    if (infix === null) break;
    if (infix.leftBp <= minBp) break;

    const opPos = result.next;
    let stepResult: PR<Parsed<Expression>>;

    switch (infix.kind) {
      case "postfix-call":
        stepResult = parseInfixCall(tokens, result, opPos);
        break;
      case "postfix-field":
        stepResult = parseInfixField(tokens, result, opPos);
        break;
      case "binary":
        stepResult = parseInfixBinary(tokens, result, opPos, infix);
        break;
      case "assign":
        stepResult = parseInfixAssign(tokens, result, opPos, infix);
        break;
      case "compound-assign":
        stepResult = parseInfixCompoundAssign(tokens, result, opPos, infix);
        break;
      default:
        assertNever(
          infix,
          `Unhandled InfixEntry kind: ${JSON.stringify(infix)}`,
        );
    }

    if (isErr(stepResult)) return stepResult;
    result = stepResult.value;
  }

  return ok(result);
}
