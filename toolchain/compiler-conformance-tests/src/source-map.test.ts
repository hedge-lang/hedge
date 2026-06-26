import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";
import { CONFORMANCE_FIXTURE_MANIFEST } from "./fixtures/manifest.js";

function hasSourceMapField(codeValue: unknown): boolean {
  return (
    typeof codeValue === "object" &&
    codeValue !== null &&
    Object.prototype.hasOwnProperty.call(codeValue, "sourceMap")
  );
}

describe("source map conformance", (): void => {
  it("documents current contract: compile output does not expose source map artifacts yet", (): void => {
    const result = compile(`fn main() { print("x"); }`);
    expect(isSome(result.code)).toBe(true);
    if (isSome(result.code)) {
      expect(hasSourceMapField(result.code.value)).toBe(false);
    }
  });

  it("defines activation fixtures for future round-trip validation", (): void => {
    expect(
      CONFORMANCE_FIXTURE_MANIFEST.sourceMapActivation.length,
    ).toBeGreaterThan(0);
    for (const fixture of CONFORMANCE_FIXTURE_MANIFEST.sourceMapActivation) {
      expect(fixture.id.length).toBeGreaterThan(0);
      expect(fixture.source.length).toBeGreaterThan(0);
      expect(fixture.expectedGeneratedSnippet.length).toBeGreaterThan(0);
      const result = compile(fixture.source);
      expect(isSome(result.code)).toBe(true);
      if (isSome(result.code) && isSome(result.code.value.javascript)) {
        expect(result.code.value.javascript.value).toContain(
          fixture.expectedGeneratedSnippet,
        );
      }
    }
  });

  it.skip("maps generated JS locations back to Hedge source spans", (): void => {
    // Activation checklist:
    // 1) compile() exposes a stable source-map artifact in Code.
    // 2) Each fixture in CONFORMANCE_FIXTURE_MANIFEST validates generated location -> Hedge span mapping.
    // 3) Mapping asserts both line/column and source text slice equivalence.
    expect(true).toBe(true);
  });
});
