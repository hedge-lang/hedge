import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Ceiling on deliberately-not-passing tests across the whole toolchain, set
 * to the current count so adding one is an edit here rather than a quiet
 * drift. Counts markers, not resulting tests: an `it.fails.each([...])`
 * counts once however many rows it expands to.
 *
 * `it.fails` and `it.todo` are in scope alongside `it.skip`/`it.skipIf`
 * because they are the same thing - a test that does not currently prove
 * what it describes - and T1 is defined as zero `it.fails` in the core
 * fragment (see this package's own notes), which nothing checked before.
 */
const DEBT_BUDGET = 17;

/** Every deliberately-not-passing marker Vitest offers. */
const DEBT_MARKER =
  /\b(?:it|test|describe)\.(?:skip|skipIf|fails|todo)(?:\.each)?\(/g;

/**
 * Ticketed TODO, e.g. `TODO(Hedge-238):`. Neither pattern carries `g`: a
 * global regex's `lastIndex` persists across `test()` calls, so reusing one
 * would alternate between matching and not.
 */
const TICKETED_TODO = /TODO\(Hedge-\d+\)/;
const ANY_TODO = /\bTODO\b/;

function collectFiles(dir: string, suffix: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...collectFiles(fullPath, suffix));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) files.push(fullPath);
  }
  return files;
}

/** The `toolchain/` root, two levels up from this package's `src/`. */
function toolchainRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * Files subject to these rules. Excludes this one: it necessarily spells out
 * the markers and the TODO shape it looks for, and would otherwise count
 * its own documentation as debt.
 */
function governedFiles(suffix: string): string[] {
  return collectFiles(toolchainRoot(), suffix).filter(
    (file) => !file.endsWith("skip-budget-governance.test.ts"),
  );
}

describe("test-debt governance", (): void => {
  it("keeps deliberately-not-passing tests within an explicit budget", (): void => {
    const perFile = governedFiles(".test.ts")
      .map((file) => ({
        file,
        count: Array.from(readFileSync(file, "utf8").matchAll(DEBT_MARKER))
          .length,
      }))
      .filter((entry) => entry.count > 0);
    const total = perFile.reduce((sum, entry) => sum + entry.count, 0);
    expect(
      total,
      `Markers by file:\n${perFile
        .map((e) => `  ${e.count}  ${path.relative(toolchainRoot(), e.file)}`)
        .join("\n")}`,
    ).toBeLessThanOrEqual(DEBT_BUDGET);
  });

  it("requires every TODO to name an issue, so none can outlive its ticket", (): void => {
    const offenders = governedFiles(".ts")
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({ file, line, lineNo: i + 1 }))
          .filter(
            ({ line }) => ANY_TODO.test(line) && !TICKETED_TODO.test(line),
          ),
      )
      .map(
        ({ file, lineNo, line }) =>
          `${path.relative(toolchainRoot(), file)}:${lineNo} ${line.trim()}`,
      );
    expect(
      offenders,
      "Every TODO must be written TODO(Hedge-NNN) and point at an open issue",
    ).toEqual([]);
  });
});
