import { readFileSync } from "node:fs";

import { isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

import {
  discoverMustFailFixtures,
  renderDiagnostics,
} from "./fixture-harness.js";
import { compileHedgeCode } from "./test-harness.js";

describe("must-fail fixtures", (): void => {
  const fixtures = discoverMustFailFixtures();

  it("has at least 3 must-fail fixtures", (): void => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  it.each(fixtures)(
    "rejects $name with expected diagnostics",
    async (fixture): Promise<void> => {
      const source = readFileSync(fixture.sourcePath, "utf8");
      const result = compileHedgeCode(source);
      expect(isSome(result.code), "expected compilation to fail").toBe(false);
      const rendered = renderDiagnostics(result.diagnostics);
      await expect(rendered).toMatchFileSnapshot(fixture.expectedPath);
    },
  );
});
