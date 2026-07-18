import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "./index.js";

let dir: string;

beforeEach(async (): Promise<void> => {
  dir = await mkdtemp(join(tmpdir(), "hedge-cli-index-"));
});

afterEach(async (): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSource(name: string, source: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, source, "utf8");
  return file;
}

describe("run", (): void => {
  it("accepts --warn-drop-flags after the file argument", async (): Promise<void> => {
    const file = await writeSource(
      "main.hedge",
      `
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `,
    );
    const exitCode = await run(["build", file, "--warn-drop-flags"]);
    expect(exitCode).toBe(0);
    const js = await readFile(join(dir, "main.js"), "utf8");
    expect(js).toContain("function main()");
  });

  it("accepts --warn-drop-flags before the file argument", async (): Promise<void> => {
    const file = await writeSource(
      "main.hedge",
      `
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `,
    );
    const exitCode = await run(["build", "--warn-drop-flags", file]);
    expect(exitCode).toBe(0);
    const js = await readFile(join(dir, "main.js"), "utf8");
    expect(js).toContain("function main()");
  });

  it("builds cleanly when --warn-drop-flags is omitted", async (): Promise<void> => {
    const file = await writeSource(
      "main.hedge",
      `
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `,
    );
    const exitCode = await run(["build", file]);
    expect(exitCode).toBe(0);
  });
});
