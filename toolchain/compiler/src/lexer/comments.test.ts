import { describe, expect, it } from "vitest";
import { isErr } from "../result.js";
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
    expect(lineComment.slice(3, nextIndex)).toBe("foo bar");
    expect(lineComment[nextIndex]).toBeUndefined();
    expect(nextIndex).toBe(lineComment.length);
    expect(tokens).toEqual([]);
  });
});

describe("BlockComment", () => {
  it("processes a block comment", () => {
    const blockComment = "/* foo bar */";
    const tokens: Token[] = [];
    expect(isBlockComment(blockComment, 0)).toBe(true);
    const nextIndexResult = parseBlockComment(tokens, blockComment + "  ", 0);
    if (isErr(nextIndexResult)) {
      throw new Error(
        `Unexpected parse error: ${nextIndexResult.error.message}`,
      );
    }
    const nextIndex = nextIndexResult.value;
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(blockComment[nextIndex]).toBeUndefined();
    expect(blockComment[nextIndex - 1]).not.toBeUndefined();
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });

  it("supports nested block comments", () => {
    const blockComment = "/* foo /* bar */ baz */";
    const tokens: Token[] = [];
    expect(isBlockComment(blockComment, 0)).toBe(true);
    const nextIndexResult = parseBlockComment(tokens, blockComment + "  ", 0);
    if (isErr(nextIndexResult)) {
      throw new Error(
        `Unexpected parse error: ${nextIndexResult.error.message}`,
      );
    }
    const nextIndex = nextIndexResult.value;
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(blockComment[nextIndex]).toBeUndefined();
    expect(blockComment[nextIndex - 1]).not.toBeUndefined();
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });

  it("supports nested block comments opened with /**", () => {
    const blockComment = "/* foo /** bar */ baz */";
    const tokens: Token[] = [];
    const nextIndexResult = parseBlockComment(tokens, blockComment + "  ", 0);
    if (isErr(nextIndexResult)) {
      throw new Error(
        `Unexpected parse error: ${nextIndexResult.error.message}`,
      );
    }
    const nextIndex = nextIndexResult.value;
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });
});
