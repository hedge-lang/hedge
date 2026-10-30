import { describe, expect, it } from "vitest";

import { findings } from "./check.js";

const excludesNothing = (): boolean => false;

describe("findings", (): void => {
  it("keeps a format warning for a file and drops the summary line", (): void => {
    const log = [
      "check:format | [warn] toolchain/compiler/src/prelude.ts",
      "check:format | [warn] Code style issues found in 1 file. Run Prettier with --write to fix.",
    ].join("\n");

    expect(findings(log, excludesNothing)).toEqual([
      "[warn] toolchain/compiler/src/prelude.ts",
    ]);
  });

  it("keeps lint and type errors from interleaved steps", (): void => {
    const log = [
      "check:types | src/a.ts(1,1): error TS2322: bad",
      "check:lint | ✖ 1 problem (1 error, 0 warnings)",
      "check:deps | all good",
    ].join("\n");

    expect(findings(log, excludesNothing)).toEqual([
      "src/a.ts(1,1): error TS2322: bad",
      "✖ 1 problem (1 error, 0 warnings)",
    ]);
  });

  it("returns nothing for a clean run", (): void => {
    expect(
      findings("check:types | done\ncheck:lint | done", excludesNothing),
    ).toEqual([]);
  });
});
