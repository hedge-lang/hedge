import { type Diagnostic, errorDiagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import { type Token } from "./token.js";

function peek(source: string, i: number, offset: number = 1): string {
  return source[i + offset] ?? "";
}

/**
 * Tokenize the next symbol token using a maximal-munch cascade grouped by
 * leading character. This is the catch-all tokenizer: it always emits a token
 * (either a valid symbol or an `error` token for unrecognized characters).
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the token.
 */
// eslint-disable-next-line complexity -- Maximal-munch cascade is more readable as a single function.
export function tokenizeSymbol(
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
      diagnostics.push(
        errorDiagnostic(
          "HEDGE-LEX-005",
          `Unexpected character "${ch}" at offset ${start}`,
          some({ start, end }),
        ),
      );
      tokens.push({ kind: "error", span: { start, end }, text: ch ?? "" });
      return end;
    }
  }
}
