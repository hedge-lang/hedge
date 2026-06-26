import { describe, expect, it } from "vitest";

describe("dual-compiler parity harness (activation stubs)", (): void => {
  it.skip("compares bootstrap and self-hosted compiler outputs on shared corpus", (): void => {
    // Activate when self-hosted compiler binary/API is available.
    // Expected behavior:
    // - run same corpus through both compilers
    // - compare JS output, declaration output, and diagnostics
    // - fail on divergence
    expect(true).toBe(true);
  });

  it.skip("compares bootstrap and self-hosted compiler diagnostics parity", (): void => {
    // Activate with stable diagnostic ID schema.
    // Expected behavior:
    // - compare diagnostic IDs/severity/span shape across both compilers
    // - message text equivalence can be relaxed if IDs are equal
    expect(true).toBe(true);
  });
});
