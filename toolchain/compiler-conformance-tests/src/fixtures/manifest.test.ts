import { describe, expect, it } from "vitest";

import { CONFORMANCE_FIXTURE_MANIFEST } from "./manifest.js";

describe("conformance fixture manifest", (): void => {
  it("pins fixture manifest version", (): void => {
    expect(CONFORMANCE_FIXTURE_MANIFEST.version).toBe("2026.06.26.1");
  });

  it("has stable fuzz seed/count and key lengths", (): void => {
    expect(CONFORMANCE_FIXTURE_MANIFEST.fuzz.seeds.length).toBe(80);
    expect(CONFORMANCE_FIXTURE_MANIFEST.fuzz.seeds[0]).toBe(1);
    expect(CONFORMANCE_FIXTURE_MANIFEST.fuzz.seeds.at(-1)).toBe(80);
    expect(CONFORMANCE_FIXTURE_MANIFEST.fuzz.smokeLength).toBe(120);
    expect(CONFORMANCE_FIXTURE_MANIFEST.fuzz.signatureLength).toBe(180);
    expect(CONFORMANCE_FIXTURE_MANIFEST.fuzz.signatureSeeds).toEqual([
      3, 7, 11, 19, 29, 47, 71,
    ]);
  });

  it("has stable source-map activation fixture ids", (): void => {
    const ids = CONFORMANCE_FIXTURE_MANIFEST.sourceMapActivation.map(
      (f) => f.id,
    );
    expect(ids).toEqual([
      "map-main-callsite",
      "map-branch-expression",
      "map-let-expression",
    ]);
  });
});
