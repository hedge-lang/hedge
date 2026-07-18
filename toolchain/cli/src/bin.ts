#!/usr/bin/env node
import { argv, exit, stderr } from "node:process";

import { run } from "./index.js";

try {
  exit(await run(argv.slice(2)));
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  exit(1);
}
