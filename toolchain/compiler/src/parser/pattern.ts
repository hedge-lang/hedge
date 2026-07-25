import { assert } from "../assert.js";
import type { Token } from "../lexer/token.js";
import { isSome, none } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Pattern } from "./ast.js";
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
 * Parses a pattern.
 *
 * Slice 1 supports binding patterns (`mut`? Identifier), the wildcard `_`,
 * and (Slice 3) bare literal patterns. Struct/tuple/tuple-struct/slice/range
 * patterns are recognized by the grammar but not yet implemented here.
 *
 * Grammar:
 *
 * ```text
 * Pattern ::= "mut"? Identifier | "_" | Literal
 * ```
 */
export function parsePattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  const literalResult = tryParseLiteral(tokens, pos);
  if (isSome(literalResult)) {
    const { node: literal, next } = literalResult.value;
    return ok({
      node: { kind: "LiteralPattern", tokenId: pos, literal },
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
