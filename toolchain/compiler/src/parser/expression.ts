import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { tokenToString } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type {
  CallExpression,
  Expression,
  ExpressionStatement,
  ReferenceExpression,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import { expect, isContextual, tokenAt } from "./parse-utils.js";
import { MUT_MESSAGE, parsePath } from "./path.js";

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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<ReferenceExpression>> {
  let cursor = pos + 1;
  let mutable = false;
  const aResult = tokenAt(tokens, diagnostics, cursor);
  if (!isSome(aResult)) {
    return none();
  }
  const a = aResult.value;
  if (a.kind === "keyword" && a.text === "mut") {
    diagnostics.push({
      severity: "error",
      span: some({ start: a.span.start, end: a.span.end }),
      message: MUT_MESSAGE,
    });
    return none();
  }

  if (isContextual(a, "write")) {
    mutable = true;
    cursor += 1;
  }
  const operandResult = parsePrimary(tokens, diagnostics, cursor);
  if (!isSome(operandResult)) {
    return none();
  }
  const operand = operandResult.value;
  const reference: ReferenceExpression = {
    kind: "ReferenceExpression",
    tokenId: pos,
    mutable,
    operand: operand.node,
  };
  return some({ node: reference, next: operand.next });
}

/**
 * Parses a primary expression.
 *
 * Supported slice-1 forms:
 *
 * - String literals
 * - Integer literals
 * - Path expressions
 * - Reference expressions
 *
 * Grammar:
 *
 * ```text
 * PrimaryExpression ::=
 *     StringLiteral
 *   | IntLiteral
 *   | PathExpression
 *   | ReferenceExpression
 * ```
 */
function parsePrimary(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Expression>> {
  const tokenResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenResult)) {
    return none();
  }
  const token = tokenResult.value;
  if (token.kind === "string") {
    return some({
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    });
  }
  if (token.kind === "int") {
    return some({
      node: {
        kind: "IntLiteral",
        tokenId: pos,
        value: token.text.replaceAll("_", ""),
      },
      next: pos + 1,
    });
  }
  if (token.kind === "ident" || token.kind === "path_sep") {
    return parsePath(tokens, diagnostics, pos);
  }
  if (token.kind === "amp") {
    return parseReference(tokens, diagnostics, pos);
  }

  diagnostics.push({
    severity: "error",
    message: `Expected an expression, found "${tokenToString(token)}"`,
    span: some(token.span),
  });
  return none();
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Expression[]>> {
  const afterLparen = expect(tokens, diagnostics, pos, "lparen");
  if (!isSome(afterLparen)) {
    return none();
  }
  let cursor = afterLparen.value;
  const args: Expression[] = [];
  for (;;) {
    if (tokens[cursor]?.kind === "rparen") {
      break;
    }
    const argResult = parseExpression(tokens, diagnostics, cursor);
    if (!isSome(argResult)) {
      return none();
    }
    args.push(argResult.value.node);
    cursor = argResult.value.next;
    if (tokens[cursor]?.kind !== "comma") {
      break;
    }
    cursor += 1;
  }
  const afterRparen = expect(tokens, diagnostics, cursor, "rparen");
  if (!isSome(afterRparen)) {
    return none();
  }
  return some({ node: args, next: afterRparen.value });
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Expression>> {
  const primaryResult = parsePrimary(tokens, diagnostics, pos);
  if (!isSome(primaryResult)) {
    return none();
  }
  let result = primaryResult.value;
  for (;;) {
    if (tokens[result.next]?.kind !== "lparen") {
      break;
    }
    const argsResult = parseArguments(tokens, diagnostics, result.next);
    if (!isSome(argsResult)) {
      return none();
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
  return some(result);
}

/**
 * Wraps an expression as an expression statement.
 *
 * Expression statements are represented explicitly in the AST rather than
 * reusing expression nodes directly.
 */
export function expressionStatement(
  expression: Expression,
): ExpressionStatement {
  return {
    kind: "ExpressionStatement",
    tokenId: expression.tokenId,
    expression,
  };
}
