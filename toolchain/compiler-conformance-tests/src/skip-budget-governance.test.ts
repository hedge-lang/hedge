import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SKIP_BUDGET = 20;

function collectTestFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function countSkips(content: string): number {
  return (
    Array.from(content.matchAll(/\bit\.skip\(/g)).length +
    Array.from(content.matchAll(/\bit\.skipIf\(/g)).length
  );
}

describe("skip budget governance", (): void => {
  it("total skip and skipIf count stays within explicit budget", (): void => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const files = collectTestFiles(currentDir);
    const totalSkips = files
      .map((file) => readFileSync(file, "utf8"))
      .reduce((sum, content) => sum + countSkips(content), 0);
    expect(totalSkips).toBeLessThanOrEqual(SKIP_BUDGET);
  });
});
