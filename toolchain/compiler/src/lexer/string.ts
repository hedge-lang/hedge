import { errorDiagnostic } from "../diagnostics.js";
import type { Diagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import { scanEscapeSeq } from "./escape.js";
import type { Token } from "./token.js";

export function scanStringLiteral(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  let i = start + 1; // skip opening "
  while (i < source.length) {
    const ch = source[i] ?? "";
    if (ch === '"') {
      tokens.push({
        kind: "string",
        span: { start, end: i + 1 },
        text: source.slice(start + 1, i),
      });
      return i + 1;
    }
    if (ch === "\\") {
      const escEnd = scanEscapeSeq(tokens, diagnostics, source, start, i);
      if (escEnd === null) {
        const lastToken = tokens.at(-1);
        if (lastToken === undefined) {
          diagnostics.push(
            errorDiagnostic(
              some("HEDGE-LEX-001"),
              `Unterminated string literal starting at ${start}`,
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
        while (j < source.length && source[j] !== '"') j++;
        return j < source.length ? j + 1 : j;
      }
      i = escEnd;
      continue;
    }
    i++;
  }
  diagnostics.push(
    errorDiagnostic(
      some("HEDGE-LEX-001"),
      `Unterminated string literal starting at ${start}`,
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

/**
 * Scans a raw string literal `r#*"..."#*` starting at `start` (the `r`).
 * The caller has already confirmed `source[start] === 'r'` and that after
 * counting consecutive `#` chars the next character is `"`.
 * The opening and closing hash counts must match exactly.
 */
export function scanRawString(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  hashCount: number,
): number {
  const contentStart = start + 1 + hashCount + 1; // skip r, Nx#, "
  const close = '"' + "#".repeat(hashCount);
  let i = contentStart;
  while (i < source.length) {
    if (source.slice(i, i + 1 + hashCount) === close) {
      const end = i + 1 + hashCount;
      tokens.push({
        kind: "string",
        span: { start, end },
        text: source.slice(contentStart, i),
      });
      return end;
    }
    i++;
  }
  diagnostics.push(
    errorDiagnostic(
      some("HEDGE-LEX-001"),
      `Unterminated raw string literal starting at ${start}`,
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
