import type { Diagnostic } from "../diagnostics.js";
import { isSome, some } from "../option.js";
import type { Token } from "./token.js";
import { tokenizeComment } from "./comments.js";
import { tokenizeIdent, tokenizeRawIdent } from "./ident.js";
import { tokenizeKeyword } from "./keywords.js";
import { tokenizeSymbol } from "./symbol.js";
import { tokenizeWhitespace } from "./whitespace.js";
import { scanCharOrLifetime } from "./char.js";
import { isDigit } from "./int.js";
import { scanNumberLiteral } from "./number.js";
import { scanRawString, scanStringLiteral } from "./string.js";

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
// eslint-disable-next-line complexity -- This makes sense to all be one chain
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === undefined) break;

    const ws = tokenizeWhitespace(tokens, diagnostics, source, i);
    if (isSome(ws)) {
      i = ws.value;
      continue;
    }

    const comment = tokenizeComment(tokens, diagnostics, source, i);
    if (isSome(comment)) {
      i = comment.value;
      continue;
    }

    const keyword = tokenizeKeyword(tokens, diagnostics, source, i);
    if (isSome(keyword)) {
      i = keyword.value;
      continue;
    }

    if (source[i] === "'") {
      i = scanCharOrLifetime(tokens, diagnostics, source, i);
      continue;
    }

    // Raw strings (r"..." or r##"..."##) must be checked before tokenizeRawIdent
    // because tokenizeRawIdent would consume r# followed by a non-ident-start as an error.
    if (isRawStringStart(source, i)) {
      i = tokenizeRString(tokens, diagnostics, source, i);
      continue;
    }

    const rawIdent = tokenizeRawIdent(tokens, diagnostics, source, i);
    if (isSome(rawIdent)) {
      i = rawIdent.value;
      continue;
    }

    const ident = tokenizeIdent(tokens, diagnostics, source, i);
    if (isSome(ident)) {
      i = ident.value;
      continue;
    }

    const ch = source[i] ?? "";
    if (isDigit(ch)) {
      i = scanNumberLiteral(tokens, diagnostics, source, i);
      continue;
    }

    if (ch === '"') {
      i = scanStringLiteral(tokens, diagnostics, source, i);
      continue;
    }

    i = tokenizeSymbol(tokens, diagnostics, source, i);
  }
  tokens.push({
    kind: "eof",
    span: { start: source.length, end: source.length },
  });
  return { tokens, diagnostics };
}

/**
 * Returns true if the source at `i` begins a raw string literal: `r"` or
 * `r` followed by one or more `#` characters then `"`.
 */
function isRawStringStart(source: string, i: number): boolean {
  if (source[i] !== "r") return false;
  if (source[i + 1] === '"') return true;
  if (source[i + 1] !== "#") return false;
  let hc = 0;
  while (source[i + 1 + hc] === "#") hc++;
  return source[i + 1 + hc] === '"';
}

/**
 * Tokenize a raw string literal starting at `start`.
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
