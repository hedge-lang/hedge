import { errorDiagnostic } from "../diagnostics/index.js";
import { assert } from "../assert.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  FieldPattern,
  Identifier,
  Path,
  Pattern,
  RangePatternBound,
  RestPattern,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  kindAt,
  parseIdentifier,
  spanAt,
  tryParseLiteral,
  type PR,
} from "./parse-utils.js";
import { parsePathSegments } from "./path.js";

const sigilOnPathMessage =
  "`mut`/`&`/`&mut` sigils cannot be applied to a struct, tuple-struct, or path pattern";

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
        err(
          errorDiagnostic(
            "HEDGE-PARSE-001",
            `Expected a numeric literal after "-" in a pattern, found ${
              nextTok === undefined ? "end of input" : `"${nextTok.kind}"`
            }`,
            nextTok !== undefined ? some(nextTok.span) : spanAt(tokens, pos),
          ),
        ),
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
 * Covers every `PatternNoAlt` kind in spec 0025: binding patterns (`mut`?
 * `&`? Identifier, with an optional `@` subpattern), the wildcard `_`,
 * literal and inclusive range patterns (`1..=5`, including a leading `-`
 * on a numeric literal bound - the grammar's own `Literal` production has
 * no unary minus, so this is a deliberate pattern-only extension, not a
 * general unary expression: only `-` immediately followed by an
 * `int`/`float` token is accepted, never `-"str"` or `-x`), tuple patterns
 * (`(a, b)`), slice patterns (`[a, ..rest]`), and - via
 * `parseIdentifierRootedPattern`'s path-rooted dispatch - struct,
 * tuple-struct, and bare unit-variant path patterns.
 *
 * Grammar:
 *
 * ```text
 * PatternNoAlt ::= BindingPat | "_" | RangePat | Literal | TuplePat
 *                | SlicePat | StructPat | TupleStructPat | Path
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

  if (kindAt(tokens, pos) === "lbracket") {
    return parseSlicePattern(tokens, pos);
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
        return err(
          errorDiagnostic(
            "HEDGE-PARSE-001",
            `Expected a literal after "..=" in a range pattern, found ${
              tok === undefined ? "end of input" : `"${tok.kind}"`
            }`,
            tok !== undefined ? some(tok.span) : spanAt(tokens, afterOp),
          ),
        );
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

  return parseIdentifierRootedPattern(tokens, pos);
}

interface BindingHead {
  readonly byRef: boolean;
  readonly isMut: boolean;
  readonly afterMut: number;
  readonly ident: Identifier;
}

/**
 * Parses the optional `&`/`mut` sigils and required identifier every
 * `PatternNoAlt` identifier-rooted form starts with. `afterMut` is returned
 * alongside the already-parsed `ident` because a multi-segment path re-parses
 * from there via `parsePathSegments` rather than reusing this single-token
 * lookahead.
 */
function parseBindingHead(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<BindingHead>> {
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
  return ok({ node: { byRef, isMut, afterMut, ident }, next });
}

/**
 * Parses every `PatternNoAlt` alternative that starts with an optional
 * `&`/`&mut`/`mut` sigil followed by an identifier: a plain binding, the
 * wildcard `_`, an `@`-subpattern, or (when the sigil is absent and the
 * identifier turns out to be a `Path` - single- or multi-segment) a
 * struct/tuple-struct/bare-unit-variant pattern. Split out of
 * `parsePatternNoAlt` to keep that function's own dispatch (tuple/slice/
 * range/literal vs. this identifier-rooted case) below the complexity
 * limit - this one function covers a lot of `PatternNoAlt` grammar on its
 * own precisely because a leading identifier is so ambiguous between all
 * of these forms until enough lookahead resolves it (see grill-me Q3 in
 * the ticket record for why a bare single-segment identifier always wins
 * as a plain binding).
 */
// eslint-disable-next-line complexity -- Identifier-rooted dispatch covering BindingPat/wildcard/@-subpattern/Path-rooted forms; see doc comment above.
function parseIdentifierRootedPattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  const headResult = parseBindingHead(tokens, pos);
  if (isErr(headResult)) return headResult;
  const { byRef, isMut, afterMut, ident } = headResult.value.node;
  const next = headResult.value.next;

  // A multi-segment path (`A::B`) is only reachable without a `byRef` sigil
  // - `&A::B` isn't valid pattern grammar, since `&`/`&mut` apply only to a
  // bare BindingPat identifier, never a Path. `mut A::B` is allowed through
  // to `parsePathRootedPatternTail`, which rejects it itself if the path
  // turns out to be a fieldless bare-unit-variant `PathPattern` rather than
  // a struct/tuple-struct variant.
  if (kindAt(tokens, next) === "path_sep") {
    if (byRef) {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-006",
          sigilOnPathMessage,
          spanAt(tokens, pos),
        ),
      );
    }
    const pathResult = parsePathSegments(tokens, afterMut);
    if (isErr(pathResult)) return pathResult;
    const { node: path, next: afterPath } = pathResult.value;
    return parsePathRootedPatternTail(tokens, pos, path, afterPath, isMut);
  }

  if (ident.text === "_") {
    if (isMut || byRef) {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-006",
          byRef
            ? "`&`/`&mut` cannot be applied to the wildcard pattern `_`"
            : "`mut` cannot be applied to the wildcard pattern `_`",
          spanAt(tokens, pos),
        ),
      );
    }
    return ok({
      node: { kind: "WildcardPattern", tokenId: ident.tokenId },
      next,
    });
  }

  if (kindAt(tokens, next) === "lbrace" || kindAt(tokens, next) === "lparen") {
    if (byRef) {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-006",
          sigilOnPathMessage,
          spanAt(tokens, pos),
        ),
      );
    }
    return parsePathRootedPatternTail(
      tokens,
      pos,
      { absolute: false, segments: [ident.text] },
      next,
      isMut,
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

interface ParsedPatternList {
  readonly elements: readonly Pattern[];
  readonly next: number;
}

/**
 * Parses `"(" ( Pattern ("," Pattern)* ","? )? ")"`, given `afterParen`
 * points just past the already-confirmed `(`. Shared by `TuplePattern` and
 * `TupleStructPattern`, whose element-list grammar is identical - they
 * differ only in whether a `Path` precedes the `(` and in the resulting
 * node's `kind`. Elements are the full alternation-capable `Pattern` (via
 * `parsePattern`, not `parsePatternNoAlt`), so an or-pattern nests cleanly
 * inside an element.
 */
function parseParenthesizedPatternList(
  tokens: readonly Token[],
  afterParen: number,
): PR<ParsedPatternList> {
  let cursor = afterParen;

  if (kindAt(tokens, cursor) === "rparen") {
    return ok({ elements: [], next: cursor + 1 });
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
  return ok({ elements, next: closeResult.value });
}

/**
 * Parses `"(" ( Pattern ("," Pattern)* ","? )? ")"` as a `TuplePattern`.
 * Zero elements is the unit pattern `()`; one element (with or without a
 * trailing comma) is a genuine one-element tuple pattern - there is no
 * separate parenthesized-grouping production in the grammar to
 * disambiguate `(a)` from `(a,)`, so both parse to the same one-element
 * `TuplePattern`.
 */
function parseTuplePattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  const listResult = parseParenthesizedPatternList(tokens, pos + 1);
  if (isErr(listResult)) return listResult;
  return ok({
    node: {
      kind: "TuplePattern",
      tokenId: pos,
      elements: listResult.value.elements,
    },
    next: listResult.value.next,
  });
}

/**
 * Parses `Path "(" ( Pattern ("," Pattern)* ","? )? ")"` as a
 * `TupleStructPattern`, given the caller has already parsed `path` and
 * confirmed the `(` at `parenPos`.
 */
function parseTupleStructPattern(
  tokens: readonly Token[],
  startPos: number,
  path: Path,
  parenPos: number,
  mutable: boolean,
): PR<Parsed<Pattern>> {
  const listResult = parseParenthesizedPatternList(tokens, parenPos + 1);
  if (isErr(listResult)) return listResult;
  return ok({
    node: {
      kind: "TupleStructPattern",
      tokenId: startPos,
      path,
      mutable,
      elements: listResult.value.elements,
    },
    next: listResult.value.next,
  });
}

/**
 * Given an already-parsed `Path` at `afterPath`, dispatches to
 * `StructPattern` (`{` follows), `TupleStructPattern` (`(` follows), or a
 * bare `PathPattern` (neither follows - a unit enum variant like
 * `Message::Quit`). `mutable` (a leading `mut` sigil - see
 * `parseIdentifierRootedPattern`) is only meaningful for the first two: a
 * struct/tuple-struct pattern has fields whose binding-mode legality
 * can depend on treating the whole destructured value as
 * mutable, but a bare unit-variant `PathPattern` binds nothing at all, so
 * `mut` there has no place to apply to and is rejected instead of silently
 * dropped.
 */
function parsePathRootedPatternTail(
  tokens: readonly Token[],
  startPos: number,
  path: Path,
  afterPath: number,
  mutable: boolean,
): PR<Parsed<Pattern>> {
  if (kindAt(tokens, afterPath) === "lbrace") {
    return parseStructPattern(tokens, startPos, path, afterPath, mutable);
  }
  if (kindAt(tokens, afterPath) === "lparen") {
    return parseTupleStructPattern(tokens, startPos, path, afterPath, mutable);
  }
  if (mutable) {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-006",
        "`mut` cannot be applied to a fieldless pattern like a bare unit variant",
        spanAt(tokens, startPos),
      ),
    );
  }
  return ok({
    node: { kind: "PathPattern", tokenId: startPos, path },
    next: afterPath,
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
  mutable: boolean,
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
    node: {
      kind: "StructPattern",
      tokenId: startPos,
      path,
      mutable,
      fields,
      hasRest,
    },
    next: closeResult.value,
  });
}

/**
 * Parses `".." ( "&" "mut"? Identifier | Identifier )?` at `pos` (the
 * caller has already confirmed a `dot_dot` token there). Only the byRef
 * alternative allows an optional `mut`; a bare (non-`&`) rest binding never
 * does, per the grammar as written.
 */
function parseRestPattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<RestPattern>> {
  let cursor = pos + 1; // skip `..`

  if (kindAt(tokens, cursor) === "amp") {
    cursor += 1;
    let mutable = false;
    const maybeMutTok = tokens[cursor];
    if (maybeMutTok?.kind === "keyword" && maybeMutTok.text === "mut") {
      mutable = true;
      cursor += 1;
    }
    const nameResult = parseIdentifier(tokens, cursor);
    if (isErr(nameResult)) return nameResult;
    return ok({
      node: {
        kind: "RestPattern",
        tokenId: pos,
        byRef: true,
        mutable,
        name: some(nameResult.value.node),
      },
      next: nameResult.value.next,
    });
  }

  if (kindAt(tokens, cursor) === "ident") {
    const nameResult = parseIdentifier(tokens, cursor);
    if (isErr(nameResult)) return nameResult;
    return ok({
      node: {
        kind: "RestPattern",
        tokenId: pos,
        byRef: false,
        mutable: false,
        name: some(nameResult.value.node),
      },
      next: nameResult.value.next,
    });
  }

  return ok({
    node: {
      kind: "RestPattern",
      tokenId: pos,
      byRef: false,
      mutable: false,
      name: none(),
    },
    next: cursor,
  });
}

/**
 * Parses `"[" ( Pattern | RestPat ) ( "," ( Pattern | RestPat ) )* ","? "]"`.
 * The formal grammar in `specification/0025-grammar.md` states `RestPat` as
 * identifier-then-`..`, which contradicts both that spec chapter's own
 * prose examples (`[head, ..tail]`) and this ticket's AC; the examples win
 * (see the grill-me record for #45) and the spec's formal production was
 * corrected to match `".." ( "&" "mut"? Identifier | Identifier )?`. At
 * most one `RestPattern` element is semantically meaningful, but this
 * parser does not enforce that arity - `[a, .., b, .., c]` parses without
 * complaint; rejecting multiple rest patterns is deferred to semantic
 * analysis, matching how binding-mode/or-pattern consistency is also out of
 * this parser's scope.
 */
function parseSlicePattern(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Pattern>> {
  let cursor = pos + 1; // skip `[`
  const elements: (Pattern | RestPattern)[] = [];

  if (kindAt(tokens, cursor) === "rbracket") {
    return ok({
      node: { kind: "SlicePattern", tokenId: pos, elements: [] },
      next: cursor + 1,
    });
  }

  for (;;) {
    if (kindAt(tokens, cursor) === "dot_dot") {
      const restResult = parseRestPattern(tokens, cursor);
      if (isErr(restResult)) return restResult;
      elements.push(restResult.value.node);
      cursor = restResult.value.next;
    } else {
      const elementResult = parsePattern(tokens, cursor);
      if (isErr(elementResult)) return elementResult;
      elements.push(elementResult.value.node);
      cursor = elementResult.value.next;
    }

    if (kindAt(tokens, cursor) === "comma") {
      cursor += 1;
      if (kindAt(tokens, cursor) === "rbracket") break; // trailing comma
      continue;
    }
    break;
  }

  const closeResult = expect(tokens, cursor, "rbracket");
  if (isErr(closeResult)) return closeResult;
  return ok({
    node: { kind: "SlicePattern", tokenId: pos, elements },
    next: closeResult.value,
  });
}
