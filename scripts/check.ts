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

const FORMAT_SUMMARY_PREFIX = "[warn] Code style issues found";
const FINDING =
  /\berror\b|✖|\bFAIL\b|^\[warn\]|\bwarning\b|check-proof-refs: (?:MISSING|\d+ unresolved)/i;
const STEP_LABEL = /^\[[^\]]*\]\s?/;
const FILE_HEADER = /^(?:\/|[A-Za-z]:[\\/])\S*$/;

export function findings(
  log: string,
  isExcluded: (file: string) => boolean,
): readonly string[] {
  const kept: string[] = [];
  let pendingHeader: string | undefined;
  for (const raw of log.split("\n")) {
    const line = raw.replace(STEP_LABEL, "").trimEnd();
    if (FILE_HEADER.test(line)) {
      pendingHeader = line;
      continue;
    }
    if (!FINDING.test(line) || line.startsWith(FORMAT_SUMMARY_PREFIX)) continue;
    const file = /^\[warn\]\s+(\S+)/.exec(line)?.[1];
    if (file !== undefined && isExcluded(file)) continue;
    if (pendingHeader !== undefined) {
      kept.push(pendingHeader);
      pendingHeader = undefined;
    }
    kept.push(line);
  }
  return kept;
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
