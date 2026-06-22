import { isIdentContinue } from "./ident.js";
import { scanWhile } from "./scan-while.js";
import type { Token } from "./token.js";

/**
 * Scans a lifetime token starting at `start` (the `'`).
 *
 * Precondition: `source[start + 1]` is an identifier-start character.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index of the leading `'`.
 *
 * @returns The index of the first character after the lifetime.
 */
export function scanLifetime(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const end = scanWhile(source, start + 2, isIdentContinue);
  tokens.push({
    kind: "lifetime",
    text: source.slice(start + 1, end),
    span: { start, end },
  });
  return end;
}
