import { describe, expect, it } from "vitest";

import { assert } from "./assert.js";
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

  describe("reference types", (): void => {
    it("compiles and runs fn first(s: &str) -> &str { s } - AC1's elision shape", (): void => {
      const result = compile(`
        fn first(s: &str) -> &str { s }
        fn main() { print(first("hello")); }
      `);
      expect(result.diagnostics).toEqual([]);
      expect(isSome(result.code)).toBe(true);
      if (isSome(result.code) && isSome(result.code.value.javascript)) {
        expect(result.code.value.javascript.value).toContain("hello");
      }
    });

    it("rejects fn longest(a: &str, b: &str) -> &str as ambiguous - AC3", (): void => {
      const result = compile(`
        fn longest(a: &str, b: &str) -> &str { a }
        fn main() { print(longest("a", "b")); }
      `);
      expect(isNone(result.code)).toBe(true);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes("missing lifetime specifier"),
        ),
      ).toBe(true);
    });

    it("compiles and runs fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a } - AC4", (): void => {
      const result = compile(`
        fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a }
        fn main() { print(longest("first", "second")); }
      `);
      expect(result.diagnostics).toEqual([]);
      expect(isSome(result.code)).toBe(true);
      if (isSome(result.code) && isSome(result.code.value.javascript)) {
        expect(result.code.value.javascript.value).toContain("first");
      }
    });

    it("emits byte-identical JS for two otherwise-identical programs that differ only in their lifetime name (metamorphic)", (): void => {
      const named = compile("fn first(s: &'a str) -> &'a str { s }");
      const renamed = compile("fn first(s: &'zzz str) -> &'zzz str { s }");
      expect(named.diagnostics).toEqual([]);
      expect(renamed.diagnostics).toEqual([]);
      assert(
        isSome(named.code) && isSome(renamed.code),
        "Expected code from both",
      );
      expect(named.code.value.javascript).toEqual(
        renamed.code.value.javascript,
      );
    });

    it("renders &str as a plain TS string in the .d.ts output, with no reference wrapper", (): void => {
      const result = compile("pub fn first(s: &str) -> &str { s }");
      expect(result.diagnostics).toEqual([]);
      assert(isSome(result.code), "Expected code");
      assert(isSome(result.code.value.typedef), "Expected a typedef");
      expect(result.code.value.typedef.value).toContain(
        "function first(s: string): string",
      );
    });
  });

  describe("CompileOptions.warnDropFlags", (): void => {
    it("accepts the option without erroring and produces no warnings for a program with no conditional-drop sites", (): void => {
      const result = compile(
        `
        fn main() {
          let greeting = "Hello, world!";
          print(greeting);
        }
      `,
        { warnDropFlags: true },
      );
      expect(result.diagnostics).toEqual([]);
      expect(isSome(result.code)).toBe(true);
    });

    it("defaults to false when options is omitted entirely", (): void => {
      const result = compile(`
        fn main() {
          let greeting = "Hello, world!";
          print(greeting);
        }
      `);
      expect(result.diagnostics).toEqual([]);
      expect(isSome(result.code)).toBe(true);
    });
  });
});
