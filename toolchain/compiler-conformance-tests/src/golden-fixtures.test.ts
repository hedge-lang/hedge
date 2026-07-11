import { readFileSync } from "node:fs";

import { isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

import { discoverGoldenFixtures } from "./fixture-harness.js";
import { compileHedgeCode } from "./test-harness.js";

describe("golden fixtures", (): void => {
  const fixtures = discoverGoldenFixtures();

  it("has at least 3 golden fixtures", (): void => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  it.each(fixtures)("emits expected JS for $name", async (fixture): Promise<void> => {
    const source = readFileSync(fixture.sourcePath, "utf8");
    const result = compileHedgeCode(source);
    expect(isSome(result.code), "expected compilation to succeed").toBe(true);
    if (!isSome(result.code)) return;
    const { javascript } = result.code.value;
    expect(isSome(javascript), "expected javascript output").toBe(true);
    if (!isSome(javascript)) return;
    await expect(javascript.value).toMatchFileSnapshot(fixture.expectedPath);
  });
});
