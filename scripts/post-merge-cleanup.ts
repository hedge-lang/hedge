/**
 * Moves to a fresh `main` after a squash-merge and deletes the local branches
 * whose remote counterpart is gone.
 *
 * Run: node --experimental-strip-types scripts/post-merge-cleanup.ts
 */

import { execFileSync } from "node:child_process";

const KEPT_BRANCHES: readonly string[] = ["main"];

export function goneBranches(branchVerbose: string): readonly string[] {
  return branchVerbose
    .split("\n")
    .filter((line) => !line.startsWith("*") && /: gone\]/.test(line))
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(
      (name): name is string =>
        name !== undefined && !KEPT_BRANCHES.includes(name),
    );
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
  const gone = goneBranches(git(["branch", "-vv"]));
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
