import { assert } from "../assert.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { FieldPattern, Path, Pattern, RangePatternBound } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  kindAt,
  parseIdentifier,
  spanAt,
  tryParseLiteral,
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
 * and (Slice 3) bare literal patterns, inclusive range patterns (`1..=5`,
 * including a leading `-` on a numeric literal bound), and tuple patterns
 * (`(a, b)`) - the grammar's own `Literal` production has no unary minus,
 * so a leading `-` is a deliberate pattern-only extension, not a general
 * unary expression: only `-` immediately followed by an `int`/`float`
 * token is accepted, never `-"str"` or `-x`. Struct/tuple-struct/slice
 * patterns are recognized by the grammar but not yet implemented here.
 *
 * Grammar:
 *
 * ```text
 * PatternNoAlt ::= "mut"? Identifier | "_" | RangePat | Literal | TuplePat
 * RangePat ::= ("-"? Literal) "..=" ("-"? Literal)
 * TuplePat ::= "(" ( Pattern ("," Pattern)* ","? )? ")"
 * ```
 */
function parsePatternNoAlt(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  if (kindAt(tokens, pos) === "lparen") {
    return parseTuplePattern(tokens, pos);
  }

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

  const byRef = tokens[pos]?.kind === "amp";
  const afterAmp = byRef ? pos + 1 : pos;

  const maybeMut = tokens[afterAmp];
  const isMut =
    maybeMut !== undefined &&
    maybeMut.kind === "keyword" &&
    maybeMut.text === "mut";
  const afterMut = isMut ? afterAmp + 1 : afterAmp;

  const identResult = parseIdentifier(tokens, afterMut);
  if (isErr(identResult)) {
    if (isMut) {
      // Re-anchor at `mut` itself (afterAmp, since `&mut` may precede it) so
      // `let mut = 1;`/`let &mut = 1;` still get parseIdentifier's friendly
      // MUT_MESSAGE (it only special-cases `mut` when `pos` points directly
      // at that token) rather than a generic "expected identifier" error
      // pointing past it.
      const retry = parseIdentifier(tokens, afterAmp);
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
    if (isMut || byRef) {
      return err({
        severity: "error",
        message: byRef
          ? "`&`/`&mut` cannot be applied to the wildcard pattern `_`"
          : "`mut` cannot be applied to the wildcard pattern `_`",
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
    if (isMut || byRef) {
      return err({
        severity: "error",
        message: "`mut`/`&`/`&mut` sigils cannot be applied to a struct pattern",
        span: spanAt(tokens, pos),
        code: none(),
        relatedSpans: [],
      });
    }
    return parseStructPattern(
      tokens,
      pos,
      { absolute: false, segments: [ident.text] },
      next,
    );
  }

  const bindingTokenId = isMut || byRef ? pos : ident.tokenId;

  if (kindAt(tokens, next) === "at") {
    const subResult = parsePatternNoAlt(tokens, next + 1);
    if (isErr(subResult)) return subResult;
    return ok({
      node: {
        kind: "BindingPattern",
        tokenId: bindingTokenId,
        mutable: isMut,
        byRef,
        name: ident,
        subpattern: some(subResult.value.node),
      },
      next: subResult.value.next,
    });
  }

  return ok({
    node: {
      kind: "BindingPattern",
      tokenId: bindingTokenId,
      mutable: isMut,
      byRef,
      name: ident,
      subpattern: none(),
    },
    next,
  });
}

/**
 * Parses `"(" ( Pattern ("," Pattern)* ","? )? ")"`. Zero elements is the
 * unit pattern `()`; one element (with or without a trailing comma) is a
 * genuine one-element tuple pattern - there is no separate parenthesized-
 * grouping production in the grammar to disambiguate `(a)` from `(a,)`, so
 * both parse to the same one-element `TuplePattern`. Elements are the full
 * alternation-capable `Pattern` (via `parsePattern`, not `parsePatternNoAlt`),
 * so an or-pattern nests cleanly inside a tuple element.
 */
function parseTuplePattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  let cursor = pos + 1; // skip `(`

  if (kindAt(tokens, cursor) === "rparen") {
    return ok({
      node: { kind: "TuplePattern", tokenId: pos, elements: [] },
      next: cursor + 1,
    });
  }

  const elements: Pattern[] = [];
  for (;;) {
    const elementResult = parsePattern(tokens, cursor);
    if (isErr(elementResult)) return elementResult;
    elements.push(elementResult.value.node);
    cursor = elementResult.value.next;

    if (kindAt(tokens, cursor) === "comma") {
      cursor += 1;
      if (kindAt(tokens, cursor) === "rparen") break; // trailing comma
      continue;
    }
    break;
  }

  const closeResult = expect(tokens, cursor, "rparen");
  if (isErr(closeResult)) return closeResult;
  return ok({
    node: { kind: "TuplePattern", tokenId: pos, elements },
    next: closeResult.value,
  });
}

/**
 * Parses `"{" ( FieldPat ("," FieldPat)* )? ( ","? ".." )? "}"`, given the
 * caller has already parsed `path` and confirmed the `{` at `bracePos`.
 * `FieldPat ::= Identifier (":" Pattern)?` - shorthand (`x`, binds a new
 * `x`) or an explicit sub-pattern (`x: pattern`). A trailing `..` must be
 * the last thing before `}`; it is not itself a `FieldPat`.
 */
function parseStructPattern(
  tokens: readonly Token[],
  startPos: number,
  path: Path,
  bracePos: number,
): PR<Parsed<Pattern>> {
  let cursor = bracePos + 1; // skip `{`
  const fields: FieldPattern[] = [];
  let hasRest = false;

  while (kindAt(tokens, cursor) !== "rbrace") {
    if (kindAt(tokens, cursor) === "dot_dot") {
      hasRest = true;
      cursor += 1;
      break;
    }

    const nameResult = parseIdentifier(tokens, cursor);
    if (isErr(nameResult)) return nameResult;
    const { node: name, next: afterName } = nameResult.value;

    let fieldPattern: Option<Pattern> = none();
    let afterField = afterName;
    if (kindAt(tokens, afterName) === "colon") {
      const patResult = parsePattern(tokens, afterName + 1);
      if (isErr(patResult)) return patResult;
      fieldPattern = some(patResult.value.node);
      afterField = patResult.value.next;
    }

    fields.push({
      kind: "FieldPattern",
      tokenId: name.tokenId,
      name,
      pattern: fieldPattern,
    });
    cursor = afterField;

    if (kindAt(tokens, cursor) === "comma") {
      cursor += 1;
      continue;
    }
    break;
  }

  const closeResult = expect(tokens, cursor, "rbrace");
  if (isErr(closeResult)) return closeResult;
  return ok({
    node: { kind: "StructPattern", tokenId: startPos, path, fields, hasRest },
    next: closeResult.value,
  });
}
