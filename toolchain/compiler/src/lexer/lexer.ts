import { isErr } from "../result.js";
import { isComment, parseComment } from "./comments.js";
import {
  isIdentContinue,
  isIdentStart,
  isRawIdentStart,
  parseIdent,
  parseRawIdent,
} from "./ident.js";
import { isKeyword, parseKeyword } from "./keywords.js";
import { scanWhile } from "./scan-while.js";
import type { Diagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import type { Token } from "./token.js";
import { isWhitespace } from "./whitespace.js";

/** The result of tokenizing a source string: tokens plus any lex-time diagnostics. */
export interface TokenizeResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
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
  return (ch: string) => ch !== beginCh;
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
// eslint-disable-next-line complexity -- Maximal-munch cascade is more readable as a single function.
function scanSymbol(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const ch = source[start];
  const n1 = peek(source, start, 1);
  const n2 = peek(source, start, 2);

  switch (ch) {
    case "=":
      if (n1 === "=") {
        const end = start + "==".length;
        tokens.push({ kind: "eq_eq", span: { start, end } });
        return end;
      }
      if (n1 === ">") {
        const end = start + "=>".length;
        tokens.push({ kind: "fat_arrow", span: { start, end } });
        return end;
      }
      {
        const end = start + "=".length;
        tokens.push({ kind: "eq", span: { start, end } });
        return end;
      }

    case "!":
      if (n1 === "=") {
        const end = start + "!=".length;
        tokens.push({ kind: "bang_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "!".length;
        tokens.push({ kind: "bang", span: { start, end } });
        return end;
      }

    case "<":
      if (n1 === "<") {
        if (n2 === "=") {
          const end = start + "<<=".length;
          tokens.push({ kind: "lt_lt_eq", span: { start, end } });
          return end;
        }
        {
          const end = start + "<<".length;
          tokens.push({ kind: "lt_lt", span: { start, end } });
          return end;
        }
      }
      if (n1 === "=") {
        const end = start + "<=".length;
        tokens.push({ kind: "lt_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "<".length;
        tokens.push({ kind: "lt", span: { start, end } });
        return end;
      }

    case ">":
      if (n1 === ">") {
        if (n2 === "=") {
          const end = start + ">>=".length;
          tokens.push({ kind: "gt_gt_eq", span: { start, end } });
          return end;
        }
        {
          const end = start + ">>".length;
          tokens.push({ kind: "gt_gt", span: { start, end } });
          return end;
        }
      }
      if (n1 === "=") {
        const end = start + ">=".length;
        tokens.push({ kind: "gt_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + ">".length;
        tokens.push({ kind: "gt", span: { start, end } });
        return end;
      }

    case "&":
      if (n1 === "&") {
        const end = start + "&&".length;
        tokens.push({ kind: "amp_amp", span: { start, end } });
        return end;
      }
      if (n1 === "=") {
        const end = start + "&=".length;
        tokens.push({ kind: "amp_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "&".length;
        tokens.push({ kind: "amp", span: { start, end } });
        return end;
      }

    case "|":
      if (n1 === "|") {
        const end = start + "||".length;
        tokens.push({ kind: "pipe_pipe", span: { start, end } });
        return end;
      }
      if (n1 === "=") {
        const end = start + "|=".length;
        tokens.push({ kind: "pipe_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "|".length;
        tokens.push({ kind: "pipe", span: { start, end } });
        return end;
      }

    case "+":
      if (n1 === "=") {
        const end = start + "+=".length;
        tokens.push({ kind: "plus_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "+".length;
        tokens.push({ kind: "plus", span: { start, end } });
        return end;
      }

    case "-":
      if (n1 === ">") {
        const end = start + "->".length;
        tokens.push({ kind: "arrow", span: { start, end } });
        return end;
      }
      if (n1 === "=") {
        const end = start + "-=".length;
        tokens.push({ kind: "minus_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "-".length;
        tokens.push({ kind: "minus", span: { start, end } });
        return end;
      }

    case "*":
      if (n1 === "=") {
        const end = start + "*=".length;
        tokens.push({ kind: "star_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "*".length;
        tokens.push({ kind: "star", span: { start, end } });
        return end;
      }

    case "/":
      if (n1 === "=") {
        const end = start + "/=".length;
        tokens.push({ kind: "slash_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "/".length;
        tokens.push({ kind: "slash", span: { start, end } });
        return end;
      }

    case "%":
      if (n1 === "=") {
        const end = start + "%=".length;
        tokens.push({ kind: "percent_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "%".length;
        tokens.push({ kind: "percent", span: { start, end } });
        return end;
      }

    case "^":
      if (n1 === "=") {
        const end = start + "^=".length;
        tokens.push({ kind: "caret_eq", span: { start, end } });
        return end;
      }
      {
        const end = start + "^".length;
        tokens.push({ kind: "caret", span: { start, end } });
        return end;
      }

    case ":":
      if (n1 === ":") {
        const end = start + "::".length;
        tokens.push({ kind: "path_sep", span: { start, end } });
        return end;
      }
      {
        const end = start + ":".length;
        tokens.push({ kind: "colon", span: { start, end } });
        return end;
      }

    case ".":
      if (n1 === ".") {
        if (n2 === "=") {
          const end = start + "..=".length;
          tokens.push({ kind: "dot_dot_eq", span: { start, end } });
          return end;
        }
        {
          const end = start + "..".length;
          tokens.push({ kind: "dot_dot", span: { start, end } });
          return end;
        }
      }
      {
        const end = start + ".".length;
        tokens.push({ kind: "dot", span: { start, end } });
        return end;
      }

    case "(": {
      const end = start + "(".length;
      tokens.push({ kind: "lparen", span: { start, end } });
      return end;
    }
    case ")": {
      const end = start + ")".length;
      tokens.push({ kind: "rparen", span: { start, end } });
      return end;
    }
    case "{": {
      const end = start + "{".length;
      tokens.push({ kind: "lbrace", span: { start, end } });
      return end;
    }
    case "}": {
      const end = start + "}".length;
      tokens.push({ kind: "rbrace", span: { start, end } });
      return end;
    }
    case "[": {
      const end = start + "[".length;
      tokens.push({ kind: "lbracket", span: { start, end } });
      return end;
    }
    case "]": {
      const end = start + "]".length;
      tokens.push({ kind: "rbracket", span: { start, end } });
      return end;
    }
    case ",": {
      const end = start + ",".length;
      tokens.push({ kind: "comma", span: { start, end } });
      return end;
    }
    case ";": {
      const end = start + ";".length;
      tokens.push({ kind: "semi", span: { start, end } });
      return end;
    }
    case "#": {
      const end = start + "#".length;
      tokens.push({ kind: "hash", span: { start, end } });
      return end;
    }
    case "@": {
      const end = start + "@".length;
      tokens.push({ kind: "at", span: { start, end } });
      return end;
    }
    case "?": {
      const end = start + "?".length;
      tokens.push({ kind: "question", span: { start, end } });
      return end;
    }

    default: {
      const end = start + 1;
      diagnostics.push({
        severity: "error",
        message: `Unexpected character "${ch}" at offset ${start}`,
        span: some({ start, end }),
      });
      tokens.push({ kind: "error", span: { start, end }, text: ch ?? "" });
      return end;
    }
  }
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
// eslint-disable-next-line complexity -- The main loop is more readable as a single function.
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
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
      const maybeParseComment = parseComment(tokens, source, i);
      if (isErr(maybeParseComment)) {
        diagnostics.push(maybeParseComment.error);
        i = start + 2; // advance past `/*` to allow lexing to continue
      } else {
        i = maybeParseComment.value;
      }
    } else if (isKeyword(source, i)) {
      i = parseKeyword(tokens, diagnostics, source, i);
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
        const end = start + 1;
        diagnostics.push({
          severity: "error",
          message: `Unexpected character "'" at offset ${start}`,
          span: some({ start, end }),
        });
        tokens.push({ kind: "error", span: { start, end }, text: "'" });
        i = end;
      }
    } else if (isRawIdentStart(source, i)) {
      i = parseRawIdent(tokens, source, i);
    } else if (ch === "r" && source[i + 1] === "#") {
      const end = i + 2;
      diagnostics.push({
        severity: "error",
        message: "raw identifier prefix `r#` must be followed by an identifier",
        span: some({ start, end }),
      });
      tokens.push({ kind: "error", span: { start, end }, text: "r#" });
      i = end;
    } else if (isIdentStart(ch)) {
      i = parseIdent(tokens, source, i);
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
        diagnostics.push({
          severity: "error",
          message: `Unterminated string literal starting at ${start}`,
          span: some({ start, end: source.length }),
        });
        tokens.push({
          kind: "error",
          span: { start, end: source.length },
          text: source.slice(start),
        });
        i = source.length;
      } else {
        tokens.push({
          kind: "string",
          text: source.slice(start + 1, end),
          span: { start, end: end + 1 },
        });
        i = end + 1;
      }
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
