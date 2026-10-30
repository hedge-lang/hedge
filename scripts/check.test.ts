import { describe, expect, it } from "vitest";

import { findings } from "./check.js";

const excludesNothing = (): boolean => false;

describe("findings", (): void => {
  it("keeps a format warning for a file and drops the summary line", (): void => {
    const log = [
      "[check:format    ] [warn] toolchain/compiler/src/prelude.ts",
      "[check:format    ] [warn] Code style issues found in 1 file. Run Prettier with --write to fix.",
    ].join("\n");

    expect(findings(log, excludesNothing)).toEqual([
      "[warn] toolchain/compiler/src/prelude.ts",
    ]);
  });

  it("keeps lint and type errors from interleaved steps", (): void => {
    const log = [
      "[check:types     ] src/a.ts(1,1): error TS2322: bad",
      "[check:lint      ] ✖ 1 problem (1 error, 0 warnings)",
      "[check:deps      ] all good",
    ].join("\n");

    expect(findings(log, excludesNothing)).toEqual([
      "src/a.ts(1,1): error TS2322: bad",
      "✖ 1 problem (1 error, 0 warnings)",
    ]);
  });

  it("returns nothing for a clean run", (): void => {
    expect(
      findings(
        "[check:types     ] done\n[check:lint      ] done",
        excludesNothing,
      ),
    ).toEqual([]);
  });

  it("keeps proof-ref diagnostics that carry no error keyword", (): void => {
    const log = [
      '[check:proof-refs] check-proof-refs: MISSING  rule R1 references "t" but it appears in no .v file',
      "[check:proof-refs] check-proof-refs: 1 unresolved proof reference(s). Add the theorem.",
      "[check:proof-refs] check-proof-refs: OK       rule R2",
    ].join("\n");

    expect(findings(log, excludesNothing)).toEqual([
      'check-proof-refs: MISSING  rule R1 references "t" but it appears in no .v file',
      "check-proof-refs: 1 unresolved proof reference(s). Add the theorem.",
    ]);
  });

  it("keeps the ESLint file header above its first problem once", (): void => {
    const log = [
      "[check:lint      ] /repo/src/a.ts",
      "[check:lint      ]   3:1  error  Unexpected thing  no-thing",
      "[check:lint      ]   4:1  error  Another thing  no-other",
      "[check:lint      ] /repo/src/clean.ts",
      "[check:lint      ] /repo/src/b.ts",
      "[check:lint      ]   9:2  error  Third thing  no-third",
    ].join("\n");

    expect(findings(log, excludesNothing)).toEqual([
      "/repo/src/a.ts",
      "  3:1  error  Unexpected thing  no-thing",
      "  4:1  error  Another thing  no-other",
      "/repo/src/b.ts",
      "  9:2  error  Third thing  no-third",
    ]);
  });

  it("drops a format warning for an excluded file behind a padded label", (): void => {
    const log = "[check:format    ] [warn] CLAUDE.md";

    expect(findings(log, (file) => file === "CLAUDE.md")).toEqual([]);
  });
});
