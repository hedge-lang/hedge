import { describe, expect, it } from "vitest";

import { codacyCheck, formatIssue, parseNewIssues } from "./codacy-pr.js";

const PAYLOAD = `- Fetching pull request details...
{
  "newIssues": [
    {
      "commitIssue": {
        "resultDataId": 131556962574,
        "filePath": "a/b.js",
        "lineNumber": 4,
        "message": "Turn into an arrow function.",
        "patternInfo": { "id": "Biome_lint_complexity_useArrowFunction" }
      },
      "deltaType": "Added"
    },
    { "deltaType": "Added" }
  ]
}`;

describe("parseNewIssues", (): void => {
  it("extracts issues after the CLI's progress line and skips malformed entries", (): void => {
    expect(parseNewIssues(PAYLOAD)).toEqual([
      {
        resultDataId: 131556962574,
        file: "a/b.js",
        line: 4,
        pattern: "Biome_lint_complexity_useArrowFunction",
        message: "Turn into an arrow function.",
      },
    ]);
  });

  it("returns nothing when the payload has no newIssues array", (): void => {
    expect(parseNewIssues("{}")).toEqual([]);
  });
});

describe("formatIssue", (): void => {
  it("renders the dismissable id first, then location, pattern and message", (): void => {
    const issue = parseNewIssues(PAYLOAD)[0];
    if (issue === undefined) throw new Error("fixture has an issue");

    expect(formatIssue(issue)).toBe(
      "131556962574  a/b.js:4  Biome_lint_complexity_useArrowFunction  Turn into an arrow function.",
    );
  });
});

const row = (bucket: string, completedAt: string): object => ({
  name: "Codacy Static Code Analysis",
  bucket,
  completedAt,
});

const checks = (...rows: readonly object[]): string => JSON.stringify(rows);

describe("codacyCheck", (): void => {
  it("reports a passing Codacy row with its completion time", (): void => {
    expect(codacyCheck(checks(row("pass", "T1")), undefined)).toEqual({
      state: "pass",
      completedAt: "T1",
    });
  });

  it("reports a failing Codacy row among other checks", (): void => {
    const output = checks(
      { name: "Check", bucket: "pass", completedAt: "T0" },
      row("fail", "T1"),
    );

    expect(codacyCheck(output, undefined).state).toBe("fail");
  });

  it("reports pending for any other Codacy bucket", (): void => {
    expect(codacyCheck(checks(row("pending", "")), undefined).state).toBe(
      "pending",
    );
  });

  it("reports missing when no Codacy row exists", (): void => {
    expect(
      codacyCheck(
        checks({ name: "Check", bucket: "pass", completedAt: "T0" }),
        undefined,
      ).state,
    ).toBe("missing");
  });

  it("reports missing for output that is not a JSON array", (): void => {
    expect(codacyCheck("no checks reported", undefined).state).toBe("missing");
  });

  it("treats a terminal result with the stale completion time as pending", (): void => {
    expect(codacyCheck(checks(row("pass", "T1")), "T1").state).toBe("pending");
  });

  it("accepts a terminal result whose completion time differs from the stale one", (): void => {
    expect(codacyCheck(checks(row("fail", "T2")), "T1")).toEqual({
      state: "fail",
      completedAt: "T2",
    });
  });
});
