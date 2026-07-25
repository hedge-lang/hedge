import { assert } from "../assert.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Pattern, RangePatternBound } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  kindAt,
  parseIdentifier,
  spanAt,
  tryParseLiteral,
  unsupportedPatternMessage,
  type PR,
} from "./parse-utils.js";

/**
 * Tries to parse a pattern-literal bound (an optional leading `-` on a
 * numeric literal, or a bare literal) at `pos`. `none()` means `pos` is not
 * the start of a literal bound at all (fall through to another pattern
 * kind); `some(Err(...))` means it looked like one but was malformed (e.g.
 * `-` not followed by a numeric literal) and the caller should bubble the
 * error up rather than keep falling through. Shared by the standalone
 * `LiteralPattern` case and both ends of a `RangePattern`.
 */
function tryParseRangePatternBound(
  tokens: readonly Token[],
  pos: number,
): Option<PR<Parsed<RangePatternBound>>> {
  if (tokens[pos]?.kind === "minus") {
    const afterMinus = pos + 1;
    const nextTok = tokens[afterMinus];
    if (nextTok?.kind !== "int" && nextTok?.kind !== "float") {
      return some(
        err({
          severity: "error",
          message: `Expected a numeric literal after "-" in a pattern, found ${
            nextTok === undefined ? "end of input" : `"${nextTok.kind}"`
          }`,
          span:
            nextTok !== undefined ? some(nextTok.span) : spanAt(tokens, pos),
          code: none(),
          relatedSpans: [],
        }),
      );
    }
    const literalResult = tryParseLiteral(tokens, afterMinus);
    assert(
      isSome(literalResult),
      "tryParseLiteral failed on a token already confirmed int/float",
    );
    const { node: literal, next } = literalResult.value;
    return some(ok({ node: { negative: true, literal }, next }));
  }

  const literalResult = tryParseLiteral(tokens, pos);
  if (isSome(literalResult)) {
    const { node: literal, next } = literalResult.value;
    return some(ok({ node: { negative: false, literal }, next }));
  }

  return none();
}

/**
 * Parses a pattern, including top-level `|` alternation.
 *
 * Grammar:
 *
 * ```text
 * Pattern ::= PatternNoAlt ("|" PatternNoAlt)*
 * ```
 *
 * A single alternative (no `|`) returns that alternative directly, never a
 * one-element `OrPattern` - `OrPattern` only exists when there is a real
 * alternation. The result is always a flat list, never right-nested: each
 * `|`-separated alternative is appended to one `alternatives` array rather
 * than becoming a nested `OrPattern` in the tail position.
 */
export function parsePattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  const firstResult = parsePatternNoAlt(tokens, pos);
  if (isErr(firstResult)) return firstResult;
  const first = firstResult.value.node;
  let cursor = firstResult.value.next;

  const rest: Pattern[] = [];
  while (kindAt(tokens, cursor) === "pipe") {
    const afterPipe = cursor + 1;
    const altResult = parsePatternNoAlt(tokens, afterPipe);
    if (isErr(altResult)) return altResult;
    rest.push(altResult.value.node);
    cursor = altResult.value.next;
  }

  if (rest.length === 0) {
    return ok({ node: first, next: cursor });
  }
  return ok({
    node: { kind: "OrPattern", tokenId: pos, alternatives: [first, ...rest] },
    next: cursor,
  });
}

/**
 * Parses a single pattern alternative (no top-level `|`).
 *
 * Slice 1 supports binding patterns (`mut`? Identifier), the wildcard `_`,
 * and (Slice 3) bare literal patterns and inclusive range patterns
 * (`1..=5`), including a leading `-` on a numeric literal bound (`-1`,
 * `-5..=-1`) - the grammar's own `Literal` production has no unary minus,
 * so this is a deliberate pattern-only extension, not a general unary
 * expression: only `-` immediately followed by an `int`/`float` token is
 * accepted, never `-"str"` or `-x`. Struct/tuple/tuple-struct/slice
 * patterns are recognized by the grammar but not yet implemented here.
 *
 * Grammar:
 *
 * ```text
 * PatternNoAlt ::= "mut"? Identifier | "_" | RangePat | Literal
 * RangePat ::= ("-"? Literal) "..=" ("-"? Literal)
 * ```
 */
function parsePatternNoAlt(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  const startAttempt = tryParseRangePatternBound(tokens, pos);
  if (isSome(startAttempt)) {
    if (isErr(startAttempt.value)) return startAttempt.value;
    const { node: start, next } = startAttempt.value.value;

    if (kindAt(tokens, next) === "dot_dot_eq") {
      const afterOp = next + 1;
      const endAttempt = tryParseRangePatternBound(tokens, afterOp);
      if (!isSome(endAttempt)) {
        const tok = tokens[afterOp];
        return err({
          severity: "error",
          message: `Expected a literal after "..=" in a range pattern, found ${
            tok === undefined ? "end of input" : `"${tok.kind}"`
          }`,
          span: tok !== undefined ? some(tok.span) : spanAt(tokens, afterOp),
          code: none(),
          relatedSpans: [],
        });
      }
      if (isErr(endAttempt.value)) return endAttempt.value;
      const { node: end, next: afterEnd } = endAttempt.value.value;
      return ok({
        node: { kind: "RangePattern", tokenId: pos, start, end },
        next: afterEnd,
      });
    }

    return ok({
      node: {
        kind: "LiteralPattern",
        tokenId: pos,
        negative: start.negative,
        literal: start.literal,
      },
      next,
    });
  }

  const maybeMut = tokens[pos];
  const isMut =
    maybeMut !== undefined &&
    maybeMut.kind === "keyword" &&
    maybeMut.text === "mut";
  const afterMut = isMut ? pos + 1 : pos;

  const identResult = parseIdentifier(tokens, afterMut);
  if (isErr(identResult)) {
    if (isMut) {
      // Re-anchor at `mut` itself so `let mut = 1;` still gets
      // parseIdentifier's friendly MUT_MESSAGE (it only special-cases `mut`
      // when `pos` points directly at that token) rather than a generic
      // "expected identifier" error pointing past it.
      const retry = parseIdentifier(tokens, pos);
      assert(
        isErr(retry),
        "parseIdentifier failed on a token that was already parsed successfully",
      );
      return retry;
    }
    return identResult;
  }
  const { node: ident, next } = identResult.value;

  if (ident.text === "_") {
    if (isMut) {
      return err({
        severity: "error",
        message: "`mut` cannot be applied to the wildcard pattern `_`",
        span: spanAt(tokens, pos),
        code: none(),
        relatedSpans: [],
      });
    }
    return ok({
      node: { kind: "WildcardPattern", tokenId: ident.tokenId },
      next,
    });
  }

  if (kindAt(tokens, next) === "lbrace") {
    return err({
      severity: "error",
      message: unsupportedPatternMessage("struct patterns"),
      span: spanAt(tokens, ident.tokenId),
      code: none(),
      relatedSpans: [],
    });
  }

  return ok({
    node: {
      kind: "BindingPattern",
      tokenId: isMut ? pos : ident.tokenId,
      mutable: isMut,
      name: ident,
    },
    next,
  });
}
