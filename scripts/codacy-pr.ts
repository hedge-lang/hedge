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

export function codacyCheckState(checksOutput: string): CheckState {
  const row = checksOutput
    .split("\n")
    .find((line) => line.startsWith("Codacy Static Code Analysis"));
  if (row === undefined) return "missing";
  const state = row.split("\t")[1];
  return state === "pass" || state === "fail" ? state : "pending";
}

function runOut(command: string, args: readonly string[]): string {
  return spawnSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
}

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${result.stdout}${result.stderr}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function reanalyze(pr: string): Promise<void> {
  run("codacy", ["pull-request", ...REPO, pr, "--reanalyze"]);
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    const state = codacyCheckState(run("gh", ["pr", "checks", pr]));
    if (state === "pass" || state === "fail") {
      console.log(`codacy-pr: check ${state}`);
      process.exitCode = state === "pass" ? 0 : 1;
      return;
    }
    await sleep(POLL_MS);
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
    console.log(
      run("codacy", [
        "pull-request",
        ...REPO,
        pr,
        "--ignore-issue",
        id,
        "--ignore-reason",
        "FalsePositive",
      ]).trim(),
    );
  }
}

async function main(): Promise<void> {
  const [command, pr, ...rest] = process.argv.slice(2);
  if (pr === undefined) {
    console.error("usage: codacy-pr.ts <issues|dismiss|reanalyze> <pr> [ids]");
    process.exitCode = 2;
  } else if (command === "issues") {
    listIssues(pr);
  } else if (command === "dismiss" && rest.length > 0) {
    dismiss(pr, rest);
  } else if (command === "reanalyze") {
    await reanalyze(pr);
  } else {
    console.error("usage: codacy-pr.ts <issues|dismiss|reanalyze> <pr> [ids]");
    process.exitCode = 2;
  }
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
