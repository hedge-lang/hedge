import { describe, expect, it } from "vitest";

import { shellSplit } from "./shell-split.js";

describe("shellSplit", (): void => {
  it("splits a bare command with no arguments", (): void => {
    expect(shellSplit("hedge-compiler")).toEqual(["hedge-compiler"]);
  });

  it("splits space-separated arguments", (): void => {
    expect(shellSplit("node /path/to/compiler.js --flag")).toEqual([
      "node",
      "/path/to/compiler.js",
      "--flag",
    ]);
  });

  it("preserves a single-quoted path with spaces", (): void => {
    expect(shellSplit("node '/path with spaces/compiler.js'")).toEqual([
      "node",
      "/path with spaces/compiler.js",
    ]);
  });

  it("preserves a double-quoted path with spaces", (): void => {
    expect(shellSplit('node "/path with spaces/compiler.js" --flag')).toEqual([
      "node",
      "/path with spaces/compiler.js",
      "--flag",
    ]);
  });

  it("collapses repeated whitespace between tokens", (): void => {
    expect(shellSplit("node   compiler.js")).toEqual(["node", "compiler.js"]);
  });

  it("returns an empty array for an empty string", (): void => {
    expect(shellSplit("")).toEqual([]);
  });
});
