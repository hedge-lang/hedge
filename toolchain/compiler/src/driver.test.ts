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

  it("compiles a wildcard let with no initializer as a true no-op", (): void => {
    const result = compile(`
      fn main() {
        let _;
        print("after");
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(isSome(result.code)).toBe(true);
    if (isSome(result.code)) {
      const { javascript } = result.code.value;
      expect(isSome(javascript)).toBe(true);
      if (isSome(javascript)) {
        expect(javascript.value).not.toMatch(/\b_\b/);
        expect(javascript.value).toContain('print("after")');
      }
    }
  });

  it("compiles a wildcard parameter without colliding with a real binding", (): void => {
    const result = compile(`
      fn main() {
        fn f(_: i32, x: i32) {
          print(x);
        }
        f(1, 2);
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(isSome(result.code)).toBe(true);
  });

  it("rejects a bare wildcard reference after a wildcard let", (): void => {
    const result = compile("fn main() { let _ = 5; print(_); }");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("reports a semantic error and produces no code", (): void => {
    const result = compile("fn main() { print(missing); }");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("missing");
  });

  it("reports a borrow error and produces no code", (): void => {
    const result = compile(
      'fn main() { let x = "a"; let r = &mut x; print(r); }',
    );
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
    expect(result.diagnostics[1]?.message).toContain("not declared mut");
  });

  it("reports a use-after-move error and produces no code", (): void => {
    const result = compile(`
      struct Boxed { value: i32 }
      fn main() {
        let x = Boxed { value: 1 };
        let y = x;
        print(x.value);
        print(y.value);
      }
    `);
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("moved");
  });

  it("does not run ownership checking when semantic analysis already reported an error", (): void => {
    const result = compile("fn main() { print(missing); }");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("missing");
  });

  it("reports a syntax error and produces no code", (): void => {
    const result = compile("fn main(");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("surfaces every parse diagnostic on failure, not just the first", (): void => {
    const result = compile("let x; fn main() {}");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  describe("Slice 1 loop/label rejection", (): void => {
    it.each([
      ["loop", "fn main() { loop {} }"],
      ["while", "fn main() { while true {} }"],
      ["for", "fn main() { for x in v {} }"],
      ["labeled loop", "fn main() { 'outer: loop {} }"],
    ])(
      "surfaces a recovered parse-time error for %s and produces no code",
      (_label, source): void => {
        const result = compile(source);
        expect(isNone(result.code)).toBe(true);
        expect(
          result.diagnostics.some(
            (d) => d.severity === "error" && d.message.includes("Slice 1"),
          ),
        ).toBe(true);
      },
    );

    it("rejection is deterministic across repeated compiles", (): void => {
      const source = "fn main() { loop {} }";
      const first = compile(source);
      const second = compile(source);
      expect(first.diagnostics).toEqual(second.diagnostics);
      expect(isNone(first.code)).toBe(true);
      expect(isNone(second.code)).toBe(true);
    });

    it("recovery lets a later, independently-broken declaration still surface its own error", (): void => {
      const result = compile(`
        fn main() { loop {} }
        fn other() { print(undefined_name); }
      `);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.some((e) => e.message.includes("loop"))).toBe(true);
      expect(errors.some((e) => e.message.includes("undefined_name"))).toBe(
        true,
      );
    });
  });

  describe("item error recovery", (): void => {
    it("a recovered program (malformed param + valid sibling) still produces no code", (): void => {
      const result = compile(`
        fn broken(x) {}
        fn main() {}
      `);
      expect(isNone(result.code)).toBe(true);
      expect(
        result.diagnostics.some(
          (d) => d.severity === "error" && d.message.includes(":"),
        ),
      ).toBe(true);
    });
  });
});
