import { isComment, parseComment } from "./comments.js";
import { scanWhile } from "./scan-while.js";
import type { Token, TokenKind } from "./token.js";
import { isWhitespace } from "./whitespace.js";

/**
 * The hard keywords (grammar appendix). Contextual keywords (`write`, `bind`,
 * `package`, `unchecked`) are lexed as identifiers and classified later.
 */
const HARD_KEYWORDS: ReadonlySet<string> = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "dyn",
  "else",
  "enum",
  "export",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "move",
  "pub",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

// NOTE: ASCII subset of ECMAScript IdentifierName for now; full Unicode
// ID_Start / ID_Continue (grammar appendix) is a later refinement.
function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/u.test(ch);
}

function isIdentContinue(ch: string): boolean {
  return /[A-Za-z0-9_$]/u.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isDigitOrSeparator(ch: string): boolean {
  return isDigit(ch) || ch === "_";
}

function isStringBegin(ch: string): boolean {
  return ch === '"';
}

function isStringEnd(beginCh: string): (ch: string) => boolean {
  return (ch: string) => ch !== beginCh && ch !== "\\";
}

/**
 * Tokenize Hedge source into a flat token list terminated by an `eof` token.
 *
 * Slice-1 subset: ASCII identifiers and hard keywords, decimal integer
 * literals, single-character punctuation, and whitespace. This grows to the
 * full lexical grammar in `specification/0025-grammar.md`.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) {
      break;
    }
    if (isWhitespace(source, i)) {
      i += 1;
      continue;
    }
    const start = i;
    if (isComment(source, i)) {
      i = parseComment(tokens, source, i);
    } else if (isIdentStart(ch)) {
      const end = scanWhile(source, i + 1, isIdentContinue);
      const text = source.slice(start, end);
      const kind: TokenKind = HARD_KEYWORDS.has(text) ? "keyword" : "ident";
      tokens.push({ kind, text, span: { start, end } });
      i = end;
    } else if (isDigit(ch)) {
      const end = scanWhile(source, i + 1, isDigitOrSeparator);
      tokens.push({
        kind: "int",
        text: source.slice(start, end),
        span: { start, end },
      });
      i = end;
    } else if (isStringBegin(ch)) {
      const end = scanWhile(source, i + 1, isStringEnd(ch));
      if (end >= source.length) {
        throw new SyntaxError(
          `Unterminated string literal starting at ${start}`,
        );
      }
      tokens.push({
        kind: "string",
        text: source.slice(start + 1, end),
        span: { start, end: end + 1 },
      });
      i = end + 1;
    } else {
      tokens.push({ kind: "punct", text: ch, span: { start, end: i + 1 } });
      i += 1;
    }
  }
  tokens.push({
    kind: "eof",
    text: "",
    span: { start: source.length, end: source.length },
  });
  return tokens;
}
