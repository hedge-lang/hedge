import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

import { executeHedgeCode } from "./test-harness.js";

describe("test harness contract", (): void => {
  it("executes shebang-prefixed programs produced from fn main()", (): void => {
    const compiled = compile(`fn main() { print("ok"); }`);
    expect(isSome(compiled.code)).toBe(true);
    if (isSome(compiled.code)) {
      expect(isSome(compiled.code.value.javascript)).toBe(true);
      if (isSome(compiled.code.value.javascript)) {
        expect(compiled.code.value.javascript.value.startsWith("#!")).toBe(
          true,
        );
      }
    }

    const execution = executeHedgeCode(`fn main() { print("ok"); }`);
    expect(execution).not.toBeNull();
    expect(execution?.exitCode).toBe(0);
    expect(execution?.stdout).toEqual(["ok"]);
  });

  it("serializes non-string printed values predictably", (): void => {
    const execution = executeHedgeCode(`
      fn main() {
        print(1 + 2);
        print(true);
      }
    `);
    expect(execution).not.toBeNull();
    expect(execution?.stdout).toEqual(["3", "true"]);
  });
});
