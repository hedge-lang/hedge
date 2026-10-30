import { describe, expect, it } from "vitest";

import { goneBranches } from "./post-merge-cleanup.js";

const row = (name: string, track: string, worktree = ""): string =>
  `${name}\t${track}\t${worktree}`;

describe("goneBranches", (): void => {
  it("lists a branch whose upstream is gone", (): void => {
    const output = [
      row("main", "", "/repo"),
      row("hedge-59", "[gone]"),
      row("hedge-60", ""),
    ].join("\n");

    expect(goneBranches(output)).toEqual(["hedge-59"]);
  });

  it("keeps a branch checked out in any worktree even when its upstream is gone", (): void => {
    const output = [
      row("hedge-59", "[gone]", "/repo"),
      row("hedge-61", "[gone]", "/other-worktree"),
    ].join("\n");

    expect(goneBranches(output)).toEqual([]);
  });

  it("keeps main even when its upstream is gone", (): void => {
    expect(goneBranches(row("main", "[gone]"))).toEqual([]);
  });

  it("returns nothing for a branch with no upstream", (): void => {
    expect(goneBranches(row("scratch", ""))).toEqual([]);
  });

  it("returns nothing for a branch that is ahead or behind a live upstream", (): void => {
    expect(goneBranches(row("hedge-62", "[ahead 1, behind 2]"))).toEqual([]);
  });

  it("returns nothing for an empty listing", (): void => {
    expect(goneBranches("")).toEqual([]);
  });
});
