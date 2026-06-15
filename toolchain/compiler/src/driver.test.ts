import { describe, expect, it } from "vitest";

import { isNone, isSome } from "./option.js";
import { compile } from "./driver.js";

describe("driver", (): void => {
  it("compiles the tracer bullet to runnable JavaScript", (): void => {
    const result = compile(`
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(isSome(result.code)).toBe(true);
    const js = isSome(result.code) ? result.code.value.javascript : "";
    expect(js).toContain("function main()");
    expect(js).toContain("main()");
  });

  it("reports a semantic error and produces no code", (): void => {
    const result = compile("fn main() { print(missing); }");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("missing");
  });

  it("reports a borrow error and produces no code", (): void => {
    const result = compile(
      'fn main() { let x = "a"; let r = &write x; print(r); }',
    );
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("not declared write");
  });

  it("reports a syntax error and produces no code", (): void => {
    const result = compile("fn main(");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
  });
});
