#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { argv, exit, stderr, stdout } from "node:process";

import { compile } from "@hedge-lang/compiler";

import { renderDiagnostics } from "./util/render.js";
import { build } from "./command/build.js";
import { version } from './command/version.js'

async function run(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    return help();
  }

  if (args.includes("--version") || args.includes("-v")) {
    return version();
  }

  const [command, file] = args;
  if (command === "build" && file !== undefined) {
    return build(file);
  }

  return help();
}

function help(): number {
  stdout.write("usage: hedge build <file.hedge>\n");
  return 0;
}

try {
  exit(await run(argv.slice(2)));
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  exit(1);
}
