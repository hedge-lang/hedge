import { describe, expect, it } from "vitest";
import {
  isLineComment,
  parseLineComment,
  isBlockComment,
  parseBlockComment,
} from "./comments.js";
import type { Token } from "./token.js";

describe("LineComment", (): void => {
  it("processes a line comment", (): void => {
    const lineComment = "// foo bar";
    const tokens: Token[] = [];
    expect(isLineComment(lineComment, 0)).toBe(true);
    const nextIndex = parseLineComment(tokens, lineComment, 0);
    expect(lineComment.slice(3, nextIndex)).toBe(
      lineComment.slice(3, nextIndex),
    );
    expect(lineComment[nextIndex]).toBeUndefined();
    expect(lineComment[nextIndex - 1]).not.toBeUndefined();
    expect(nextIndex).toBe(lineComment.length);
    expect(tokens).toEqual([]);
  });
});

describe("BlockComment", () => {
  it("processes a block comment", () => {
    const blockComment = "/* foo bar */";
    const tokens: Token[] = [];
    expect(isBlockComment(blockComment, 0)).toBe(true);
    const nextIndex = parseBlockComment(tokens, blockComment + "  ", 0);
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(blockComment[nextIndex]).toBeUndefined();
    expect(blockComment[nextIndex - 1]).not.toBeUndefined();
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });
});
