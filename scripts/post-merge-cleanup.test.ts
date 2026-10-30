import { describe, expect, it } from "vitest";

import { goneBranches } from "./post-merge-cleanup.js";

describe("goneBranches", (): void => {
  it("lists a branch whose upstream is gone", (): void => {
    const output = [
      "* main      442083f [origin/main] Squash",
      "  hedge-59  952a0eb [origin/hedge-59: gone] Add Option",
      "  hedge-60  1111111 [origin/hedge-60] Work",
    ].join("\n");

    expect(goneBranches(output)).toEqual(["hedge-59"]);
  });

  it("keeps the checked-out branch even when its upstream is gone", (): void => {
    const output = "* hedge-59  952a0eb [origin/hedge-59: gone] Add Option";

    expect(goneBranches(output)).toEqual([]);
  });

  it("keeps main even when its upstream is gone", (): void => {
    const output = "  main  442083f [origin/main: gone] Squash";

    expect(goneBranches(output)).toEqual([]);
  });

  it("returns nothing for a branch with no upstream", (): void => {
    expect(goneBranches("  scratch  2222222 Local only")).toEqual([]);
  });
});
