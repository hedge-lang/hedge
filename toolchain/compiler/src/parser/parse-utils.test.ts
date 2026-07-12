import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isErr } from "../result.js";
import { tokenize } from "../lexer/lexer.js";
import {
  skipBalancedBraceBlock,
  skipToItemStartKeyword,
  skipUntil,
  skipUntilKind,
} from "./parse-utils.js";

describe("skipBalancedBraceBlock", (): void => {
  it("errors instead of skipping when the starting token is not `{`", (): void => {
    const { tokens } = tokenize("foo }");
    const result = skipBalancedBraceBlock(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toContain("expected `{` to start block");
    expect(result.error.message).toContain("found `ident`");
  });

  it("errors instead of hanging when EOF is reached without a matching `}`", (): void => {
    const { tokens } = tokenize("{ foo(); { bar();");
    const result = skipBalancedBraceBlock(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toContain(
      "expected `}` to close block, found end of input",
    );
  });
});

describe("skipUntil", (): void => {
  it("stops at the first token matching the predicate", (): void => {
    const { tokens } = tokenize("foo bar , baz");
    const next = skipUntil(tokens, 0, (tok) => tok.kind === "comma");
    expect(tokens[next]?.kind).toBe("comma");
  });

  it("returns pos unchanged when the predicate already matches at pos", (): void => {
    const { tokens } = tokenize(", foo");
    const next = skipUntil(tokens, 0, (tok) => tok.kind === "comma");
    expect(next).toBe(0);
  });

  it("stops at EOF instead of hanging when the predicate never matches", (): void => {
    const { tokens } = tokenize("foo bar baz");
    const next = skipUntil(tokens, 0, (tok) => tok.kind === "comma");
    expect(tokens[next]?.kind).toBe("eof");
  });
});

describe("skipUntilKind", (): void => {
  it("stops at the first token matching any of the given kinds", (): void => {
    const { tokens } = tokenize("foo bar ) baz");
    const next = skipUntilKind(tokens, 0, "comma", "rparen");
    expect(tokens[next]?.kind).toBe("rparen");
  });

  it("stops at EOF when none of the given kinds appear", (): void => {
    const { tokens } = tokenize("foo bar baz");
    const next = skipUntilKind(tokens, 0, "comma", "rparen");
    expect(tokens[next]?.kind).toBe("eof");
  });
});

describe("skipToItemStartKeyword", (): void => {
  it("stops at a top-level `fn` keyword", (): void => {
    const { tokens } = tokenize("123 bar fn foo() {}");
    const next = skipToItemStartKeyword(tokens, 0);
    expect(tokens[next]).toMatchObject({ kind: "keyword", text: "fn" });
  });

  it("stops at a `pub` keyword ahead of a later `fn`, preserving visibility on resume", (): void => {
    const { tokens } = tokenize("123 pub fn foo() {}");
    const next = skipToItemStartKeyword(tokens, 0);
    expect(tokens[next]).toMatchObject({ kind: "keyword", text: "pub" });
  });

  it("does not stop at non-item keywords like `mut` or `where`", (): void => {
    const { tokens } = tokenize("mut where struct Foo {}");
    const next = skipToItemStartKeyword(tokens, 0);
    expect(tokens[next]).toMatchObject({ kind: "keyword", text: "struct" });
  });

  it("stops at EOF instead of hanging when no item keyword follows", (): void => {
    const { tokens } = tokenize("123 456 789");
    const next = skipToItemStartKeyword(tokens, 0);
    expect(tokens[next]?.kind).toBe("eof");
  });
});
