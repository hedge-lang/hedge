import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";
import { CONFORMANCE_FIXTURE_MANIFEST } from "./fixtures/manifest.js";

interface SourceMapMapping {
  readonly generatedStart: number;
  readonly generatedEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

interface SourceMapArtifact {
  readonly version: 3;
  readonly mappings: readonly SourceMapMapping[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseMapping(value: unknown): SourceMapMapping | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const { generatedStart, generatedEnd, sourceStart, sourceEnd } = record;
  if (
    typeof generatedStart !== "number" ||
    typeof generatedEnd !== "number" ||
    typeof sourceStart !== "number" ||
    typeof sourceEnd !== "number"
  ) {
    return null;
  }
  return {
    generatedStart,
    generatedEnd,
    sourceStart,
    sourceEnd,
  };
}

function extractSourceMap(codeValue: unknown): SourceMapArtifact | null {
  const codeRecord = asRecord(codeValue);
  if (codeRecord === null || !("sourceMap" in codeRecord)) {
    return null;
  }
  const sourceMapRecord = asRecord(codeRecord["sourceMap"]);
  if (sourceMapRecord === null) {
    return null;
  }
  if (
    sourceMapRecord["version"] !== 3 ||
    !Array.isArray(sourceMapRecord["mappings"])
  ) {
    return null;
  }
  const mappings = sourceMapRecord["mappings"]
    .map(parseMapping)
    .filter((mapping): mapping is SourceMapMapping => mapping !== null);
  if (mappings.length !== sourceMapRecord["mappings"].length) {
    return null;
  }
  return { version: 3, mappings };
}

function extractJavascript(codeValue: unknown): string | null {
  const codeRecord = asRecord(codeValue);
  if (codeRecord === null || !("javascript" in codeRecord)) {
    return null;
  }
  const jsOption = asRecord(codeRecord["javascript"]);
  if (jsOption === null || jsOption["kind"] !== "Some") {
    return null;
  }
  return typeof jsOption["value"] === "string" ? jsOption["value"] : null;
}

function findCoveringMapping(
  mappings: readonly SourceMapMapping[],
  generatedStart: number,
  generatedEnd: number,
): SourceMapMapping | null {
  return (
    mappings.find(
      (mapping) =>
        mapping.generatedStart <= generatedStart &&
        mapping.generatedEnd >= generatedEnd,
    ) ?? null
  );
}

const EXPECTED_SOURCE_SNIPPETS: Readonly<Record<string, string>> = {
  "map-main-callsite": `print("x")`,
  "map-branch-expression": `if true { print("yes"); } else { print("no"); }`,
  "map-let-expression": `let x = 1 + 2;`,
  "map-function-decl": `fn add(x: i32, y: i32) -> i32 { x + y }`,
};

describe("source map conformance", (): void => {
  it("compile output exposes source-map artifacts with mapping table", (): void => {
    const result = compile(`fn main() { print("x"); }`);
    expect(isSome(result.code)).toBe(true);
    if (!isSome(result.code)) {
      return;
    }
    const sourceMap = extractSourceMap(result.code.value);
    expect(sourceMap).not.toBeNull();
    if (sourceMap === null) {
      return;
    }
    expect(sourceMap.version).toBe(3);
    expect(sourceMap.mappings.length).toBeGreaterThan(0);
  });

  it("fixtures compile to JS snippets that have covering source-map mappings", (): void => {
    expect(
      CONFORMANCE_FIXTURE_MANIFEST.sourceMapActivation.length,
    ).toBeGreaterThan(0);
    for (const fixture of CONFORMANCE_FIXTURE_MANIFEST.sourceMapActivation) {
      expect(fixture.id.length).toBeGreaterThan(0);
      expect(fixture.source.length).toBeGreaterThan(0);
      expect(fixture.expectedGeneratedSnippet.length).toBeGreaterThan(0);
      const result = compile(fixture.source);
      expect(isSome(result.code)).toBe(true);
      if (!isSome(result.code)) {
        return;
      }
      const sourceMap = extractSourceMap(result.code.value);
      expect(sourceMap).not.toBeNull();
      if (sourceMap === null) {
        return;
      }
      const javascript = extractJavascript(result.code.value);
      expect(javascript).not.toBeNull();
      if (javascript === null) {
        return;
      }
      const generatedStart = javascript.indexOf(
        fixture.expectedGeneratedSnippet,
      );
      expect(generatedStart).toBeGreaterThanOrEqual(0);
      const generatedEnd =
        generatedStart + fixture.expectedGeneratedSnippet.length;
      const mapping = findCoveringMapping(
        sourceMap.mappings,
        generatedStart,
        generatedEnd,
      );
      expect(mapping).not.toBeNull();
    }
  });

  it("maps generated JS locations back to Hedge source spans", (): void => {
    for (const fixture of CONFORMANCE_FIXTURE_MANIFEST.sourceMapActivation) {
      const result = compile(fixture.source);
      expect(isSome(result.code)).toBe(true);
      if (!isSome(result.code)) {
        return;
      }

      const sourceMap = extractSourceMap(result.code.value);
      expect(sourceMap).not.toBeNull();
      const javascript = extractJavascript(result.code.value);
      expect(javascript).not.toBeNull();
      if (sourceMap === null || javascript === null) {
        return;
      }

      const generatedStart = javascript.indexOf(
        fixture.expectedGeneratedSnippet,
      );
      expect(generatedStart).toBeGreaterThanOrEqual(0);
      const generatedEnd =
        generatedStart + fixture.expectedGeneratedSnippet.length;
      const mapping = findCoveringMapping(
        sourceMap.mappings,
        generatedStart,
        generatedEnd,
      );
      expect(mapping).not.toBeNull();
      if (mapping === null) {
        return;
      }

      const sourceSlice = fixture.source.slice(
        mapping.sourceStart,
        mapping.sourceEnd,
      );
      expect(sourceSlice.length).toBeGreaterThan(0);
      const expectedSnippet = EXPECTED_SOURCE_SNIPPETS[fixture.id];
      expect(expectedSnippet).toBeDefined();
      expect(sourceSlice).toContain(expectedSnippet);
    }
  });
});
