import { type Diagnostic } from "../diagnostics.js";
import { isSome } from "../option.js";
import { type Token } from "./token.js";
import { tokenizeComment } from "./comments.js";
import { tokenizeIdent, tokenizeRawIdent } from "./ident.js";
import { tokenizeInt } from "./int.js";
import { tokenizeKeyword } from "./keywords.js";
import { tokenizeLifetime } from "./lifetime.js";
import { tokenizeString } from "./string.js";
import { tokenizeSymbol } from "./symbol.js";
import { tokenizeWhitespace } from "./whitespace.js";

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

    const lifetime = tokenizeLifetime(tokens, diagnostics, source, i);
    if (isSome(lifetime)) {
      i = lifetime.value;
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

    const int = tokenizeInt(tokens, diagnostics, source, i);
    if (isSome(int)) {
      i = int.value;
      continue;
    }

    const str = tokenizeString(tokens, diagnostics, source, i);
    if (isSome(str)) {
      i = str.value;
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
