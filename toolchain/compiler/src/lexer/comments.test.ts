import { describe, expect, it } from "vitest";
import { isErr } from "../result.js";
import { isSome } from "../option.js";
import {
  isLineComment,
  tokenizeLineComment,
  isBlockComment,
  tokenizeBlockComment,
} from "./comments.js";
import type { Token } from "./token.js";
import { assert } from "../assert.js";

describe("LineComment", (): void => {
  it("processes a line comment", (): void => {
    const lineComment = "// foo bar";
    const tokens: Token[] = [];
    const maybeIsLine = isLineComment(lineComment, 0);
    expect(isErr(maybeIsLine)).toBe(false);
    if (!isErr(maybeIsLine)) expect(maybeIsLine.value).toBe(true);
    const result = tokenizeLineComment(tokens, [], lineComment, 0);
    assert(isSome(result), "tokenizeLineComment returned None");
    const nextIndex = result.value;
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
    const maybeIsBlock = isBlockComment(blockComment, 0);
    expect(isErr(maybeIsBlock)).toBe(false);
    if (!isErr(maybeIsBlock)) expect(maybeIsBlock.value).toBe(true);
    const result = tokenizeBlockComment(tokens, [], blockComment + "  ", 0);
    assert(isSome(result), "tokenizeBlockComment returned None");
    const nextIndex = result.value;
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(blockComment[nextIndex]).toBeUndefined();
    expect(blockComment[nextIndex - 1]).not.toBeUndefined();
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });

  it("supports nested block comments", () => {
    const blockComment = "/* foo /* bar */ baz */";
    const tokens: Token[] = [];
    const maybeIsBlock = isBlockComment(blockComment, 0);
    expect(isErr(maybeIsBlock)).toBe(false);
    if (!isErr(maybeIsBlock)) expect(maybeIsBlock.value).toBe(true);
    const result = tokenizeBlockComment(tokens, [], blockComment + "  ", 0);
    assert(isSome(result), "tokenizeBlockComment returned None");
    const nextIndex = result.value;
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(blockComment[nextIndex]).toBeUndefined();
    expect(blockComment[nextIndex - 1]).not.toBeUndefined();
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });

  it("supports nested block comments opened with /**", () => {
    const blockComment = "/* foo /** bar */ baz */";
    const tokens: Token[] = [];
    const result = tokenizeBlockComment(tokens, [], blockComment + "  ", 0);
    assert(isSome(result), "tokenizeBlockComment returned None");
    const nextIndex = result.value;
    expect(blockComment.slice(0, nextIndex)).toBe(blockComment);
    expect(nextIndex).toBe(blockComment.length);
    expect(tokens).toEqual([]);
  });
});
