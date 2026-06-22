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
    if (isSome(result.code)) {
      const { javascript } = result.code.value;
      expect(isSome(javascript)).toBe(true);
      if (isSome(javascript)) {
        expect(javascript.value).toContain("function main()");
        expect(javascript.value).toContain("main()");
      }
    }
  });

  it("compiles variable expressions", (): void => {
    const result = compile(`
      fn main() {
        let b_true: bool = true;
        let b_false = false;
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(isSome(result.code)).toBe(true);
    if (isSome(result.code)) {
      const { javascript } = result.code.value;
      expect(isSome(javascript)).toBe(true);
      if (isSome(javascript)) {
        expect(javascript.value).toContain("function main()");
        expect(javascript.value).toContain("b_true = true;");
        expect(javascript.value).toContain("b_false = false;");
      }
    }
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
