import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  const cliEntry = fileURLToPath(
    new URL("../../cli/dist/index.js", import.meta.url),
  );
  return spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: "utf8",
  });
}

describe("cli e2e", (): void => {
  it("build writes .js and .d.ts for valid source", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "hedge-cli-"));
    try {
      const sourcePath = join(dir, "ok.hed");
      await writeFile(
        sourcePath,
        `//! module doc\npub fn lib(x: i32) -> i32 { x }\n`,
        "utf8",
      );

      const result = runCli(["build", sourcePath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Compiled");

      const js = await readFile(join(dir, "ok.js"), "utf8");
      const dts = await readFile(join(dir, "ok.d.ts"), "utf8");
      expect(js).toContain("export function lib");
      expect(dts).toContain("export declare function lib(x: number): number;");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("build returns non-zero and emits diagnostics for invalid source", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "hedge-cli-"));
    try {
      const sourcePath = join(dir, "bad.hed");
      await writeFile(sourcePath, `fn main() { print(missing_name); }`, "utf8");

      const result = runCli(["build", sourcePath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("missing_name");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("help prints usage and exits zero", (): void => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage: hedge build <file.hedge>");
  });

  it("version prints semantic version and exits zero", (): void => {
    const result = runCli(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^hedge v\d+\.\d+\.\d+/u);
  });

  it("unknown command falls back to help", (): void => {
    const result = runCli(["unknown"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage: hedge build <file.hedge>");
  });

  it("build missing file exits non-zero and reports path failure", (): void => {
    const result = runCli(["build", "C:\\definitely-missing-file.hed"]);
    expect(result.status).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("build output is deterministic across repeated runs", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "hedge-cli-determinism-"));
    try {
      const sourcePath = join(dir, "stable.hed");
      await writeFile(
        sourcePath,
        `//! stable module\npub fn stable(x: i32) -> i32 { x + 1 }\n`,
        "utf8",
      );

      const first = runCli(["build", sourcePath]);
      expect(first.status).toBe(0);
      const firstJs = await readFile(join(dir, "stable.js"), "utf8");
      const firstDts = await readFile(join(dir, "stable.d.ts"), "utf8");

      const second = runCli(["build", sourcePath]);
      expect(second.status).toBe(0);
      const secondJs = await readFile(join(dir, "stable.js"), "utf8");
      const secondDts = await readFile(join(dir, "stable.d.ts"), "utf8");

      expect(secondJs).toBe(firstJs);
      expect(secondDts).toBe(firstDts);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
