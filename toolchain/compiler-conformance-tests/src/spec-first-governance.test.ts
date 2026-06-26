import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readSpecFile(fileName: string): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(currentDir, fileName), "utf8");
}

function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

describe("spec-first conformance governance", (): void => {
  it("source-map, diagnostic-code-id, and JS-interop suites avoid long-lived it.skip placeholders", (): void => {
    const files = [
      "source-map.test.ts",
      "diagnostic-code-id.test.ts",
      "js-interop-negative.test.ts",
    ];
    for (const fileName of files) {
      const content = readSpecFile(fileName);
      expect(countMatches(content, /\bit\.skip\(/g)).toBe(0);
    }
  });

  it("dual-compiler parity keeps skip guards only at the harness boundary", (): void => {
    const content = readSpecFile("dual-compiler-parity.test.ts");
    expect(countMatches(content, /\bit\.skip\(/g)).toBe(0);
    expect(countMatches(content, /\bit\.skipIf\(/g)).toBeLessThanOrEqual(2);
    expect(content).toContain("Harness boundary prerequisite");
  });
});
