import { type Diagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import { err, ok, type Result } from "../result.js";
import type { Token } from "./token.js";
import { isWhitespace } from "./whitespace.js";

/**
 * Identify if the source at `index` is a comment.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with a comment.
 */
export function isComment(source: string, index: number): boolean {
  return (
    isBlockComment(source, index) ||
    isBlockOuterDocComment(source, index) ||
    isBlockInnerDocComment(source, index) ||
    isLineComment(source, index) ||
    isOuterDocComment(source, index)
  );
}

/**
 * Parse a comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the comment.
 */
export function parseComment(
  tokens: Token[],
  source: string,
  start: number,
): Result<number, Diagnostic> {
  if (isOuterDocComment(source, start)) {
    return ok(parseOuterDocComment(tokens, source, start));
  }
  if (isInnerDocComment(source, start)) {
    return ok(parseInnerDocComment(tokens, source, start));
  }
  if (isLineComment(source, start)) {
    return ok(parseLineComment(tokens, source, start));
  }
  if (isBlockComment(source, start)) {
    return parseBlockComment(tokens, source, start);
  }
  if (isBlockOuterDocComment(source, start)) {
    return parseBlockOuterDocComment(tokens, source, start);
  }
  if (isBlockInnerDocComment(source, start)) {
    return parseBlockInnerDocComment(tokens, source, start);
  }
  return err({
    severity: "error",
    message: "Expected comment",
    span: some({ start, end: start + 1 }),
  });
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
): Result<number, Diagnostic> {
  const OFFSET_START = 2;
  const OFFSET_END = 2;
  void tokens;

  let nesting = 0;
  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "/" && source[i + 1] === "*") {
      nesting += 1;
    }
    if (source[i] === "*" && source[i + 1] === "/") {
      if (nesting === 0) {
        return ok(i + OFFSET_END);
      }
      nesting -= 1;
    }
  }
  return err({
    severity: "error",
    message: "Unterminated block comment",
    span: some({ start, end: source.length }),
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
function isBlockOuterDocComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "*" &&
    source[index + 2] === "*"
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
function parseBlockOuterDocComment(
  tokens: Token[],
  source: string,
  start: number,
): Result<number, Diagnostic> {
  const OFFSET_START = 3;
  const OFFSET_END = 2;

  tokens.push(
    {
      kind: "hash",
      span: { start, end: start },
    },
    {
      kind: "lbracket",
      span: { start, end: start },
    },
    {
      kind: "ident",
      text: "doc",
      span: { start, end: start },
    },
    {
      kind: "lparen",
      span: { start, end: start },
    },
  );

  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      const end = i + OFFSET_END;
      let sliceStart = start + OFFSET_START;
      if (source[sliceStart] === " ") {
        sliceStart += 1;
      }

      const normalizedComments = normalizeComment(source.slice(sliceStart, i));
      for (let j = 0; j < normalizedComments.length; j++) {
        if (j !== 0) {
          tokens.push({
            kind: "comma",
            span: { start, end },
          });
        }
        tokens.push({
          kind: "string",
          text: normalizedComments[j] ?? "",
          span: { start, end },
        });
      }

      tokens.push(
        {
          kind: "rparen",
          span: { start: end, end },
        },
        {
          kind: "rbracket",
          span: { start: end, end },
        },
      );
      return ok(end);
    }
  }
  return err({
    severity: "error",
    message: "Unterminated block comment",
    span: some({ start, end: source.length }),
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
function isBlockInnerDocComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "*" &&
    source[index + 2] === "!"
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
function parseBlockInnerDocComment(
  tokens: Token[],
  source: string,
  start: number,
): Result<number, Diagnostic> {
  const OFFSET_START = 3;
  const OFFSET_END = 2;

  tokens.push(
    {
      kind: "hash",
      span: { start, end: start },
    },
    {
      kind: "bang",
      span: { start, end: start },
    },
    {
      kind: "lbracket",
      span: { start, end: start },
    },
    {
      kind: "ident",
      text: "doc",
      span: { start, end: start },
    },
    {
      kind: "lparen",
      span: { start, end: start },
    },
  );

  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      const end = i + OFFSET_END;
      let sliceStart = start + OFFSET_START;
      if (source[sliceStart] === " ") {
        sliceStart += 1;
      }

      const normalizedComments = normalizeComment(source.slice(sliceStart, i));
      for (let j = 0; j < normalizedComments.length; j++) {
        if (j !== 0) {
          tokens.push({
            kind: "comma",
            span: { start, end },
          });
        }
        tokens.push({
          kind: "string",
          text: normalizedComments[j] ?? "",
          span: { start, end },
        });
      }

      tokens.push(
        {
          kind: "rparen",
          span: { start: end, end },
        },
        {
          kind: "rbracket",
          span: { start: end, end },
        },
      );
      return ok(end);
    }
  }
  return err({
    severity: "error",
    message: "Unterminated block comment",
    span: some({ start, end: source.length }),
  });
}

/**
 * Identify an outer doc comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with an outer doc comment.
 */
function isOuterDocComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "/" &&
    source[index + 2] === "/"
  );
}

/**
 * Parse an outer doc comment starting at `start` in `source`, appending it to `tokens`.
 *
 * Doc comments are lowered into a synthetic `#[doc("...")]` token sequence so
 * the parser assembles them into ordinary `doc` attributes (`///` is sugar for
 * `#[doc = "..."]`); see `parseAttribute` in the parser.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the comment.
 */
function parseOuterDocComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const OFFSET_START = 3;

  tokens.push(
    {
      kind: "hash",
      span: { start, end: start },
    },
    {
      kind: "lbracket",
      span: { start, end: start },
    },
    {
      kind: "ident",
      text: "doc",
      span: { start, end: start },
    },
    {
      kind: "lparen",
      span: { start, end: start },
    },
  );

  const lines: string[] = [];
  let end = source.length;
  for (let i = start; i < source.length; ) {
    while (i < source.length && isWhitespace(source, i)) {
      i += 1;
    }

    if (!isOuterDocComment(source, i)) {
      break;
    }

    let j = i + OFFSET_START;
    const lastStart = j;
    while (j < source.length && source[j] !== "\n") {
      j += 1;
    }
    lines.push(source.slice(lastStart, j));
    i = j + 1;
    end = j;
  }

  const text = lines.join("\n");
  const normalizedComments = normalizeComment(text);
  for (let j = 0; j < normalizedComments.length; j++) {
    if (j !== 0) {
      tokens.push({
        kind: "comma",
        span: { start, end },
      });
    }
    tokens.push({
      kind: "string",
      text: normalizedComments[j] ?? "",
      span: { start, end },
    });
  }

  tokens.push(
    {
      kind: "rparen",
      span: { start: end, end },
    },
    {
      kind: "rbracket",
      span: { start: end, end },
    },
  );
  return end;
}

/**
 * Identify an inner doc comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with an inner doc comment.
 */
function isInnerDocComment(source: string, index: number): boolean {
  return (
    source[index] === "/" &&
    source[index + 1] === "/" &&
    source[index + 2] === "!"
  );
}

function parseInnerDocComment(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const OFFSET_START = 3;

  tokens.push(
    {
      kind: "hash",
      span: { start, end: start },
    },
    {
      kind: "bang",
      span: { start, end: start },
    },
    {
      kind: "lbracket",
      span: { start, end: start },
    },
    {
      kind: "ident",
      text: "doc",
      span: { start, end: start },
    },
    {
      kind: "lparen",
      span: { start, end: start },
    },
  );

  const lines: string[] = [];
  let end = source.length;
  for (let i = start; i < source.length; ) {
    while (i < source.length && isWhitespace(source, i)) {
      i += 1;
    }

    if (!isInnerDocComment(source, i)) {
      break;
    }

    let j = i + OFFSET_START;
    const lastStart = j;
    while (j < source.length && source[j] !== "\n") {
      j += 1;
    }
    lines.push(source.slice(lastStart, j));
    i = j + 1;
    end = j;
  }

  const text = lines.join("\n");

  const normalizedComments = normalizeComment(text);
  for (let j = 0; j < normalizedComments.length; j++) {
    if (j !== 0) {
      tokens.push({
        kind: "comma",
        span: { start, end },
      });
    }
    tokens.push({
      kind: "string",
      text: normalizedComments[j] ?? "",
      span: { start, end },
    });
  }

  tokens.push(
    {
      kind: "rparen",
      span: { start: end, end },
    },
    {
      kind: "rbracket",
      span: { start: end, end },
    },
  );
  return end;
}

/**
 * Normalize a comment by removing leading whitespace.
 *
 * @param text The comment text.
 *
 * @returns The normalized comment text.
 */
function normalizeComment(text: string): string[] {
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
  return lines.map((line) => line.slice(indent));
}
