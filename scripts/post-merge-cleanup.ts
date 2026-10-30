/**
 * Moves to a fresh `main` after a squash-merge and deletes the local branches
 * whose remote counterpart is gone.
 *
 * Run: node --experimental-strip-types scripts/post-merge-cleanup.ts
 */

import { execFileSync } from "node:child_process";

const KEPT_BRANCHES: ReadonlySet<string> = new Set(["main"]);

export const BRANCH_LIST_FORMAT =
  "%(refname:short)%09%(upstream:track)%09%(worktreepath)";

export function goneBranches(branchList: string): readonly string[] {
  return branchList.split("\n").flatMap((line) => {
    const [name, track, worktree] = line.split("\t");
    return name !== undefined &&
      track === "[gone]" &&
      worktree === "" &&
      !KEPT_BRANCHES.has(name)
      ? [name]
      : [];
  });
}

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8" });
}

function main(): void {
  if (git(["status", "--porcelain"]).trim() !== "") {
    console.error("post-merge-cleanup: working tree is dirty, aborting.");
    process.exitCode = 1;
    return;
  }
  git(["checkout", "main"]);
  git(["pull", "--ff-only"]);
  git(["fetch", "--prune"]);
  const gone = goneBranches(
    git(["for-each-ref", `--format=${BRANCH_LIST_FORMAT}`, "refs/heads"]),
  );
  for (const name of gone) {
    git(["branch", "-D", name]);
    console.log(`post-merge-cleanup: deleted ${name}`);
  }
  if (gone.length === 0) {
    console.log("post-merge-cleanup: no stale local branches.");
  }
}

if (process.argv[1] === import.meta.filename) {
  main();
}
