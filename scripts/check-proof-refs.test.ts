import { describe, expect, it } from "vitest";

import { extractProofRefs, theoremDeclaredIn } from "./check-proof-refs.js";

describe("extractProofRefs", () => {
  it("does not associate a proofRefs-less rule with a later rule's proofRefs", () => {
    const source = `
      export const RULES: readonly ConformanceRule[] = [
        { id: "A", description: "a", testIds: [], proofRefs: ["ThmA"] },
        { id: "B", description: "b", testIds: [] },
        { id: "C", description: "c", testIds: [], proofRefs: ["ThmC"] },
      ];
    `;

    const refs = extractProofRefs(source);

    expect(refs.get("A")).toEqual(["ThmA"]);
    expect(refs.has("B")).toBe(false);
    expect(refs.get("C")).toEqual(["ThmC"]);
  });

  it("returns an empty map when no rule has proofRefs", () => {
    const source = `
      export const RULES = [{ id: "A", description: "a", testIds: [] }];
    `;

    expect(extractProofRefs(source).size).toBe(0);
  });
});

describe("theoremDeclaredIn", () => {
  it("finds an exact theorem name declaration", () => {
    expect(theoremDeclaredIn("Foo", "Theorem Foo : True.")).toBe(true);
  });

  it("does not match a theorem name that is only a substring of a longer identifier", () => {
    expect(theoremDeclaredIn("Foo", "Theorem FooBarLemma : True.")).toBe(false);
  });

  it("finds a theorem name containing an apostrophe", () => {
    expect(theoremDeclaredIn("Foo'", "Theorem Foo' : True.")).toBe(true);
  });

  it("does not match when an apostrophe extends the identifier", () => {
    expect(theoremDeclaredIn("Foo", "Theorem Foo' : True.")).toBe(false);
  });

  it("skips an invalid substring occurrence and finds a later valid match", () => {
    expect(theoremDeclaredIn("Foo", "FooBar Theorem Foo : True.")).toBe(true);
  });
});
