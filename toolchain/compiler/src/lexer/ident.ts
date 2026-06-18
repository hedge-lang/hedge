import { scanWhile } from "./scan-while.js";
import type { Token } from "./token.js";

/**
 * Approximation of ECMAScript IdentifierName using Unicode property escapes.
 *
 * Spans are measured in UTF-16 code units; full code-point aware scanning may
 * be a later refinement.
 *
 * @param ch The character to test.
 *
 * @returns `true` if `ch` is a valid identifier start character.
 */
export function isIdentStart(ch: string): boolean {
  return /[\p{ID_Start}_$]/u.test(ch);
}

/**
 * Approximation of ECMAScript IdentifierPart using Unicode property escapes.
 *
 * Spans are measured in UTF-16 code units; full code-point aware scanning may
 * be a later refinement.
 *
 * @param ch The character to test.
 *
 * @returns `true` if `ch` is a valid identifier continue character.
 */
export function isIdentContinue(ch: string): boolean {
  return /[\p{ID_Continue}_$]/u.test(ch);
}

/**
 * Get an identifier starting at `start` in `source`, with an offset of `offset`
 * UTF-16 code units.
 *
 * @param source The source to scan.
 * @param start The index to start scanning at.
 * @param offset The offset to add to the start index.
 *
 * @returns The identifier token.
 */
function getIdent(source: string, start: number, offset: number): Token {
  const end = scanWhile(source, start + 1 + offset, isIdentContinue);
  const text = source.slice(start + offset, end);
  return { kind: "ident", text, span: { start, end } };
}

/**
 * Parse an identifier starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the identifier.
 */
export function parseIdent(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const token = getIdent(source, start, 0);
  const end = token.span.end;
  tokens.push(token);
  return end;
}

/**
 * Check if the source at `start` is a raw identifier.
 *
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `true` if the source starts with a raw identifier.
 */
export function isRawIdentStart(source: string, start: number): boolean {
  const a = source[start];
  const b = source[start + 1];
  const c = source[start + 2];

  if (a === undefined || b === undefined || c === undefined) {
    return false;
  }
  return a === "r" && b === "#" && isIdentStart(c);
}

/**
 * Parse a raw identifier starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the raw identifier.
 */
export function parseRawIdent(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const token = getIdent(source, start, 2);
  const end = token.span.end;
  tokens.push(token);
  return end;
}
