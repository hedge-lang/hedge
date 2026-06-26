import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

interface SourceMapActivationFixture {
  readonly id: string;
  readonly source: string;
  readonly expectedGeneratedSnippet: string;
}

const ACTIVATION_FIXTURES: readonly SourceMapActivationFixture[] = [
  {
    id: "map-main-callsite",
    source: `fn main() { print("x"); }`,
    expectedGeneratedSnippet: `main();`,
  },
  {
    id: "map-branch-expression",
    source: `fn main() { if true { print("yes"); } else { print("no"); } }`,
    expectedGeneratedSnippet: `if (true)`,
  },
  {
    id: "map-let-expression",
    source: `fn main() { let x = 1 + 2; print(x); }`,
    expectedGeneratedSnippet: `const x = 1 + 2;`,
  },
];

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

  it("defines activation fixtures for future round-trip validation", (): void => {
    expect(ACTIVATION_FIXTURES.length).toBeGreaterThan(0);
    for (const fixture of ACTIVATION_FIXTURES) {
      expect(fixture.id.length).toBeGreaterThan(0);
      expect(fixture.source.length).toBeGreaterThan(0);
      expect(fixture.expectedGeneratedSnippet.length).toBeGreaterThan(0);
    }
  });

  it.skip("maps generated JS locations back to Hedge source spans", (): void => {
    // Activation checklist:
    // 1) compile() exposes a stable source-map artifact in Code.
    // 2) Each fixture in ACTIVATION_FIXTURES validates generated location -> Hedge span mapping.
    // 3) Mapping asserts both line/column and source text slice equivalence.
    expect(true).toBe(true);
  });
});
