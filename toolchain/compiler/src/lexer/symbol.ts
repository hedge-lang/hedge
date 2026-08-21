import { type Diagnostic, errorDiagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import { type Token } from "./token.js";

function peek(source: string, i: number, offset: number = 1): string {
  return source[i + offset] ?? "";
}

/** Pushes `token` and returns the index just past it. */
function push(tokens: Token[], token: Token): number {
  tokens.push(token);
  return token.span.end;
}

function tokenizeEqSymbol(
    tokens: Token[],
    n1: string,
    start: number
): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "eq_eq",
      span: { start, end: start + "==".length },
    });
  if (n1 === ">")
    return push(tokens, {
      kind: "fat_arrow",
      span: { start, end: start + "=>".length },
    });
  return push(tokens, {
    kind: "eq",
    span: { start, end: start + "=".length },
  });
}

function tokenizeBangSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "bang_eq",
      span: { start, end: start + "!=".length },
    });
  return push(tokens, {
    kind: "bang",
    span: { start, end: start + "!".length },
  });
}

function tokenizeLtSymbol(tokens: Token[], n1: string, n2: string, start: number): number {
  if (n1 === "<") {
    if (n2 === "=")
      return push(tokens, {
        kind: "lt_lt_eq",
        span: { start, end: start + "<<=".length },
      });
    return push(tokens, {
      kind: "lt_lt",
      span: { start, end: start + "<<".length },
    });
  }
  if (n1 === "=")
    return push(tokens, {
      kind: "lt_eq",
      span: { start, end: start + "<=".length },
    });
  return push(tokens, {
    kind: "lt",
    span: { start, end: start + "<".length },
  });
}

function tokenizeGtSymbol(tokens: Token[], n1: string, n2: string, start: number): number {
  if (n1 === ">") {
    if (n2 === "=")
      return push(tokens, {
        kind: "gt_gt_eq",
        span: { start, end: start + ">>=".length },
      });
    return push(tokens, {
      kind: "gt_gt",
      span: { start, end: start + ">>".length },
    });
  }
  if (n1 === "=")
    return push(tokens, {
      kind: "gt_eq",
      span: { start, end: start + ">=".length },
    });
  return push(tokens, {
    kind: "gt",
    span: { start, end: start + ">".length },
  });
}

function tokenizeAmpSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "&")
    return push(tokens, {
      kind: "amp_amp",
      span: { start, end: start + "&&".length },
    });
  if (n1 === "=")
    return push(tokens, {
      kind: "amp_eq",
      span: { start, end: start + "&=".length },
    });
  return push(tokens, {
    kind: "amp",
    span: { start, end: start + "&".length },
  });
}

function tokenizePipeSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "|")
    return push(tokens, {
      kind: "pipe_pipe",
      span: { start, end: start + "||".length },
    });
  if (n1 === "=")
    return push(tokens, {
      kind: "pipe_eq",
      span: { start, end: start + "|=".length },
    });
  return push(tokens, {
    kind: "pipe",
    span: { start, end: start + "|".length },
  });
}

function tokenizePlusSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "plus_eq",
      span: { start, end: start + "+=".length },
    });
  return push(tokens, {
    kind: "plus",
    span: { start, end: start + "+".length },
  });
}

function tokenizeMinusSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === ">")
    return push(tokens, {
      kind: "arrow",
      span: { start, end: start + "->".length },
    });
  if (n1 === "=")
    return push(tokens, {
      kind: "minus_eq",
      span: { start, end: start + "-=".length },
    });
  return push(tokens, {
    kind: "minus",
    span: { start, end: start + "-".length },
  });
}

function tokenizeStarSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "star_eq",
      span: { start, end: start + "*=".length },
    });
  return push(tokens, {
    kind: "star",
    span: { start, end: start + "*".length },
  });
}

function tokenizeSlashSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "slash_eq",
      span: { start, end: start + "/=".length },
    });
  return push(tokens, {
    kind: "slash",
    span: { start, end: start + "/".length },
  });
}

function tokenizePercentSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "percent_eq",
      span: { start, end: start + "%=".length },
    });
  return push(tokens, {
    kind: "percent",
    span: { start, end: start + "%".length },
  });
}

function tokenizeCaretSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === "=")
    return push(tokens, {
      kind: "caret_eq",
      span: { start, end: start + "^=".length },
    });
  return push(tokens, {
    kind: "caret",
    span: { start, end: start + "^".length },
  });
}

function tokenizeColonSymbol(tokens: Token[], n1: string, start: number): number {
  if (n1 === ":")
    return push(tokens, {
      kind: "path_sep",
      span: { start, end: start + "::".length },
    });
  return push(tokens, {
    kind: "colon",
    span: { start, end: start + ":".length },
  });
}

function tokenizeDotSymbol(tokens: Token[], n1: string, n2: string, start: number): number {
  if (n1 === ".") {
    if (n2 === "=")
      return push(tokens, {
        kind: "dot_dot_eq",
        span: { start, end: start + "..=".length },
      });
    return push(tokens, {
      kind: "dot_dot",
      span: { start, end: start + "..".length },
    });
  }
  return push(tokens, {
    kind: "dot",
    span: { start, end: start + ".".length },
  });
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
      return tokenizeEqSymbol(tokens, n1, start);
    case "!":
      return tokenizeBangSymbol(tokens, n1, start);
    case "<":
      return tokenizeLtSymbol(tokens, n1, n2, start);
    case ">":
      return tokenizeGtSymbol(tokens, n1, n2, start);
    case "&":
      return tokenizeAmpSymbol(tokens, n1, start);
    case "|":
      return tokenizePipeSymbol(tokens, n1, start);
    case "+":
      return tokenizePlusSymbol(tokens, n1, start);
    case "-":
      return tokenizeMinusSymbol(tokens, n1, start);
    case "*":
      return tokenizeStarSymbol(tokens, n1, start);
    case "/":
      return tokenizeSlashSymbol(tokens, n1, start);
    case "%":
      return tokenizePercentSymbol(tokens, n1, start);
    case "^":
      return tokenizeCaretSymbol(tokens, n1, start);
    case ":":
      return tokenizeColonSymbol(tokens, n1, start);
    case ".":
      return tokenizeDotSymbol(tokens, n1, n2, start);
    case "(":
      return push(tokens, {
        kind: "lparen",
        span: { start, end: start + "(".length },
      });
    case ")":
      return push(tokens, {
        kind: "rparen",
        span: { start, end: start + ")".length },
      });
    case "{":
      return push(tokens, {
        kind: "lbrace",
        span: { start, end: start + "{".length },
      });
    case "}":
      return push(tokens, {
        kind: "rbrace",
        span: { start, end: start + "}".length },
      });
    case "[":
      return push(tokens, {
        kind: "lbracket",
        span: { start, end: start + "[".length },
      });
    case "]":
      return push(tokens, {
        kind: "rbracket",
        span: { start, end: start + "]".length },
      });
    case ",":
      return push(tokens, {
        kind: "comma",
        span: { start, end: start + ",".length },
      });
    case ";":
      return push(tokens, {
        kind: "semi",
        span: { start, end: start + ";".length },
      });
    case "#":
      return push(tokens, {
        kind: "hash",
        span: { start, end: start + "#".length },
      });
    case "@":
      return push(tokens, {
        kind: "at",
        span: { start, end: start + "@".length },
      });
    case "?":
      return push(tokens, {
        kind: "question",
        span: { start, end: start + "?".length },
      });

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
