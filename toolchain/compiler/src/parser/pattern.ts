import { assert } from "../assert.js";
import type { Token } from "../lexer/token.js";
import { err, isErr, ok, unwrapOk } from "../result.js";
import type { Pattern } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  kindAt,
  parseIdentifier,
  spanAt,
  unsupportedPatternMessage,
  type PR,
} from "./parse-utils.js";

/**
 * Parses a pattern.
 *
 * Slice 1 only supports binding patterns (`mut`? Identifier) and the
 * wildcard `_`. Struct/tuple/tuple-struct/slice/literal/range patterns are
 * recognized by the grammar but belong to Slice 3.
 *
 * Grammar:
 *
 * ```text
 * Pattern ::= "mut"? Identifier | "_"
 * ```
 */
export function parsePattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
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
  const { node: ident, next } = unwrapOk(identResult);

  if (ident.text === "_") {
    if (isMut) {
      return err({
        severity: "error",
        message: "`mut` cannot be applied to the wildcard pattern `_`",
        span: spanAt(tokens, pos),
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
