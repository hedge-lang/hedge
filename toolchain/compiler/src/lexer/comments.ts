import type { Token } from "./token.js";

/**
 * Identify a line comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with a line comment.
 */
export function isLineComment(source: string, index: number): boolean {
  return source[index] === "/" && source[index + 1] === "/";
}

/**
 * Parse a line comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the comment.
 */
export function parseLineComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  void tokens;
  for (let i = start + 2; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\n" || ch === "\r") {
      return i;
    }
  }
  return source.length;
}

/**
 * Identify a block comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with a block comment.
 */
export function isBlockComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "*" &&
    source[index + 2] !== "*" &&
    source[index + 2] !== "!"
  );
}

/**
 * Parse a block comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the comment.
 */
export function parseBlockComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  void tokens;
  for (let i = start + 2; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      return i + 2;
    }
  }
  throw new SyntaxError("Unterminated block comment", {
    cause: { start, end: source.length },
  });
}
