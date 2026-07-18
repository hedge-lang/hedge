import { stdout } from "node:process";

import { build } from "./command/build.js";
import { version } from "./command/version.js";

/**
 * Dispatches CLI args to a command and returns the process exit code. Pure
 * (no process.exit, no top-level side effects) so it can be imported and
 * called directly in tests; see bin.ts for the actual executable entry
 * point that calls this and exits the process.
 */
export async function run(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    return help();
  }

  if (args.includes("--version") || args.includes("-v")) {
    return version();
  }

  const warnDropFlags = args.includes("--warn-drop-flags");
  const positional = args.filter((arg) => arg !== "--warn-drop-flags");
  const [command, file] = positional;
  if (command === "build" && file !== undefined) {
    return build(file, { warnDropFlags });
  }

  return help();
}

function help(): number {
  stdout.write("usage: hedge build <file.hedge> [--warn-drop-flags]\n");
  return 0;
}
