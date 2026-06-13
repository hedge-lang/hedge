import type { Token } from "./token.js";
import { isWhitespace } from "./whitespace.js";

export function isComment(source: string, index: number): boolean {
  return (
    isBlockComment(source, index) ||
    isBlockOuterDocComment(source, index) ||
    isBlockInnerDocComment(source, index) ||
    isLineComment(source, index)
  );
}

export function parseComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  if (isLineComment(source, start)) {
    return parseLineComment(tokens, source, start);
  } else if (isBlockComment(source, start)) {
    return parseBlockComment(tokens, source, start);
  } else if (isBlockOuterDocComment(source, start)) {
    return parseBlockOuterDocComment(tokens, source, start);
  } else if (isBlockInnerDocComment(source, start)) {
    return parseBlockInnerDocComment(tokens, source, start);
  } else {
    throw new SyntaxError("Expected comment", {
      cause: { start, end: start + 1 },
    });
  }
}

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
    if (ch === "\n") {
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
  const OFFSET_START = 2;
  const OFFSET_END = 2;
  void tokens;
  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      return i + OFFSET_END;
    }
  }
  throw new SyntaxError("Unterminated block comment", {
    cause: { start, end: source.length },
  });
}

/**
 * Identify a block comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with a block comment.
 */
export function isBlockOuterDocComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "*" &&
    source[index + 2] == "*"
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
export function parseBlockOuterDocComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const OFFSET_START = 3;
  const OFFSET_END = 2;

  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      const end = i + OFFSET_END;
      tokens.push({
        kind: "doc-outer",
        text: normalizeComment(source.slice(start + OFFSET_START + 1, i)),
        span: {
          start,
          end,
        },
      });
      return end;
    }
  }
  throw new SyntaxError("Unterminated block comment", {
    cause: { start, end: source.length },
  });
}

/**
 * Identify a block comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with a block comment.
 */
export function isBlockInnerDocComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "*" &&
    source[index + 2] == "!"
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
export function parseBlockInnerDocComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const OFFSET_START = 3;
  const OFFSET_END = 2;

  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      const end = i + OFFSET_END;
      tokens.push({
        kind: "doc-inner",
        text: normalizeComment(source.slice(start + OFFSET_START + 1, i)),
        span: {
          start,
          end,
        },
      });
      return end;
    }
  }
  throw new SyntaxError("Unterminated block comment", {
    cause: { start, end: source.length },
  });
}

/**
 * Normalize a comment by removing leading whitespace.
 *
 * @param text The comment text.
 *
 * @returns The normalized comment text.
 */
function normalizeComment(text: string): string {
  const lines = text.split("\n");
  let minIndent: number | null = null;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      if (!isWhitespace(line, i)) {
        minIndent = Math.min(minIndent ?? i, i);
        break;
      }
    }
  }

  const indent = minIndent ?? 0;
  return lines.map((line) => line.slice(indent)).join("\n");
}
