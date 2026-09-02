import { readFileSync } from "node:fs";

import { isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

import {
  discoverMustFailFixtures,
  renderDiagnostics,
  structuredDiagnostics,
} from "./fixture-harness.js";
import { compileHedgeCode } from "./test-harness.js";

describe("must-fail fixtures", (): void => {
  const fixtures = discoverMustFailFixtures();

  it("has at least 3 must-fail fixtures", (): void => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  it.each(fixtures)(
    "rejects $name with the expected structured diagnostics",
    async (fixture): Promise<void> => {
      const source = readFileSync(fixture.sourcePath, "utf8");
      const result = compileHedgeCode(source);
      expect(isSome(result.code), "expected compilation to fail").toBe(false);

      await expect(
        structuredDiagnostics(result.diagnostics),
      ).toMatchFileSnapshot(fixture.expectedDiagPath);
      await expect(renderDiagnostics(result.diagnostics)).toMatchFileSnapshot(
        fixture.expectedPath,
      );
    },
  );

  it("pins a rejection by kind and payload, not by rendered wording", (): void => {
    const fixture = fixtures.find(
      (f) => f.name === "named-struct-called-as-function",
    );
    if (fixture === undefined) {
      throw new Error("expected the named-struct-called-as-function fixture");
    }

    const structured = readFileSync(fixture.expectedDiagPath, "utf8");
    expect(structured).toContain('"kind": "SemStructHasNamedFields"');
    expect(structured).toContain('"structName": "Point"');

    // The English sentence lives only in the .expected.stderr snapshot; a
    // reword regenerates that file and leaves the structured one untouched.
    const sentence = readFileSync(fixture.expectedPath, "utf8")
      .split("]:")[1]
      ?.trim();
    expect(sentence).toBeTruthy();
    expect(structured).not.toContain(sentence);
  });
});
