import { isErr } from "../result.js";
import { isComment, parseComment } from "./comments.js";
import {
  isIdentStart,
  isRawIdentStart,
  parseIdent,
  parseRawIdent,
} from "./ident.js";
import { isKeyword, parseKeyword } from "./keywords.js";
import type { Diagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import type { Token } from "./token.js";
import { isWhitespace } from "./whitespace.js";
import { scanCharOrLifetime } from "./char.js";
import { isDigit, scanNumberLiteral } from "./number.js";
import { scanRawString, scanStringLiteral } from "./string.js";
import { scanSymbol } from "./symbol.js";

/** The result of tokenizing a source string: tokens plus any lex-time diagnostics. */
export interface TokenizeResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Tokenize Hedge source into a stream of tokens plus a sidecar diagnostic
 * list. Unrecognized characters produce an `error` token in the stream and a
 * corresponding entry in `diagnostics` rather than throwing, so the caller
 * always receives a complete token sequence terminated by `eof`.
 *
 * @param source The source string to tokenize.
 *
 * @returns the tokens and any lex-time diagnostics.
 */
// eslint-disable-next-line complexity -- This is mostly a routing function
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;
    if (isWhitespace(source, i)) {
      i += 1;
      continue;
    }
    const start = i;
    if (isComment(source, i)) {
      i = lexComment(tokens, diagnostics, source, start);
    } else if (isKeyword(source, i)) {
      i = parseKeyword(tokens, diagnostics, source, i);
    } else if (ch === "'") {
      i = scanCharOrLifetime(tokens, diagnostics, source, start);
    } else if (isRawIdentStart(source, i)) {
      i = parseRawIdent(tokens, source, i);
    } else if (ch === "r" && (source[i + 1] === '"' || source[i + 1] === "#")) {
      i = tokenizeRString(tokens, diagnostics, source, start);
    } else if (isIdentStart(ch)) {
      i = parseIdent(tokens, source, i);
    } else if (isDigit(ch)) {
      i = scanNumberLiteral(tokens, diagnostics, source, start);
    } else if (ch === '"') {
      i = scanStringLiteral(tokens, diagnostics, source, start);
    } else {
      i = scanSymbol(tokens, diagnostics, source, i);
    }
  }
  tokens.push({
    kind: "eof",
    span: { start: source.length, end: source.length },
  });
  return { tokens, diagnostics };
}

/**
 * Lex a comment starting at `start`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the comment.
 */
function lexComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const result = parseComment(tokens, source, start);
  if (isErr(result)) {
    diagnostics.push(result.error);
    return source.length;
  }
  return result.value;
}

/**
 * Tokenize a raw string literal starting at `start`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the raw string literal.
 */
function tokenizeRString(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  let hashCount = 0;
  while (source[start + 1 + hashCount] === "#") hashCount++;
  if (source[start + 1 + hashCount] === '"') {
    return scanRawString(tokens, diagnostics, source, start, hashCount);
  }

  const end = start + 1 + hashCount;
  diagnostics.push({
    severity: "error",
    message: `raw string prefix \`r${"#".repeat(hashCount || 1)}\` must be followed by '"'`,
    span: some({ start, end }),
  });
  tokens.push({
    kind: "error",
    span: { start, end },
    text: source.slice(start, end),
  });
  return end;
}
