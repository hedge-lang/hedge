/**
 * Runs `npm run check` with its interleaved output captured to a log file,
 * then prints the real exit code and only the findings that matter, so a
 * truncated tail can never hide a failing step. Format warnings for
 * git-excluded local files are dropped.
 *
 * Run: node --experimental-strip-types scripts/check.ts
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FORMAT_SUMMARY = /^\[warn\] Code style issues found/;
const FINDING = /\berror\b|✖|\bFAIL\b|^\S*\s?\[warn\]|\bwarning\b/i;

export function findings(
  log: string,
  isExcluded: (file: string) => boolean,
): readonly string[] {
  return log
    .split("\n")
    .map((line) => line.replace(/^\S+\s*\|\s*/, "").trimEnd())
    .filter((line) => FINDING.test(line))
    .filter((line) => !FORMAT_SUMMARY.test(line))
    .filter((line) => {
      const file = /^\[warn\]\s+(\S+)/.exec(line)?.[1];
      return file === undefined || !isExcluded(file);
    });
}

function isGitExcluded(file: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", file]).status === 0;
}

function main(): void {
  const result = spawnSync("npm", ["run", "check"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const log = `${result.stdout}\n${result.stderr}`;
  const logPath = join(tmpdir(), "hedge-check.log");
  writeFileSync(logPath, log);
  const found = findings(log, isGitExcluded);
  for (const line of found) console.log(line);
  console.log(`check: exit ${String(result.status)}, full log at ${logPath}`);
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] === import.meta.filename) {
  main();
}
