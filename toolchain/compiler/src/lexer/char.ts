import { errorDiagnostic } from "../diagnostics.js";
import type { Diagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import { scanEscapeSeq } from "./escape.js";
import { isIdentStart } from "./ident.js";
import { scanLifetime } from "./lifetime.js";
import type { Token } from "./token.js";

/**
 * Scans a char literal starting at `start` (the `'`).
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the char literal.
 */
function scanCharLiteral(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const ch = source[start + 1] ?? "";
  if (ch === "\\") {
    const escEnd = scanEscapeSeq(tokens, diagnostics, source, start, start + 1);
    if (escEnd === null) {
      const lastToken = tokens.at(-1);
      if (lastToken === undefined) {
        diagnostics.push(
          errorDiagnostic(
            "HEDGE-LEX-002",
            `unterminated char literal at offset ${start}`,
            some({ start, end: source.length }),
          ),
        );
        tokens.push({
          kind: "error",
          span: { start, end: source.length },
          text: source.slice(start),
        });
        return source.length;
      }
      let j = lastToken.span.end;
      while (j < source.length && source[j] !== "'") j++;
      return j < source.length ? j + 1 : j;
    }
    if (source[escEnd] !== "'") {
      diagnostics.push(
        errorDiagnostic(
          "HEDGE-LEX-002",
          `unterminated char literal at offset ${start}`,
          some({ start, end: escEnd }),
        ),
      );
      tokens.push({
        kind: "error",
        span: { start, end: escEnd },
        text: source.slice(start, escEnd),
      });
      return escEnd;
    }
    const end = escEnd + 1;
    tokens.push({
      kind: "char",
      span: { start, end },
      text: source.slice(start + 1, escEnd),
    });
    return end;
  }
  const cpLen = (source.codePointAt(start + 1) ?? 0) > 0xffff ? 2 : 1;
  const end = start + 1 + cpLen + 1; // ' + char + '
  tokens.push({
    kind: "char",
    span: { start, end },
    text: source.slice(start + 1, start + 1 + cpLen),
  });
  return end;
}

/**
 * Handles the `'` character: dispatches to a char literal or a lifetime token.
 * Called from the main tokenize loop when `source[start] === "'"`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the char literal or lifetime.
 */
export function scanCharOrLifetime(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const n1 = source[start + 1] ?? "";
  const n1Len = (source.codePointAt(start + 1) ?? 0) > 0xffff ? 2 : 1;
  const n2 = source[start + 1 + n1Len] ?? "";

  if (n1 === "'") {
    // Empty char literal: ''
    diagnostics.push(
      errorDiagnostic(
        "HEDGE-LEX-004",
        `empty char literal at offset ${start}`,
        some({ start, end: start + 2 }),
      ),
    );
    tokens.push({ kind: "error", span: { start, end: start + 2 }, text: "''" });
    return start + 2;
  }

  if (n1 === "\\") {
    return scanCharLiteral(tokens, diagnostics, source, start);
  }

  if (n2 === "'" && n1 !== "\n" && n1 !== "") {
    // Single non-ident-start char: '0', ' ', '!', etc.
    return scanCharLiteral(tokens, diagnostics, source, start);
  }

  if (isIdentStart(n1)) {
    if (n2 === "'") {
      // Single letter: 'a'
      return scanCharLiteral(tokens, diagnostics, source, start);
    }
    // Lifetime: 'ident
    return scanLifetime(tokens, source, start);
  }

  // Unrecognised
  const end = start + 1;
  diagnostics.push(
    errorDiagnostic(
      "HEDGE-LEX-005",
      `Unexpected character "'" at offset ${start}`,
      some({ start, end }),
    ),
  );
  tokens.push({ kind: "error", span: { start, end }, text: "'" });
  return end;
}
