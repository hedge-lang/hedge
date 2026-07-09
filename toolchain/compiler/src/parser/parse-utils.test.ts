import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isErr } from "../result.js";
import { tokenize } from "../lexer/lexer.js";
import { skipBalancedBraceBlock } from "./parse-utils.js";

describe("skipBalancedBraceBlock", (): void => {
  it("errors instead of skipping when the starting token is not `{`", (): void => {
    const { tokens } = tokenize("foo }");
    const result = skipBalancedBraceBlock(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toContain("expected `{` to start block");
    expect(result.error.message).toContain("found `ident`");
  });
});
