/**
 * Splits a shell command string into an argv array, respecting single- and
 * double-quoted segments. No backslash escape handling — sufficient for
 * splitting compiler invocation strings in CI.
 */
export function shellSplit(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let state: "normal" | "single" | "double" = "normal";

  for (const ch of cmd) {
    if (state === "single") {
      if (ch === "'") {
        state = "normal";
      } else {
        current += ch;
      }
    } else if (state === "double") {
      if (ch === '"') {
        state = "normal";
      } else {
        current += ch;
      }
    } else {
      if (ch === "'") {
        state = "single";
      } else if (ch === '"') {
        state = "double";
      } else if (ch === " " || ch === "\t") {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
      } else {
        current += ch;
      }
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
