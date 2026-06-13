import { describe, expect, it } from "vitest";

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
    expect(result.code).not.toBeNull();
    expect(result.code?.javascript).toContain("function main()");
    expect(result.code?.javascript).toContain("main();");
  });

  it("reports a semantic error and produces no code", (): void => {
    const result = compile("fn main() { print(missing); }");
    expect(result.code).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("missing");
  });

  it("reports a borrow error and produces no code", (): void => {
    const result = compile(
      'fn main() { let x = "a"; let r = &write x; print(r); }',
    );
    expect(result.code).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("not declared write");
  });

  it("reports a syntax error and produces no code", (): void => {
    const result = compile("fn main(");
    expect(result.code).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
  });
});
