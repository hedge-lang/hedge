/**
 * Codacy PR triage for this repository.
 *
 *   codacy-pr.ts issues <pr>                  list new issues
 *   codacy-pr.ts dismiss <pr> <resultDataId>  ignore issues as false positives
 *   codacy-pr.ts reanalyze <pr>               reanalyze, then wait for the check
 *
 * Run: node --experimental-strip-types scripts/codacy-pr.ts <command> ...
 */

import { spawnSync } from "node:child_process";

const REPO: readonly string[] = ["gh", "hedge-lang", "hedge"];
const CODACY_CHECK = "Codacy Static Code Analysis";
const POLL_MS = 15_000;
const POLL_LIMIT = 40;

export interface CodacyIssue {
  readonly resultDataId: number;
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function issueFrom(entry: unknown): CodacyIssue | undefined {
  if (!isRecord(entry) || !isRecord(entry["commitIssue"])) return undefined;
  const issue = entry["commitIssue"];
  const pattern = issue["patternInfo"];
  if (
    typeof issue["resultDataId"] !== "number" ||
    typeof issue["filePath"] !== "string" ||
    typeof issue["lineNumber"] !== "number" ||
    typeof issue["message"] !== "string" ||
    !isRecord(pattern) ||
    typeof pattern["id"] !== "string"
  ) {
    return undefined;
  }
  return {
    resultDataId: issue["resultDataId"],
    file: issue["filePath"],
    line: issue["lineNumber"],
    pattern: pattern["id"],
    message: issue["message"],
  };
}

export function parseNewIssues(json: string): readonly CodacyIssue[] {
  const parsed: unknown = JSON.parse(json.slice(json.indexOf("{")));
  if (!isRecord(parsed) || !Array.isArray(parsed["newIssues"])) return [];
  const entries: readonly unknown[] = parsed["newIssues"];
  return entries
    .map(issueFrom)
    .filter((issue): issue is CodacyIssue => issue !== undefined);
}

export function formatIssue(issue: CodacyIssue): string {
  return `${String(issue.resultDataId)}  ${issue.file}:${String(issue.line)}  ${issue.pattern}  ${issue.message}`;
}

export type CheckState = "pending" | "pass" | "fail" | "missing";

export interface CodacyCheck {
  readonly state: CheckState;
  readonly completedAt: string | undefined;
}

const NO_CHECK: CodacyCheck = { state: "missing", completedAt: undefined };

function parseChecks(json: string): readonly unknown[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function codacyCheck(
  checksJson: string,
  staleCompletedAt: string | undefined,
): CodacyCheck {
  const entry = parseChecks(checksJson).find(
    (item) => isRecord(item) && item["name"] === CODACY_CHECK,
  );
  if (!isRecord(entry)) return NO_CHECK;
  const completedAt =
    typeof entry["completedAt"] === "string" && entry["completedAt"] !== ""
      ? entry["completedAt"]
      : undefined;
  const terminal = entry["bucket"] === "pass" || entry["bucket"] === "fail";
  if (!terminal || completedAt === staleCompletedAt) {
    return { state: "pending", completedAt };
  }
  return {
    state: entry["bucket"] === "pass" ? "pass" : "fail",
    completedAt,
  };
}

function runOut(command: string, args: readonly string[]): string {
  return spawnSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
}

interface RunResult {
  readonly ok: boolean;
  readonly output: string;
}

function run(command: string, args: readonly string[]): RunResult {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`,
  };
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function currentCheck(pr: string, stale: string | undefined): CodacyCheck {
  return codacyCheck(
    runOut("gh", ["pr", "checks", pr, "--json", "name,bucket,completedAt"]),
    stale,
  );
}

function reanalyze(pr: string): void {
  const stale = currentCheck(pr, undefined).completedAt;
  const request = run("codacy", ["pull-request", ...REPO, pr, "--reanalyze"]);
  if (!request.ok) {
    console.error(request.output.trim());
    process.exitCode = 1;
    return;
  }
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    const { state } = currentCheck(pr, stale);
    if (state === "pass" || state === "fail") {
      console.log(`codacy-pr: check ${state}`);
      process.exitCode = state === "pass" ? 0 : 1;
      return;
    }
    sleep(POLL_MS);
  }
  console.log("codacy-pr: check still pending after waiting");
  process.exitCode = 1;
}

function listIssues(pr: string): void {
  const issues = parseNewIssues(
    runOut("codacy", ["pull-request", ...REPO, pr, "--output", "json"]),
  );
  for (const issue of issues) console.log(formatIssue(issue));
  console.log(`codacy-pr: ${String(issues.length)} new issue(s)`);
}

function dismiss(pr: string, ids: readonly string[]): void {
  for (const id of ids) {
    const result = run("codacy", [
      "pull-request",
      ...REPO,
      pr,
      "--ignore-issue",
      id,
      "--ignore-reason",
      "FalsePositive",
    ]);
    if (!result.ok) {
      console.error(result.output.trim());
      process.exitCode = 1;
      return;
    }
    console.log(result.output.trim());
  }
}

function main(): void {
  const [command, pr, ...rest] = process.argv.slice(2);
  const known =
    command === "issues" ||
    command === "reanalyze" ||
    (command === "dismiss" && rest.length > 0);
  if (pr === undefined || !known) {
    console.error("usage: codacy-pr.ts <issues|dismiss|reanalyze> <pr> [ids]");
    process.exitCode = 2;
    return;
  }
  if (command === "issues") listIssues(pr);
  else if (command === "dismiss") dismiss(pr, rest);
  else reanalyze(pr);
}

if (process.argv[1] === import.meta.filename) {
  main();
}
