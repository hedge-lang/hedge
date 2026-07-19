import { assert } from "../../assert.js";
import type { Span, Token } from "../../lexer/token.js";
import type * as Semantics from "../../semantics/ast.js";

const OPENERS: ReadonlySet<Token["kind"]> = new Set([
  "lparen",
  "lbrace",
  "lbracket",
]);
const CLOSERS: ReadonlySet<Token["kind"]> = new Set([
  "rparen",
  "rbrace",
  "rbracket",
]);

function tokenAt(tokens: readonly Token[], tokenId: number): Token {
  const token = tokens[tokenId];
  assert(token !== undefined, `Expected a token at index ${tokenId}`);
  return token;
}

/** Finds the tokenId of the `}` matching the `{` at `openBraceTokenId`. */
export function findMatchingCloseBraceTokenId(
  tokens: readonly Token[],
  openBraceTokenId: number,
): number {
  assert(
    tokenAt(tokens, openBraceTokenId).kind === "lbrace",
    "Expected an lbrace at the given tokenId",
  );
  let depth = 0;
  for (let cursor = openBraceTokenId; cursor < tokens.length; cursor += 1) {
    const token = tokenAt(tokens, cursor);
    if (token.kind === "lbrace") {
      depth += 1;
    } else if (token.kind === "rbrace") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
  }
  assert(false, "Unbalanced braces: no matching `}` found");
}

/**
 * Finds the tokenId of the first depth-0 `;` at or after `startTokenId`, the
 * terminator of a statement, inclusive (the returned span covers the
 * statement's own trailing `;`).
 *
 * `startTokenId` isn't always the true left edge of the enclosing text: a
 * parenthesized sub-expression like `(*r).value` parses transparently (no
 * grouping node), so a lowered node's own `tokenId` can start *inside*
 * already-open parens the caller never opened from this function's point of
 * view. Depth is clamped at 0 rather than going negative on such an
 * unmatched closer, so the scan still recognizes the statement's real `;`
 * instead of running off the end of the token stream.
 */
export function findStatementEndTokenId(
  tokens: readonly Token[],
  startTokenId: number,
): number {
  let depth = 0;
  for (let cursor = startTokenId; cursor < tokens.length; cursor += 1) {
    const token = tokenAt(tokens, cursor);
    if (OPENERS.has(token.kind)) {
      depth += 1;
    } else if (CLOSERS.has(token.kind)) {
      depth = Math.max(0, depth - 1);
    } else if (token.kind === "semi" && depth === 0) {
      return cursor;
    }
  }
  assert(false, "Unterminated statement: no depth-0 `;` found");
}

/**
 * Finds the tokenId of the last token belonging to the expression starting
 * at `startTokenId`, stopping (exclusive) at the first depth-0 `;`, `,`, or
 * a closing bracket that belongs to an enclosing construct rather than one
 * opened within the expression itself.
 */
export function findExpressionEndTokenId(
  tokens: readonly Token[],
  startTokenId: number,
): number {
  let depth = 0;
  let last = startTokenId;
  for (let cursor = startTokenId; cursor < tokens.length; cursor += 1) {
    const token = tokenAt(tokens, cursor);
    if (CLOSERS.has(token.kind) && depth === 0) {
      return last;
    }
    if ((token.kind === "semi" || token.kind === "comma") && depth === 0) {
      return last;
    }
    if (OPENERS.has(token.kind)) {
      depth += 1;
    } else if (CLOSERS.has(token.kind)) {
      depth -= 1;
    }
    last = cursor;
  }
  return last;
}

/**
 * `BinaryExpression.tokenId` is the operator's own token, not the left
 * operand's start. Descend through `left` for a chain of binary
 * expressions to find where the whole expression actually starts.
 */
export function leftmostExpressionTokenId(expr: Semantics.Expression): number {
  if (expr.kind === "BinaryExpression") {
    return leftmostExpressionTokenId(expr.left);
  }
  return expr.tokenId;
}

export function resolveSpan(
  tokens: readonly Token[],
  startTokenId: number,
  endTokenId: number,
): Span {
  return {
    start: tokenAt(tokens, startTokenId).span.start,
    end: tokenAt(tokens, endTokenId).span.end,
  };
}
