import { describe, expect, it } from "vitest";

import { codacyCheckState, formatIssue, parseNewIssues } from "./codacy-pr.js";

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

describe("codacyCheckState", (): void => {
  it("reports pass for a passing Codacy row", (): void => {
    expect(
      codacyCheckState("Codacy Static Code Analysis\tpass\t0\thttps://x"),
    ).toBe("pass");
  });

  it("reports fail for a failing Codacy row", (): void => {
    expect(
      codacyCheckState("Check\tpass\t3s\nCodacy Static Code Analysis\tfail\t0"),
    ).toBe("fail");
  });

  it("reports pending for any other Codacy state", (): void => {
    expect(codacyCheckState("Codacy Static Code Analysis\tpending\t0")).toBe(
      "pending",
    );
  });

  it("reports missing when no Codacy row exists", (): void => {
    expect(codacyCheckState("Check\tpass\t3s")).toBe("missing");
  });
});
