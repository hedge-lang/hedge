import { type Diagnostic } from "../diagnostics.js";
import { none, type Option, some } from "../option.js";
import { scanWhile } from "./scan-while.js";
import { type Token } from "./token.js";

/**
 * @param ch The character to test.
 *
 * @returns `true` if `ch` opens a string literal.
 */
function isStringBegin(ch: string): boolean {
  return ch === '"';
}

/**
 * Tokenize a string literal starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the string literal.
 * @returns `None` if the source does not start with a string delimiter.
 */
export function tokenizeString(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  const ch = source.at(start);
  if (ch === undefined || !isStringBegin(ch)) return none();
  const end = scanWhile(source, start + 1, (c) => c !== ch);
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
    return some(source.length);
  }
  tokens.push({
    kind: "string",
    text: source.slice(start + 1, end),
    span: { start, end: end + 1 },
  });
  return some(end + 1);
}
