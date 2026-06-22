import { resolveEscape } from "../lexer/escape.js";
import type { Token } from "../lexer/token.js";
import { isSome, some } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  CallExpression,
  Expression,
  FloatLiteral,
  IntLiteral,
  ReferenceExpression,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  isContextual,
  MUT_MESSAGE,
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
  const operandResult = parsePrimary(tokens, cursor);
  if (isErr(operandResult)) {
    return operandResult;
  }
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
  if (isErr(afterLparen)) {
    return afterLparen;
  }
  let cursor = afterLparen.value;
  const args: Expression[] = [];
  for (;;) {
    if (tokens[cursor]?.kind === "rparen") {
      break;
    }
    const argResult = parseExpression(tokens, cursor);
    if (isErr(argResult)) {
      return argResult;
    }
    args.push(argResult.value.node);
    cursor = argResult.value.next;
    if (tokens[cursor]?.kind !== "comma") {
      break;
    }
    cursor += 1;
  }
  const afterRparen = expect(tokens, cursor, "rparen");
  if (isErr(afterRparen)) {
    return afterRparen;
  }
  return ok({ node: args, next: afterRparen.value });
}

/**
 * Parses an expression.
 *
 * Slice-1 supports postfix call chaining on top of primary expressions.
 *
 * Grammar:
 *
 * ```text
 * Expression ::= PrimaryExpression ("(" Arguments? ")")*
 * ```
 *
 * Examples:
 *
 * ```hedge
 * print()
 * print(name)
 * foo()(bar)
 * ```
 */
export function parseExpression(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Expression>> {
  const resultResult = parsePrimary(tokens, pos);
  if (isErr(resultResult)) {
    return resultResult;
  }
  let result = resultResult.value;
  for (;;) {
    if (tokens[result.next]?.kind !== "lparen") {
      break;
    }
    const argsResult = parseArguments(tokens, result.next);
    if (isErr(argsResult)) {
      return argsResult;
    }
    const args = argsResult.value;
    const call: CallExpression = {
      kind: "CallExpression",
      tokenId: result.node.tokenId,
      callee: result.node,
      arguments: args.node,
    };
    result = { node: call, next: args.next };
  }
  return ok(result);
}
