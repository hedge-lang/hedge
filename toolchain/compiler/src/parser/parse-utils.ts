import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { none, some, type Option } from "../option.js";
import { err, isErr, ok, type Result } from "../result.js";
import type { Identifier } from "./ast.js";
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
    return err({
      severity: "error",
      message: `Unexpected end of input at token ${pos}`,
      span: none(),
    });
  }
  return ok(token);
}

/**
 * Consumes a required token of the given kind.
 *
 * @returns Index of the next token, or `Err` if the token at `pos` is not of the expected kind.
 */
export function expect(
  tokens: readonly Token[],
  pos: number,
  kind: Token["kind"],
): PR<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== kind) {
    return err({
      severity: "error",
      message: `Expected ${kind}, found "${token.kind}" at offset ${token.span.start}`,
      span: some(token.span),
    });
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
    return err({
      severity: "error",
      message: `Expected keyword "${text}", found "${found}" at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  return ok(pos + 1);
}

export function stripPrefix(text: string, radix: 2 | 8 | 10 | 16): string {
  if (radix !== 10) return text.slice(2); // strip 0x / 0o / 0b
  return text;
}

export function stripUnderscores(text: string): string {
  return text.replaceAll("_", "");
}

export const MUT_MESSAGE: string =
  "The keyword `mut` is reserved and cannot be used as an identifier. For a mutable binding, use `let mut`; for a mutable borrow, use `&mut`.";

export function unsupportedLoopMessage(keyword: string): string {
  return `\`${keyword}\` is not supported in Slice 1; loops are introduced in Slice 6`;
}

const LOOP_KEYWORDS: ReadonlySet<string> = new Set(["loop", "while", "for"]);

export interface LoopKeywordMatch {
  readonly pos: number;
  readonly token: Extract<Token, { kind: "keyword" }>;
}

/**
 * If a `loop`/`while`/`for` construct — optionally label-prefixed
 * (`'name: loop {}`) — starts at `pos`, returns the position and token of
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

export function unsupportedPathKeywordMessage(keyword: string): string {
  return `\`${keyword}\` is not supported in Slice 1; module resolution is introduced in Slice 7`;
}

const PATH_KEYWORDS: ReadonlySet<string> = new Set(["self", "super", "Self"]);

/**
 * @returns The token at `pos` if it is `self`/`super`/`Self`.
 */
export function pathKeywordAt(
  tokens: readonly Token[],
  pos: number,
): Option<Extract<Token, { kind: "keyword" }>> {
  const token = tokens[pos];
  if (token?.kind === "keyword" && PATH_KEYWORDS.has(token.text)) {
    return some(token);
  }
  return none();
}

export function unsupportedGenericsMessage(construct: string): string {
  return `${construct} are not supported in Slice 1; generics are introduced in Slice 4`;
}

export function unsupportedLifetimeMessage(construct: string): string {
  return `${construct} are not supported in Slice 1; lifetimes are introduced in Slice 2`;
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
): Option<Extract<Token, { kind: "path_sep" }>> {
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
 * confirmed `tokens[ltPos]` is a `lt` token). Counts `lt`/`gt` as depth ±1
 * and `lt_lt`/`gt_gt` as depth ±2, since `>>` lexes as a single `gt_gt`
 * token under maximal munch (see lexer/symbol.ts) — a naive one-token-at-a-
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

/**
 * True for tokens that can never legally appear inside a `where`-clause
 * bound list (paths, `:`, `,`, `<...>`).
 */
function isWhereClauseBoundary(tok: Token): boolean {
  return (
    tok.kind === "rbrace" ||
    (tok.kind === "keyword" && ITEM_START_KEYWORDS.has(tok.text))
  );
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
    return err({
      severity: "error",
      span: some({ start: token.span.start, end: token.span.end }),
      message: MUT_MESSAGE,
    });
  }

  if (token.kind !== "ident") {
    const found =
      token.kind === "keyword" ? `keyword "${token.text}"` : `"${token.kind}"`;
    return err({
      severity: "error",
      message: `Expected an identifier, found ${found} at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  const ident: Identifier = {
    kind: "Identifier",
    tokenId: pos,
    text: token.text,
  };
  return ok({ node: ident, next: pos + 1 });
}
