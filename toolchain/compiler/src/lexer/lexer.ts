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

function push(
  tokens: Token[],
  kind: TokenKind,
  text: string,
  start: number,
): number {
  tokens.push({ kind, text, span: { start, end: start + text.length } });
  return start + text.length;
}

function peek(source: string, i: number, offset: number = 1): string {
  return source[i + offset] ?? "";
}

/**
 * Scans a multi-char or single-char symbol token using a maximal-munch
 * cascade grouped by leading character.
 *
 * @returns the position after the emitted token.
 */
function scanSymbol(tokens: Token[], source: string, i: number): number {
  const ch = source[i]!;
  const n1 = peek(source, i, 1);
  const n2 = peek(source, i, 2);

  switch (ch) {
    case "=":
      if (n1 === "=") return push(tokens, "eq_eq", "==", i);
      if (n1 === ">") return push(tokens, "fat_arrow", "=>", i);
      return push(tokens, "eq", "=", i);

    case "!":
      if (n1 === "=") return push(tokens, "bang_eq", "!=", i);
      return push(tokens, "bang", "!", i);

    case "<":
      if (n1 === "<") {
        if (n2 === "=") return push(tokens, "lt_lt_eq", "<<=", i);
        return push(tokens, "lt_lt", "<<", i);
      }
      if (n1 === "=") return push(tokens, "lt_eq", "<=", i);
      return push(tokens, "lt", "<", i);

    case ">":
      if (n1 === ">") {
        if (n2 === "=") return push(tokens, "gt_gt_eq", ">>=", i);
        return push(tokens, "gt_gt", ">>", i);
      }
      if (n1 === "=") return push(tokens, "gt_eq", ">=", i);
      return push(tokens, "gt", ">", i);

    case "&":
      if (n1 === "&") return push(tokens, "amp_amp", "&&", i);
      if (n1 === "=") return push(tokens, "amp_eq", "&=", i);
      return push(tokens, "amp", "&", i);

    case "|":
      if (n1 === "|") return push(tokens, "pipe_pipe", "||", i);
      if (n1 === "=") return push(tokens, "pipe_eq", "|=", i);
      return push(tokens, "pipe", "|", i);

    case "+":
      if (n1 === "=") return push(tokens, "plus_eq", "+=", i);
      return push(tokens, "plus", "+", i);

    case "-":
      if (n1 === ">") return push(tokens, "arrow", "->", i);
      if (n1 === "=") return push(tokens, "minus_eq", "-=", i);
      return push(tokens, "minus", "-", i);

    case "*":
      if (n1 === "=") return push(tokens, "star_eq", "*=", i);
      return push(tokens, "star", "*", i);

    case "/":
      if (n1 === "=") return push(tokens, "slash_eq", "/=", i);
      return push(tokens, "slash", "/", i);

    case "%":
      if (n1 === "=") return push(tokens, "percent_eq", "%=", i);
      return push(tokens, "percent", "%", i);

    case "^":
      if (n1 === "=") return push(tokens, "caret_eq", "^=", i);
      return push(tokens, "caret", "^", i);

    case ":":
      if (n1 === ":") return push(tokens, "path_sep", "::", i);
      return push(tokens, "colon", ":", i);

    case ".":
      if (n1 === ".") {
        if (n2 === "=") return push(tokens, "dot_dot_eq", "..=", i);
        return push(tokens, "dot_dot", "..", i);
      }
      return push(tokens, "dot", ".", i);

    case "(": return push(tokens, "lparen", "(", i);
    case ")": return push(tokens, "rparen", ")", i);
    case "{": return push(tokens, "lbrace", "{", i);
    case "}": return push(tokens, "rbrace", "}", i);
    case "[": return push(tokens, "lbracket", "[", i);
    case "]": return push(tokens, "rbracket", "]", i);
    case ",": return push(tokens, "comma", ",", i);
    case ";": return push(tokens, "semi", ";", i);
    case "#": return push(tokens, "hash", "#", i);
    case "@": return push(tokens, "at", "@", i);
    case "?": return push(tokens, "question", "?", i);

    default:
      throw new SyntaxError(
        `Unexpected character "${ch}" at offset ${i}`,
      );
  }
}

/**
 * Tokenize Hedge source into a flat token list terminated by an `eof` token.
 *
 * Covers the full Slice 1 lexical grammar: identifiers, hard keywords, decimal
 * integer literals, string literals, lifetime tokens, and all operators and
 * punctuation defined in `specification/0025-grammar.md`.
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
    } else if (ch === "'") {
      // Lifetime: 'ident (not immediately followed by another ' after one char)
      const n1 = peek(source, i, 1);
      if (isIdentStart(n1)) {
        const end = scanWhile(source, i + 2, isIdentContinue);
        tokens.push({
          kind: "lifetime",
          text: source.slice(i + 1, end),
          span: { start, end },
        });
        i = end;
      } else {
        throw new SyntaxError(`Unexpected character "'" at offset ${start}`);
      }
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
      i = scanSymbol(tokens, source, i);
    }
  }
  tokens.push({
    kind: "eof",
    text: "",
    span: { start: source.length, end: source.length },
  });
  return tokens;
}
