import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

describe("source map conformance", (): void => {
  it("documents current contract: compile output does not expose source map artifacts yet", (): void => {
    const result = compile(`fn main() { print("x"); }`);
    expect(isSome(result.code)).toBe(true);
    if (isSome(result.code)) {
      const codeObject: unknown = result.code.value;
      const hasSourceMap =
        typeof codeObject === "object" &&
        codeObject !== null &&
        Object.prototype.hasOwnProperty.call(codeObject, "sourceMap");
      expect(hasSourceMap).toBe(false);
    }
  });

  it.skip("maps generated JS locations back to Hedge source spans", (): void => {
    // Unskip when compile() exposes source-map artifacts in a stable API shape.
    expect(true).toBe(true);
  });
});
