import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { build } from "./build.js";

let dir: string;

beforeEach(async (): Promise<void> => {
  dir = await mkdtemp(join(tmpdir(), "hedge-cli-build-"));
});

afterEach(async (): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSource(name: string, source: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, source, "utf8");
  return file;
}

describe("build", (): void => {
  it("compiles a file to JS with no options", async (): Promise<void> => {
    const file = await writeSource(
      "main.hedge",
      `
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `,
    );
    const exitCode = await build(file);
    expect(exitCode).toBe(0);
    const js = await readFile(join(dir, "main.js"), "utf8");
    expect(js).toContain("function main()");
  });

  it("accepts warnDropFlags and compiles cleanly, since no program today can trigger the warning", async (): Promise<void> => {
    const file = await writeSource(
      "cond.hedge",
      `
      struct Boxed { value: i32 }
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        } else {
          print(0);
        }
      }
    `,
    );
    const exitCode = await build(file, { warnDropFlags: true });
    expect(exitCode).toBe(0);
    const js = await readFile(join(dir, "cond.js"), "utf8");
    expect(js).not.toMatch(/dropFlag/);
  });
});
