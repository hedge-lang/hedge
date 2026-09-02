import {
  type Diagnostic,
  type DiagnosticKind,
  errorDiagnostic,
  messageOf,
  renderDiagnosticMessage,
} from "../diagnostics/index.js";
import { resolveEscape } from "../lexer/escape.js";
import type {
  FloatToken,
  IntToken,
  KeywordToken,
  PathSepToken,
  Span,
  Token,
  TokenKind,
} from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok, type Result } from "../result.js";
import type {
  BoolLiteral,
  CharLiteral,
  FloatLiteral,
  Identifier,
  IntLiteral,
  StringLiteral,
} from "./ast.js";
import type { Parsed } from "./parse.js";

/** Internal shorthand for Result-threaded parser returns. */
export type PR<T> = Result<T, Diagnostic>;

/**
 * @returns the token at {@link pos}, or else a {@link Diagnostic} if the
 * parser attempts to read beyond the end of the token stream.
 */
export function tokenAt(tokens: readonly Token[], pos: number): PR<Token> {
  const token = tokens[pos];
  if (token === undefined) {
    return err(
      errorDiagnostic(
        { kind: "ParseUnexpectedEndOfInputAtToken", token: pos },
        none(),
      ),
    );
  }
  return ok(token);
}

/**
 * @returns The kind of the token at `pos`, or `undefined` past the end of input.
 */
export function kindAt(
  tokens: readonly Token[],
  pos: number,
): TokenKind | undefined {
  return tokens[pos]?.kind;
}

/**
 * @returns The span of the token at `pos`, if one exists.
 */
export function spanAt(tokens: readonly Token[], pos: number): Option<Span> {
  const token = tokens[pos];
  return token !== undefined ? some(token.span) : none();
}

/**
 * Consumes a required token of the given kind.
 *
 * @returns Index of the next token, or `Err` if the token at `pos` is not of the expected kind.
 */
export function expect(
  tokens: readonly Token[],
  pos: number,
  kind: TokenKind,
): PR<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== kind) {
    return err(
      errorDiagnostic(
        {
          kind: "ParseExpectedFound",
          expected: kind,
          found: token.kind,
          offset: token.span.start,
        },
        some(token.span),
      ),
    );
  }
  return ok(pos + 1);
}

/**
 * Consumes a required keyword token.
 *
 * @returns Index of the next token after the keyword, or `Err` if the expected keyword is not present.
 */
export function expectKeyword(
  tokens: readonly Token[],
  pos: number,
  text: string,
): PR<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== "keyword" || token.text !== text) {
    const found = token.kind === "keyword" ? token.text : token.kind;
    return err(
      errorDiagnostic(
        {
          kind: "ParseExpectedKeyword",
          keyword: text,
          found,
          offset: token.span.start,
        },
        some(token.span),
      ),
    );
  }
  return ok(pos + 1);
}

function stripPrefix(text: string, radix: 2 | 8 | 10 | 16): string {
  if (radix !== 10) return text.slice(2); // strip 0x / 0o / 0b
  return text;
}

function stripUnderscores(text: string): string {
  return text.replaceAll("_", "");
}

/**
 * True for a deliberate, permanent, fail-fast rejection of syntax that is
 * recognized but not yet implemented, or reserved (`mut` as an identifier,
 * `dyn` naming a lifetime, ...). Every such site emits `HEDGE-PARSE-004`, so
 * the code alone is the discriminator. List-element panic-mode recovery must
 * never swallow one - that would retrofit recovery onto a guardrail the rest
 * of the suite pins as a total parse failure.
 */
export function isGuardrailDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.code === "HEDGE-PARSE-004";
}

const LOOP_KEYWORDS: ReadonlySet<string> = new Set(["loop", "while", "for"]);

export interface LoopKeywordMatch {
  readonly pos: number;
  readonly token: KeywordToken;
}

/**
 * If a `loop`/`while`/`for` construct - optionally label-prefixed
 * (`'name: loop {}`) - starts at `pos`, returns the position and token of
 * the `loop`/`while`/`for` keyword. Otherwise `none()`.
 */
export function loopKeywordAt(
  tokens: readonly Token[],
  pos: number,
): Option<LoopKeywordMatch> {
  const token = tokens[pos];
  if (token?.kind === "keyword" && LOOP_KEYWORDS.has(token.text)) {
    return some({ pos, token });
  }
  if (token?.kind === "lifetime") {
    const colonTok = tokens[pos + 1];
    const keywordTok = tokens[pos + 2];
    if (
      colonTok?.kind === "colon" &&
      keywordTok?.kind === "keyword" &&
      LOOP_KEYWORDS.has(keywordTok.text)
    ) {
      return some({ pos: pos + 2, token: keywordTok });
    }
  }
  return none();
}

/**
 * True at the exact unlabeled `while` `let` token sequence: the only
 * `while` form the parser currently supports. Checked against the raw
 * token position (never `loopKeywordAt`'s label-resolved position), so a
 * label-prefixed `'outer: while let ...` deliberately still falls through
 * to the ordinary loop guardrail unchanged; labels aren't supported yet.
 * Shared by `expression.ts`'s `parsePrimary` (nested-expression position)
 * and `statement.ts`'s block-statement dispatch, so both carve-outs agree.
 */
export function isWhileLetAt(tokens: readonly Token[], pos: number): boolean {
  const whileTok = tokens[pos];
  const letTok = tokens[pos + 1];
  return (
    whileTok?.kind === "keyword" &&
    whileTok.text === "while" &&
    letTok?.kind === "keyword" &&
    letTok.text === "let"
  );
}

const PATH_KEYWORDS: ReadonlySet<string> = new Set(["self", "super", "Self"]);

/**
 * @returns The token at `pos` if it is `self`/`super`/`Self`.
 */
export function pathKeywordAt(
  tokens: readonly Token[],
  pos: number,
): Option<KeywordToken> {
  const token = tokens[pos];
  if (token?.kind === "keyword" && PATH_KEYWORDS.has(token.text)) {
    return some(token);
  }
  return none();
}

/**
 * @returns true if the token immediately after a `<` at `ltPos` is a
 * lifetime token.
 */
export function isLifetimeGenericsStart(
  tokens: readonly Token[],
  ltPos: number,
): boolean {
  return tokens[ltPos + 1]?.kind === "lifetime";
}

/**
 * @returns the `::` token if `tokens[pos]` is a turbofish (`::<...>`).
 */
export function pathSepBeforeLt(
  tokens: readonly Token[],
  pos: number,
): Option<PathSepToken> {
  const token = tokens[pos];
  if (token?.kind === "path_sep" && tokens[pos + 1]?.kind === "lt") {
    return some(token);
  }
  return none();
}

export interface SkipAngleListResult {
  readonly next: number;
  readonly closed: boolean;
}

/**
 * Skips a balanced `<...>` list starting at `ltPos` (the caller has already
 * confirmed `tokens[ltPos]` is a `lt` token). Counts `lt`/`gt` as depth +/-1
 * and `lt_lt`/`gt_gt` as depth +/-2, since `>>` lexes as a single `gt_gt`
 * token under maximal munch (see lexer/symbol.ts) - a naive one-token-at-a-
 * time count would never see the second `>` of a doubly-nested close.
 */
// eslint-disable-next-line complexity -- Token-kind dispatch loop; each branch is a necessary depth-counting case.
export function skipBalancedAngleList(
  tokens: readonly Token[],
  ltPos: number,
): SkipAngleListResult {
  let cursor = ltPos;
  let depth = 0;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof") {
      return { next: cursor, closed: false };
    }
    if (tok.kind === "lt") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (tok.kind === "lt_lt") {
      depth += 2;
      cursor += 1;
      continue;
    }
    if (tok.kind === "gt") {
      depth -= 1;
      cursor += 1;
      if (depth <= 0) return { next: cursor, closed: true };
      continue;
    }
    if (tok.kind === "gt_gt") {
      depth -= 2;
      cursor += 1;
      if (depth <= 0) return { next: cursor, closed: true };
      continue;
    }
    if (tok.kind === "semi" || tok.kind === "lbrace" || tok.kind === "lparen") {
      return { next: cursor, closed: false };
    }
    cursor += 1;
  }
}

/** A parse position paired with whether it sits on a `gt_gt` token whose
 * first `>` was already spent closing a nested list (see
 * `tryCloseAngleList`). Threaded through any family of nested `<...>` list
 * parsers so a triply-nested close (`Foo<Bar<Baz>>>`) splits its `>>>` one
 * `>` at a time, without splitting a token. Always `false` once the
 * outermost list's own parse returns. */
export interface GenericsCursor {
  readonly next: number;
  readonly pendingCloseHalf: boolean;
}

export interface GenericsCloseResult {
  readonly closed: boolean;
  readonly cursor: GenericsCursor;
}

/**
 * Checks whether a `<...>` list closes at `pos`. A `gt` token closes it
 * outright. A `gt_gt` token (one token under maximal munch - see
 * lexer/symbol.ts) closes using only its first `>` when `pendingCloseHalf`
 * is false, without advancing - its second `>` is still owed to whichever
 * enclosing list closes next at this position. When `pendingCloseHalf` is
 * true, that owed `>` closes for real, advancing past the token.
 */
export function tryCloseAngleList(
  tokens: readonly Token[],
  pos: number,
  pendingCloseHalf: boolean,
): GenericsCloseResult {
  if (pendingCloseHalf) {
    return { closed: true, cursor: { next: pos + 1, pendingCloseHalf: false } };
  }
  const tok = tokens[pos];
  if (tok?.kind === "gt") {
    return { closed: true, cursor: { next: pos + 1, pendingCloseHalf: false } };
  }
  if (tok?.kind === "gt_gt") {
    return { closed: true, cursor: { next: pos, pendingCloseHalf: true } };
  }
  return { closed: false, cursor: { next: pos, pendingCloseHalf: false } };
}

/**
 * Scans forward from `pos` to the first token matching `predicate`, or to
 * `eof` if none matches. The `eof` check is unconditional (independent of
 * `predicate`), so every call terminates at or before the trailing `eof`
 * sentinel regardless of what the predicate does.
 */
export function skipUntil(
  tokens: readonly Token[],
  pos: number,
  predicate: (token: Token) => boolean,
): number {
  let cursor = pos;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof" || predicate(tok)) {
      return cursor;
    }
    cursor += 1;
  }
}

/**
 * Scans forward from `pos` to the first token whose `kind` is one of `kinds`.
 */
export function skipUntilKind(
  tokens: readonly Token[],
  pos: number,
  ...kinds: readonly TokenKind[]
): number {
  const kindSet = new Set(kinds);
  return skipUntil(tokens, pos, (tok) => kindSet.has(tok.kind));
}

/**
 * @returns the nesting-depth contribution of a single token: +1/-1 for
 * `(`/`)`, `[`/`]`, `{`/`}`, and `<`/`>`; +/-2 for `lt_lt`/`gt_gt`, since `>>`
 * lexes as one `gt_gt` token under maximal munch (see `skipBalancedAngleList`,
 * which uses the same technique) - a naive one-token count would never see
 * the second `>` of a doubly-nested generic close. 0 for everything else.
 */
function delimiterDepthDelta(kind: TokenKind): number {
  switch (kind) {
    case "lparen":
    case "lbracket":
    case "lbrace":
    case "lt":
      return 1;
    case "lt_lt":
      return 2;
    case "rparen":
    case "rbracket":
    case "rbrace":
    case "gt":
      return -1;
    case "gt_gt":
      return -2;
    default:
      return 0;
  }
}

/**
 * Scans forward from `pos` to the first token of one of `kinds` at the same
 * nesting depth as `pos` itself - tracking `(`/`[`/`{`/`<` depth so a token
 * nested inside them is never mistaken for the enclosing list's own comma or
 * closing delimiter. Two concrete cases this guards against: the closing `)`
 * of an attribute's own `#[attr(1.5)]` argument list, and a comma inside a
 * generic argument list (`x<A, B>, y: i32` - without `<`/`>` tracking, the
 * scan would stop at the comma between `A` and `B` instead of the one after
 * `>`). `skipUntilKind` is unsafe for list-element recovery for exactly this
 * reason; use this instead whenever the scanned span can contain its own
 * nested delimiters. All four delimiter kinds share one `depth` counter
 * rather than a separate stack per kind, so a genuinely mismatched mix
 * (e.g. `(` opened, `>` closed) can under- or over-count relative to a true
 * per-kind balance check - an accepted imprecise-but-safe tradeoff on
 * malformed input, matching this file's other recovery helpers.
 */
export function skipUntilKindBalanced(
  tokens: readonly Token[],
  pos: number,
  ...kinds: readonly TokenKind[]
): number {
  const kindSet = new Set(kinds);
  let depth = 0;
  let cursor = pos;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof") {
      return cursor;
    }
    if (depth === 0 && kindSet.has(tok.kind)) {
      return cursor;
    }
    depth = Math.max(0, depth + delimiterDepthDelta(tok.kind));
    cursor += 1;
  }
}

/**
 * Scans forward from `pos` to the next token that can start a top-level item
 * (`fn`/`struct`/`let`/`pub`/...). Matching the full set - not just
 * `fn`/`struct`/`let` - matters: it lets recovery resume from `pub` in a
 * `pub fn`/`pub struct`, rather than landing past it and silently losing the
 * item's visibility.
 */
export function skipToItemStartKeyword(
  tokens: readonly Token[],
  pos: number,
): number {
  return skipUntil(
    tokens,
    pos,
    (tok) => tok.kind === "keyword" && ITEM_START_KEYWORDS.has(tok.text),
  );
}

/**
 * Skips a `{ ... }` span starting at `openBrace`, purely by counting
 * `lbrace`/`rbrace` tokens; never string/char literal contents, so braces
 * inside a string can't desync the count. Returns the index just past the
 * matching `}`.
 */
export function skipBalancedBraceBlock(
  tokens: readonly Token[],
  openBrace: number,
): PR<number> {
  const openBraceToken = tokens[openBrace];
  if (openBraceToken?.kind !== "lbrace") {
    return err(
      errorDiagnostic(
        {
          kind: "ParseExpectedBraceToStartBlockFound",
          found: openBraceToken?.kind ?? "MISSING",
        },
        openBraceToken ? some(openBraceToken.span) : none(),
      ),
    );
  }
  let cursor = openBrace;
  let braceDepth = 0;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof") {
      return err(
        errorDiagnostic(
          { kind: "ParseExpectedCloseBraceEofInBlock" },
          some(openBraceToken.span),
        ),
      );
    }
    if (tok.kind === "lbrace") {
      braceDepth += 1;
    }
    if (tok.kind === "rbrace") {
      braceDepth -= 1;
    }
    cursor += 1;
    if (braceDepth === 0) {
      return ok(cursor);
    }
  }
}

const ITEM_START_KEYWORDS: ReadonlySet<string> = new Set([
  "fn",
  "struct",
  "let",
  "pub",
  "enum",
  "export",
  "extern",
  "impl",
  "trait",
]);

/** True for a token that starts a new item declaration - signals that
 * whatever construct precedes it must have already ended. */
export function isItemStartKeyword(tok: Token): boolean {
  return tok.kind === "keyword" && ITEM_START_KEYWORDS.has(tok.text);
}

/**
 * True for tokens that can never legally appear inside a `where`-clause
 * bound list (paths, `:`, `,`, `<...>`).
 */
function isWhereClauseBoundary(tok: Token): boolean {
  return tok.kind === "rbrace" || isItemStartKeyword(tok);
}

/**
 * Scans forward to the next `{`, for skipping a rejected `where` clause on a
 * function (a function's body always starts with one). Bails at `;` or an
 * {@link isWhereClauseBoundary} token: if the clause has no body, the caller's
 * own body-parsing step will fail cleanly there instead of this scan silently
 * absorbing a sibling item's body.
 */
export function skipToFunctionBody(
  tokens: readonly Token[],
  pos: number,
): number {
  let cursor = pos;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof" || tok.kind === "lbrace") {
      return cursor;
    }
    if (tok.kind === "semi" || isWhereClauseBoundary(tok)) {
      return cursor;
    }
    cursor += 1;
  }
}

/**
 * Scans forward to a struct's body start, for skipping a rejected `where`
 * clause on a struct. Unlike a function, a struct's body can start with
 * `{`, `(`, or `;` (a unit struct). Bails at an
 * {@link isWhereClauseBoundary} token.
 *
 * Also reused for `enum`: its body is always brace-delimited, one of the
 * shapes already handled here.
 */
export function skipToStructBody(
  tokens: readonly Token[],
  pos: number,
): number {
  let cursor = pos;
  for (;;) {
    const tok = tokens[cursor];
    if (
      tok === undefined ||
      tok.kind === "eof" ||
      tok.kind === "lbrace" ||
      tok.kind === "lparen" ||
      tok.kind === "semi"
    ) {
      return cursor;
    }
    if (isWhereClauseBoundary(tok)) {
      return cursor;
    }
    cursor += 1;
  }
}

interface TopLevelBodyStart {
  readonly kind: "brace" | "semi";
  readonly pos: number;
}

/**
 * Scans forward from a rejected top-level declaration keyword for its body
 * start, tracking `(`/`[` depth so a `fn`'s parameter list (reachable for
 * `export`/`extern` linkage and `async fn`, which all prefix a function)
 * isn't mistaken for the body. Returns `undefined` at end of input.
 */
function findTopLevelItemBodyStart(
  tokens: readonly Token[],
  pos: number,
): TopLevelBodyStart | undefined {
  let cursor = pos;
  let depth = 0;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof") {
      return undefined;
    }
    if (depth === 0 && tok.kind === "lbrace") {
      return { kind: "brace", pos: cursor };
    }
    if (depth === 0 && tok.kind === "semi") {
      return { kind: "semi", pos: cursor };
    }
    if (tok.kind === "lparen" || tok.kind === "lbracket") depth += 1;
    if (tok.kind === "rparen" || tok.kind === "rbracket") {
      depth = Math.max(0, depth - 1);
    }
    cursor += 1;
  }
}

/**
 * Recovers from a rejected top-level declaration keyword (`enum`, `export`,
 * `extern`, `impl`, `trait`, `async`, `use`, `mod`) so a sibling item after
 * it still parses: either a brace-delimited body (`enum`/`trait`/`impl`/
 * `extern` block, or a `fn` body), which is skipped as a balanced span, or a
 * bare `;` (a linkage/`use`/`mod` declaration with no body), which is
 * skipped past directly.
 */
export function skipUnsupportedTopLevelItem(
  tokens: readonly Token[],
  keyword: KeywordToken,
  pos: number,
  guardrail: DiagnosticKind,
): PR<{ diagnostic: Diagnostic; next: number }> {
  const diagnostic = errorDiagnostic(guardrail, some(keyword.span));

  const bodyStart = findTopLevelItemBodyStart(tokens, pos);
  if (bodyStart === undefined) {
    return err(
      errorDiagnostic(
        {
          kind: "ParseGuardrailThen",
          guardrail: renderDiagnosticMessage(guardrail),
          rest: `expected a body for \`${keyword.text}\`, found end of input`,
        },
        some(keyword.span),
      ),
    );
  }
  if (bodyStart.kind === "semi") {
    return ok({ diagnostic, next: bodyStart.pos + 1 });
  }
  const nextResult = skipBalancedBraceBlock(tokens, bodyStart.pos);
  if (isErr(nextResult)) {
    return err({
      ...nextResult.error,
      kind: {
        kind: "ParseGuardrailThen",
        guardrail: renderDiagnosticMessage(guardrail),
        rest: messageOf(nextResult.error),
      },
      span: some(keyword.span),
    });
  }
  return ok({ diagnostic, next: nextResult.value });
}

/**
 * Parses an identifier expression.
 *
 * Grammar:
 *
 * ```text
 * Identifier ::= IDENT
 * ```
 */
export function parseIdentifier(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Identifier>> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind === "keyword" && token.text === "mut") {
    return err(
      errorDiagnostic(
        { kind: "ParseMutReservedIdentifier" },
        some({ start: token.span.start, end: token.span.end }),
      ),
    );
  }

  if (token.kind !== "ident") {
    const found =
      token.kind === "keyword" ? `keyword "${token.text}"` : `"${token.kind}"`;
    return err(
      errorDiagnostic(
        {
          kind: "ParseExpectedIdentifierFound",
          found,
          offset: token.span.start,
        },
        some(token.span),
      ),
    );
  }
  const ident: Identifier = {
    kind: "Identifier",
    tokenId: pos,
    text: token.text,
  };
  return ok({ node: ident, next: pos + 1 });
}

export function parseIntLiteral(
  pos: number,
  token: IntToken,
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

export function parseFloatLiteral(
  pos: number,
  token: FloatToken,
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

export type LiteralToken =
  StringLiteral | IntLiteral | FloatLiteral | CharLiteral | BoolLiteral;

/**
 * Recognizes a bare literal token (string/int/float/char/bool) at `pos`.
 * Shared by expression primary parsing and pattern literal parsing so the
 * two never drift on which token kinds count as a literal.
 */
export function tryParseLiteral(
  tokens: readonly Token[],
  pos: number,
): Option<Parsed<LiteralToken>> {
  const token = tokens[pos];
  if (token === undefined) return none();
  if (token.kind === "string") {
    return some({
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    });
  }
  if (token.kind === "int") return some(parseIntLiteral(pos, token));
  if (token.kind === "float") return some(parseFloatLiteral(pos, token));
  if (token.kind === "char") {
    return some({
      node: {
        kind: "CharLiteral",
        tokenId: pos,
        value: resolveEscape(token.text),
      },
      next: pos + 1,
    });
  }
  if (
    token.kind === "keyword" &&
    (token.text === "true" || token.text === "false")
  ) {
    return some({
      node: {
        kind: "BoolLiteral",
        tokenId: pos,
        value: token.text === "true",
      },
      next: pos + 1,
    });
  }
  return none();
}
