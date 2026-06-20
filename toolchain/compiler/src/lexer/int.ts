import { type Diagnostic } from "../diagnostics.js";
import { none, type Option, some } from "../option.js";
import { scanWhile } from "./scan-while.js";
import { type Token } from "./token.js";

/**
 * @param ch The character to test.
 *
 * @returns `true` if `ch` is an ASCII digit.
 */
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * @param ch The character to test.
 *
 * @returns `true` if `ch` is an ASCII digit or `_` (numeric separator).
 */
function isDigitOrSeparator(ch: string): boolean {
  return isDigit(ch) || ch === "_";
}

/**
 * Tokenize an integer literal starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the integer literal.
 * @returns `None` if the source does not start with a digit.
 */
export function tokenizeInt(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  void diagnostics;
  const ch = source.at(start);
  if (ch === undefined || !isDigit(ch)) return none();
  const end = scanWhile(source, start + 1, isDigitOrSeparator);
  tokens.push({
    kind: "int",
    text: source.slice(start, end),
    span: { start, end },
    radix: 10,
    suffix: none(),
  });
  return some(end);
}
