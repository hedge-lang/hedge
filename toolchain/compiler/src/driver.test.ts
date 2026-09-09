import { describe, expect, it } from "vitest";
import { messageOf } from "./diagnostics/index.js";

import { assert } from "./assert.js";
import { isNone, isSome } from "./option.js";
import { compile } from "./driver.js";
import { PRELUDE_SOURCE } from "./prelude.js";

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
    expect(messageOf(result.diagnostics[0])).toContain("missing");
  });

  it("reports a borrow error and produces no code", (): void => {
    const result = compile(
      'fn main() { let x = "a"; let r = &mut x; print(r); }',
    );
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(messageOf(result.diagnostics[0])).toContain("not declared mut");
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
    expect(messageOf(result.diagnostics[0])).toContain("moved");
  });

  it("does not run ownership checking when semantic analysis already reported an error", (): void => {
    const result = compile("fn main() { print(missing); }");
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(messageOf(result.diagnostics[0])).toContain("missing");
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

  describe("multi-error recovery for ownership diagnostics", (): void => {
    it("reports two independent conflicting-borrow errors in the same compile, not just the first", (): void => {
      const result = compile(`
        fn main() {
          let mut a = 1;
          let r1 = &mut a;
          let r2 = &mut a;
          print(r1);
          print(r2);
          let mut b = 2;
          let r3 = &mut b;
          let r4 = &mut b;
          print(r3);
          print(r4);
        }
      `);
      expect(isNone(result.code)).toBe(true);
      const conflicts = result.diagnostics.filter((d) =>
        messageOf(d).includes("Conflicting borrows"),
      );
      expect(conflicts).toHaveLength(2);
    });

    it("reports a use-after-move error and an unrelated borrow-conflict error in the same compile", (): void => {
      const result = compile(`
        struct Boxed { value: i32 }
        fn main() {
          let x = Boxed { value: 1 };
          let y = x;
          print(x.value);
          let mut a = 1;
          let r1 = &mut a;
          let r2 = &mut a;
          print(r1);
          print(r2);
        }
      `);
      expect(isNone(result.code)).toBe(true);
      expect(
        result.diagnostics.some((d) => messageOf(d).includes("moved")),
      ).toBe(true);
      expect(
        result.diagnostics.some((d) =>
          messageOf(d).includes("Conflicting borrows"),
        ),
      ).toBe(true);
    });

    it("reports a lifetime-ambiguity error (a parser-stage diagnostic) and an unrelated borrow-conflict error (a semantic-stage diagnostic) in the same compile", (): void => {
      const result = compile(`
        fn longest(a: &str, b: &str) -> &str { a }
        fn main() {
          let mut x = 1;
          let r1 = &mut x;
          let r2 = &mut x;
          print(r1);
          print(r2);
        }
      `);
      expect(isNone(result.code)).toBe(true);
      expect(
        result.diagnostics.some((d) =>
          messageOf(d).includes("missing lifetime specifier"),
        ),
      ).toBe(true);
      expect(
        result.diagnostics.some((d) =>
          messageOf(d).includes("Conflicting borrows"),
        ),
      ).toBe(true);
    });
  });

  describe("loop/label rejection", (): void => {
    it.each([
      [
        "loop",
        "fn main() { loop {} }",
        "`loop` expressions are not yet supported",
      ],
      [
        "while",
        "fn main() { while true {} }",
        "`while` loops are not yet supported",
      ],
      [
        "for",
        "fn main() { for x in v {} }",
        "`for` loops are not yet supported",
      ],
      [
        "labeled loop",
        "fn main() { 'outer: loop {} }",
        "`loop` expressions are not yet supported",
      ],
    ])(
      "surfaces a recovered parse-time error for %s and produces no code",
      (_label, source, message): void => {
        const result = compile(source);
        expect(isNone(result.code)).toBe(true);
        expect(
          result.diagnostics.some(
            (d) => d.severity === "error" && messageOf(d) === message,
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
      expect(errors.some((e) => messageOf(e).includes("loop"))).toBe(true);
      expect(errors.some((e) => messageOf(e).includes("undefined_name"))).toBe(
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
          (d) => d.severity === "error" && messageOf(d).includes(":"),
        ),
      ).toBe(true);
    });
  });

  describe("reference types", (): void => {
    it("compiles and runs fn first(s: &str) -> &str { s } - AC1's elision shape", (): void => {
      const result = compile(`
        fn first(s: &str) -> &str { s }
        fn main() { let s = "hello"; print(first(&s)); }
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
          messageOf(d).includes("missing lifetime specifier"),
        ),
      ).toBe(true);
    });

    it("compiles and runs fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a } - AC4", (): void => {
      const result = compile(`
        fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a }
        fn main() { let a = "first"; let b = "second"; print(longest(&a, &b)); }
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

describe("bodiless function signatures", (): void => {
  it("rejects a program containing only a top-level bodiless function, without crashing the compiler", (): void => {
    const result = compile("fn f(x: i32) -> i32;");
    expect(result.diagnostics).toHaveLength(1);
    expect(messageOf(result.diagnostics[0])).toBe(
      "a function signature with no body is not allowed as a top-level item",
    );
    expect(isNone(result.code)).toBe(true);
  });

  it("rejects a bodiless main the same way, without crashing the compiler - so the auto-generated main() call never reaches codegen at all", (): void => {
    const result = compile("fn main();");
    expect(result.diagnostics).toHaveLength(1);
    expect(messageOf(result.diagnostics[0])).toBe(
      "a function signature with no body is not allowed as a top-level item",
    );
    expect(isNone(result.code)).toBe(true);
  });
});

describe("trait/impl declarations", (): void => {
  it("erases the trait declaration but emits the impl's method body as a free function", (): void => {
    const result = compile(`
      trait Draw {
        fn draw(&self) -> str;
      }
      struct Point { x: i32, y: i32 }
      impl Draw for Point {
        fn draw(&self) -> str { "point" }
      }
      fn main() {
        print("done");
      }
    `);
    expect(result.diagnostics).toEqual([]);
    assert(isSome(result.code), "Expected the program to compile");
    const { javascript } = result.code.value;
    assert(isSome(javascript), "Expected emitted JavaScript");
    expect(javascript.value).toContain("function main()");
    expect(javascript.value).toContain("function Point$Draw$draw(self)");
    expect(javascript.value).toContain('return "point";');
    expect(javascript.value).not.toContain("trait Draw");
  });
});

/**
 * Runs emitted Slice-1/4 JavaScript in a `new Function` sandbox with a mock
 * `print`, mirroring the conformance suite's `executeHedgeCode`, and returns
 * the captured `print` lines. For the runtime-worded acceptance criteria that
 * a `toContain` shape check alone cannot pin.
 */
function runEmittedJs(javascript: string): string[] {
  const stdout: string[] = [];
  const env = {
    print: (...args: unknown[]): void => {
      stdout.push(args.join(""));
    },
  };
  const body = javascript.startsWith("#!") ? `// ${javascript}` : javascript;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...Object.keys(env), body);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  fn(...Object.values(env));
  return stdout;
}

function emittedJs(source: string): string {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  assert(isSome(result.code), "Expected the program to compile");
  const { javascript } = result.code.value;
  assert(isSome(javascript), "Expected emitted JavaScript");
  return javascript.value;
}

describe("method-call codegen", (): void => {
  it("emits an inherent `&self` method as a free function and lowers the call to it", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl Point {
        fn get(&self) -> i32 { self.x }
      }
      fn main() {
        let p = Point { x: 7 };
        print(p.get());
      }
    `);
    expect(js).toContain("function Point$get(self)");
    expect(js).toContain("return self.x;");
    expect(js).toContain("Point$get(p)");
    expect(js).not.toContain("p.get()");
    expect(runEmittedJs(js)).toEqual(["7"]);
  });

  it("passes a method's own arguments after the receiver", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl Point {
        fn add(&self, n: i32) -> i32 { self.x + n }
      }
      fn main() {
        let p = Point { x: 7 };
        print(p.add(5));
      }
    `);
    expect(js).toContain("function Point$add(self, n)");
    expect(js).toContain("Point$add(p, 5)");
    expect(runEmittedJs(js)).toEqual(["12"]);
  });

  it("dispatches a trait method on a concrete receiver to the impl's free function", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct Point { x: i32 }
      impl Draw for Point {
        fn draw(&self) -> i32 { self.x }
      }
      fn main() {
        let p = Point { x: 9 };
        print(p.draw());
      }
    `);
    expect(js).toContain("function Point$Draw$draw(self)");
    expect(js).toContain("Point$Draw$draw(p)");
    expect(js).not.toContain("p.draw()");
    expect(runEmittedJs(js)).toEqual(["9"]);
  });

  it("suffixes a generated method free-function name that collides with a user function", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct Point { x: i32 }
      impl Draw for Point { fn draw(&self) -> i32 { self.x } }
      fn Point$Draw$draw() -> i32 { 0 }
      fn main() {
        let p = Point { x: 7 };
        print(p.draw());
        print(Point$Draw$draw());
      }
    `);
    // The user function keeps its name; the generated one is suffixed and the
    // call site follows it.
    expect(js).toMatch(/function Point\$Draw\$draw\(\) \{\s*\n\s*return 0;/);
    expect(js).toContain("function Point$Draw$draw_2(self)");
    expect(js).toContain("Point$Draw$draw_2(p)");
    expect(runEmittedJs(js)).toEqual(["7", "0"]);
  });

  it("keeps an inherent method and a trait method on the same type as distinct free functions", (): void => {
    const js = emittedJs(`
      trait Draw { fn describe(&self) -> i32; }
      struct Point { x: i32 }
      impl Point { fn raw(&self) -> i32 { self.x } }
      impl Draw for Point { fn describe(&self) -> i32 { self.x + 1 } }
      fn main() {
        let p = Point { x: 10 };
        print(p.raw());
        print(p.describe());
      }
    `);
    expect(js).toContain("function Point$raw(self)");
    expect(js).toContain("function Point$Draw$describe(self)");
    expect(js).toContain("Point$raw(p)");
    expect(js).toContain("Point$Draw$describe(p)");
    expect(runEmittedJs(js)).toEqual(["10", "11"]);
  });

  it("passes a by-value `self` receiver directly and moves the caller's binding", (): void => {
    const src = `
      struct Point { x: i32 }
      impl Point {
        fn consume(self) -> i32 { self.x }
      }
      fn main() {
        let p = Point { x: 5 };
        print(p.consume());
      }
    `;
    const js = emittedJs(src);
    expect(js).toContain("function Point$consume(self)");
    expect(js).toContain("Point$consume(p)");
    expect(runEmittedJs(js)).toEqual(["5"]);

    const moved = compile(`
      struct Point { x: i32 }
      impl Point { fn consume(self) -> i32 { self.x } }
      fn main() {
        let p = Point { x: 5 };
        let a = p.consume();
        let b = p.consume();
        print(a);
      }
    `);
    expect(
      moved.diagnostics.filter((d) => d.severity === "error"),
    ).toHaveLength(1);
  });

  it("passes an accessor cell for a `&mut self` receiver and mutates the caller's binding", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl Point {
        fn bump(&mut self, n: i32) { self.x = self.x + n; }
      }
      fn main() {
        let mut p = Point { x: 1 };
        p.bump(3);
        print(p.x);
      }
    `);
    expect(js).toContain("function Point$bump(self, n)");
    expect(js).toContain("self.v.x = ((self.v.x + n)|0);");
    expect(js).toMatch(/Point\$bump\(\(\{ get v\(\) \{ return p; \}/);
    expect(runEmittedJs(js)).toEqual(["4"]);
  });

  it("chains a method call on a struct another method returned", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl Point {
        fn twin(&self) -> Point { Point { x: self.x } }
        fn val(&self) -> i32 { self.x }
      }
      fn main() {
        let p = Point { x: 6 };
        print(p.twin().val());
      }
    `);
    expect(js).toContain("Point$val(Point$twin(p))");
    expect(runEmittedJs(js)).toEqual(["6"]);
  });

  it("emits one free function however many sites call the method", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct Point { x: i32 }
      impl Draw for Point { fn draw(&self) -> i32 { self.x } }
      fn main() {
        let p = Point { x: 1 };
        let q = Point { x: 2 };
        print(p.draw());
        print(q.draw());
      }
    `);
    expect(js.match(/function Point\$Draw\$draw\b/g)).toHaveLength(1);
  });

  it("does not emit a broken call for an unresolved method, reporting one error", (): void => {
    const result = compile(`
      struct Point { x: i32 }
      fn main() {
        let p = Point { x: 1 };
        print(p.nope());
      }
    `);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("HEDGE-TYPE-012");
    expect(isNone(result.code)).toBe(true);
  });

  it("lowers a method call nested in an `if` branch and a struct field initializer", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      struct Wrap { p: Point }
      impl Point { fn get(&self) -> i32 { self.x } }
      fn main() {
        let p = Point { x: 4 };
        let w = Wrap { p: Point { x: p.get() } };
        if p.get() == 4 { print(w.p.x); }
      }
    `);
    expect(runEmittedJs(js)).toEqual(["4"]);
  });

  it("lowers a method that reads a `$`-containing field name", (): void => {
    const js = emittedJs(`
      struct P { x$1: i32 }
      impl P { fn get(&self) -> i32 { self.x$1 } }
      fn main() {
        let p = P { x$1: 8 };
        print(p.get());
      }
    `);
    expect(js).toContain("return self.x$1;");
    expect(runEmittedJs(js)).toEqual(["8"]);
  });

  it("emits a block-local impl's method as a top-level free function", (): void => {
    const js = emittedJs(`
      struct Widget { n: i32 }
      fn build() -> i32 {
        impl Widget { fn size(&self) -> i32 { self.n } }
        let w = Widget { n: 3 };
        w.size()
      }
      fn main() { print(build()); }
    `);
    expect(js).toContain("function Widget$size(self)");
    expect(js).toContain("Widget$size(w)");
    expect(runEmittedJs(js)).toEqual(["3"]);
  });

  it("keeps a block-local struct's method distinct from a shadowed top-level struct's", (): void => {
    const result = compile(`
      struct Point { x: i32 }
      impl Point { fn get(&self) -> i32 { self.x } }
      fn inner() -> i32 {
        struct Point { y: i32 }
        impl Point { fn get(&self) -> i32 { self.y } }
        let p = Point { y: 9 };
        p.get()
      }
      fn main() {
        let p = Point { x: 4 };
        print(p.get());
        print(inner());
      }
    `);
    assert(isSome(result.code), "Expected the program to compile");
    const { javascript } = result.code.value;
    assert(isSome(javascript), "Expected emitted JavaScript");
    const js = javascript.value;
    expect(js).toContain("function Point$get(self)");
    expect(js).toContain("function Point$get_2(self)");
    expect(runEmittedJs(js)).toEqual(["4", "9"]);
  });

  it("disposes an owned local declared inside a method body at method-scope end", (): void => {
    const js = emittedJs(`
      struct Res { fd: i32 }
      struct Holder { x: i32 }
      impl Holder {
        fn work(&self) -> i32 { let r = Res { fd: 1 }; self.x }
      }
      fn main() { let h = Holder { x: 5 }; print(h.work()); }
    `);
    expect(js).toMatch(/function Holder\$work\(self\) \{\s*\n\s*using r = /);
    expect(runEmittedJs(js)).toEqual(["5"]);
  });

  it("calls `Trait$m$default` for a trait default method the impl does not override, and runs", (): void => {
    const js = emittedJs(`
      trait Greet { fn hello(&self) -> i32 { 42 } }
      struct P { x: i32 }
      impl Greet for P {}
      fn main() { let p = P { x: 1 }; print(p.hello()); }
    `);
    expect(js).toContain("Greet$hello$default(p, __witness_Greet_P)");
    expect(js).not.toContain("p.hello()");
    expect(runEmittedJs(js)).toEqual(["42"]);
  });

  it("keeps method free functions out of the emitted `.d.ts`", (): void => {
    const result = compile(`
      struct Counter { n: i32 }
      impl Counter { fn value(&self) -> i32 { self.n } }
      pub fn read(c: Counter) -> i32 { c.value() }
      fn main() { print(read(Counter { n: 1 })); }
    `);
    expect(result.diagnostics).toEqual([]);
    assert(isSome(result.code), "Expected the program to compile");
    const { typedef } = result.code.value;
    assert(isSome(typedef), "Expected an emitted .d.ts");
    expect(typedef.value).toContain("read");
    expect(typedef.value).not.toContain("Counter$value");
    expect(typedef.value).not.toContain("$");
  });
});

describe("== / != on a type with a PartialEq impl", (): void => {
  it("lowers `==` on a struct to a call of the impl's `eq` free function and runs it", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl PartialEq for Point {
        fn eq(&self, other: &Self) -> bool { self.x == other.x }
      }
      fn main() {
        let a = Point { x: 3 };
        let b = Point { x: 3 };
        if a == b { print("equal"); }
      }
    `);
    expect(js).toContain("Point$PartialEq$eq(a, b)");
    expect(js).not.toContain("a.eq(b)");
    expect(js).not.toContain("a === b");
    expect(runEmittedJs(js)).toEqual(["equal"]);
  });

  it("lowers `!=` on a struct to a negated call of the impl's `eq` free function and runs it", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl PartialEq for Point {
        fn eq(&self, other: &Self) -> bool { self.x == other.x }
      }
      fn main() {
        let a = Point { x: 3 };
        let b = Point { x: 4 };
        if a != b { print("different"); }
      }
    `);
    expect(js).toContain("!Point$PartialEq$eq(a, b)");
    expect(js).not.toContain("a.eq(b)");
    expect(runEmittedJs(js)).toEqual(["different"]);
  });

  it("lowers `==` on an enum to a call of the impl's `eq` free function and runs it", (): void => {
    const js = emittedJs(`
      enum Dir { N, S }
      impl PartialEq for Dir {
        fn eq(&self, other: &Self) -> bool { true }
      }
      fn main() {
        let a = Dir::N;
        let b = Dir::S;
        if a == b { print("same tag"); }
      }
    `);
    expect(js).toContain("Dir$PartialEq$eq(a, b)");
    expect(js).not.toContain("a.eq(b)");
    expect(runEmittedJs(js)).toEqual(["same tag"]);
  });

  it("lowers `==` on `&Point` operands to a call of the `eq` free function", (): void => {
    const js = emittedJs(`
      struct Point { x: i32 }
      impl PartialEq for Point { fn eq(&self, other: &Self) -> bool { true } }
      fn eq_refs(a: &Point, b: &Point) -> bool { a == b }
      fn main() { print("done"); }
    `);
    expect(js).toContain("Point$PartialEq$eq(a, b)");
    expect(js).not.toContain("a.eq(b)");
  });

  it("dispatches `==` on a `PartialEq`-bound generic parameter through the witness", (): void => {
    const js = emittedJs(`
      fn same<T: PartialEq>(a: T, b: T) -> bool { a == b }
      fn main() { print("done"); }
    `);
    expect(js).toContain("_witness_T_PartialEq.eq(a, b)");
    expect(js).not.toContain("a.eq(b)");
  });

  it("leaves `==` on a type whose `PartialEq` comes only from a blanket impl as a method call", (): void => {
    const js = emittedJs(`
      trait Marker {}
      struct W { n: i32 }
      impl Marker for W {}
      impl<T: Marker> PartialEq for T { fn eq(&self, other: &Self) -> bool { true } }
      fn main() {
        let a = W { n: 1 };
        let b = W { n: 2 };
        if a == b { print("done"); }
      }
    `);
    expect(js).toContain("a.eq(b)");
    expect(js).not.toContain("W$PartialEq$eq");
  });
});

describe("generic witness codegen", (): void => {
  it("appends a hidden witness parameter for each of a generic function's trait bounds", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      fn draw_all<T: Draw>(t: &T) -> i32 { t.draw() }
      fn main() { print(0); }
    `);
    expect(js).toContain("function draw_all(t, _witness_T_Draw)");
  });

  it("dispatches a trait method on a bound type parameter through its witness", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      fn draw_all<T: Draw>(t: &T) -> i32 { t.draw() }
      fn main() { print(0); }
    `);
    expect(js).toContain("return _witness_T_Draw.draw(t);");
    expect(js).not.toContain("t.draw()");
  });

  it("passes a hoisted witness object at a generic call site and runs end-to-end", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct P { x: i32 }
      impl Draw for P { fn draw(&self) -> i32 { self.x } }
      fn draw_all<T: Draw>(t: &T) -> i32 { t.draw() }
      fn main() {
        let p = P { x: 7 };
        print(draw_all(&p));
      }
    `);
    expect(js).toContain("const __witness_Draw_P = {draw: P$Draw$draw};");
    expect(js).toContain("draw_all(p, __witness_Draw_P)");
    expect(runEmittedJs(js)).toEqual(["7"]);
  });

  it("appends one witness parameter per bound, in bound order", (): void => {
    const js = emittedJs(`
      trait A { fn a(&self) -> i32; }
      trait B { fn b(&self) -> i32; }
      fn use_both<T: A + B>(t: &T) -> i32 { t.a() + t.b() }
      fn main() { print(0); }
    `);
    expect(js).toContain("function use_both(t, _witness_T_A, _witness_T_B)");
    expect(js).toContain("_witness_T_A.a(t)");
    expect(js).toContain("_witness_T_B.b(t)");
  });

  it("orders witness parameters by type parameter, then bound", (): void => {
    const js = emittedJs(`
      trait A { fn a(&self) -> i32; }
      trait B { fn b(&self) -> i32; }
      fn pair<T: A, U: B>(t: &T, u: &U) -> i32 { t.a() + u.b() }
      fn main() { print(0); }
    `);
    expect(js).toContain("function pair(t, u, _witness_T_A, _witness_U_B)");
  });

  it("forwards a caller's own witness to a nested generic call", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct P { x: i32 }
      impl Draw for P { fn draw(&self) -> i32 { self.x } }
      fn inner<U: Draw>(u: &U) -> i32 { u.draw() }
      fn outer<T: Draw>(t: &T) -> i32 { inner(t) }
      fn main() { let p = P { x: 5 }; print(outer(&p)); }
    `);
    expect(js).toContain("function outer(t, _witness_T_Draw)");
    expect(js).toContain("inner(t, _witness_T_Draw)");
    expect(runEmittedJs(js)).toEqual(["5"]);
  });

  it("forwards a witness two hops through nested generic calls", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct P { x: i32 }
      impl Draw for P { fn draw(&self) -> i32 { self.x } }
      fn deepest<A: Draw>(a: &A) -> i32 { a.draw() }
      fn middle<B: Draw>(b: &B) -> i32 { deepest(b) }
      fn top<C: Draw>(c: &C) -> i32 { middle(c) }
      fn main() { let p = P { x: 3 }; print(top(&p)); }
    `);
    expect(js).toContain("middle(b, _witness_B_Draw)");
    expect(js).toContain("deepest(b, _witness_B_Draw)");
    expect(runEmittedJs(js)).toEqual(["3"]);
  });

  it("emits one JS function for a bounded generic instantiated at two concrete types", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct A { n: i32 }
      struct B { n: i32 }
      impl Draw for A { fn draw(&self) -> i32 { self.n } }
      impl Draw for B { fn draw(&self) -> i32 { self.n + 1 } }
      fn run<T: Draw>(t: &T) -> i32 { t.draw() }
      fn main() {
        let a = A { n: 10 };
        let b = B { n: 20 };
        print(run(&a));
        print(run(&b));
      }
    `);
    expect(js.match(/function run\b/g)).toHaveLength(1);
    expect(runEmittedJs(js)).toEqual(["10", "21"]);
  });

  it("emits one JS function with no witness parameter for an unbounded generic at two types", (): void => {
    const js = emittedJs(`
      fn id<T>(x: T) -> T { x }
      fn main() { print(id(1)); print(id(2)); }
    `);
    expect(js).toContain("function id(x)");
    expect(js).not.toContain("_witness");
    expect(js.match(/function id\b/g)).toHaveLength(1);
    expect(runEmittedJs(js)).toEqual(["1", "2"]);
  });

  it("keeps witness parameters out of a `pub` generic function's `.d.ts`", (): void => {
    const result = compile(`
      trait Draw { fn draw(&self) -> i32; }
      pub fn draw_all<T: Draw>(t: &T) -> i32 { t.draw() }
      fn main() { print(0); }
    `);
    assert(isSome(result.code), "Expected the program to compile");
    const { typedef } = result.code.value;
    assert(isSome(typedef), "Expected a .d.ts");
    expect(typedef.value).not.toContain("_witness");
  });

  it("does not emit witness codegen for an unsatisfied bound", (): void => {
    const result = compile(`
      trait Draw { fn draw(&self) -> i32; }
      struct P { x: i32 }
      fn draw_all<T: Draw>(t: &T) -> i32 { t.draw() }
      fn main() { let p = P { x: 1 }; print(draw_all(&p)); }
    `);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("HEDGE-TRAIT-002");
    expect(isNone(result.code)).toBe(true);
  });

  it("rejects a method call on an unbounded type parameter without emitting a witness", (): void => {
    const result = compile(`
      trait Draw { fn draw(&self) -> i32; }
      fn draw_all<T>(t: &T) -> i32 { t.draw() }
      fn main() { print(0); }
    `);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("HEDGE-TYPE-012");
  });

  it("dispatches a `&mut self` trait method through a witness and mutates the caller's value", (): void => {
    const js = emittedJs(`
      trait Bump { fn bump(&mut self); }
      struct C { n: i32 }
      impl Bump for C { fn bump(&mut self) { self.n = self.n + 1; } }
      fn bump_it<T: Bump>(t: &mut T) { t.bump() }
      fn main() {
        let mut c = C { n: 4 };
        bump_it(&mut c);
        print(c.n);
      }
    `);
    // `t` is already a `&mut T` cell here, so it passes through unwrapped;
    // the wrap happens at `bump_it(&mut c)` in `main`.
    expect(js).toContain("_witness_T_Bump.bump(t)");
    expect(js).toMatch(/bump_it\(\(\{ get v\(\) \{ return c; \}/);
    expect(runEmittedJs(js)).toEqual(["5"]);
  });

  it("dispatches `==` on a `PartialEq`-bound parameter through the witness", (): void => {
    const js = emittedJs(`
      fn same<T: PartialEq>(a: T, b: T) -> bool { a == b }
      fn main() { print(0); }
    `);
    expect(js).toContain("function same(a, b, _witness_T_PartialEq)");
    expect(js).toContain("return _witness_T_PartialEq.eq(a, b);");
    expect(js).not.toContain("a.eq(b)");
  });

  it("passes the shared primitive-eq witness at a `T: PartialEq` call with an integer, and runs", (): void => {
    const js = emittedJs(`
      fn same<T: PartialEq>(a: T, b: T) -> bool { a == b }
      fn main() {
        if same(2, 2) { print("eq"); }
        if same(2, 3) { print("ne"); }
      }
    `);
    expect(js).toContain(
      "const __witnessPrimitiveEq = {eq: (a, b) => a === b};",
    );
    expect(js).toContain("same(2, 2, __witnessPrimitiveEq)");
    expect(js.match(/const __witnessPrimitiveEq\b/g)).toHaveLength(1);
    expect(runEmittedJs(js)).toEqual(["eq"]);
  });

  it("shares one primitive-eq witness between `T: PartialEq` and `T: Eq` calls", (): void => {
    const js = emittedJs(`
      fn peq<T: PartialEq>(a: T, b: T) -> bool { a == b }
      fn teq<T: Eq>(a: T, b: T) -> bool { a == b }
      fn main() {
        if peq(1, 1) { print("p"); }
        if teq('x', 'x') { print("t"); }
      }
    `);
    expect(js).toContain("_witness_T_Eq.eq(a, b)");
    expect(js.match(/const __witnessPrimitiveEq\b/g)).toHaveLength(1);
    expect(js).toContain('teq("x", "x", __witnessPrimitiveEq)');
    expect(runEmittedJs(js)).toEqual(["p", "t"]);
  });

  it("compiles and runs a generic `PartialEq` equality check on a boolean argument", (): void => {
    const js = emittedJs(`
      fn eq_check<T: PartialEq>(a: T, b: T) -> bool { a == b }
      fn main() {
        let ok = eq_check(true, true);
        if ok { print("yes"); }
      }
    `);
    expect(runEmittedJs(js)).toEqual(["yes"]);
  });

  it("threads a witness for a bound declared in a `where` clause", (): void => {
    const js = emittedJs(`
      trait Draw { fn draw(&self) -> i32; }
      struct P { x: i32 }
      impl Draw for P { fn draw(&self) -> i32 { self.x } }
      fn run<T>(t: &T) -> i32 where T: Draw { t.draw() }
      fn main() { let p = P { x: 8 }; print(run(&p)); }
    `);
    expect(js).toContain("function run(t, _witness_T_Draw)");
    expect(js).toContain("_witness_T_Draw.draw(t)");
    expect(runEmittedJs(js)).toEqual(["8"]);
  });
});

describe("trait default method codegen", (): void => {
  const greetTrait = `
    trait Greet {
      fn name(&self) -> i32;
      fn hello(&self) -> i32 { self.name() }
    }
    struct En { who: i32 }
    impl Greet for En { fn name(&self) -> i32 { self.who } }
  `;

  it("emits a default method as `Trait$m$default` with a trailing witness parameter", (): void => {
    const js = emittedJs(`
      ${greetTrait}
      fn main() { print(0); }
    `);
    expect(js).toContain(
      "function Greet$hello$default(self, _witness_Self_Greet)",
    );
    expect(js).toContain("return _witness_Self_Greet.name(self);");
  });

  it("calls `Trait$m$default` with the hoisted witness for a concrete receiver, and runs", (): void => {
    const js = emittedJs(`
      ${greetTrait}
      fn main() { let e = En { who: 42 }; print(e.hello()); }
    `);
    expect(js).toContain("Greet$hello$default(e, __witness_Greet_En)");
    expect(js).toMatch(
      /const __witness_Greet_En = \(\(\) => \{ const w = \{name: En\$Greet\$name\}; w\.hello = \(self, \.\.\.args\) => Greet\$hello\$default\(self, \.\.\.args, w\); return w; \}\)\(\);/,
    );
    expect(runEmittedJs(js)).toEqual(["42"]);
  });

  it("dispatches a default method through a witness in a generic body, and runs", (): void => {
    const js = emittedJs(`
      ${greetTrait}
      fn greet<T: Greet>(t: &T) -> i32 { t.hello() }
      fn main() { let e = En { who: 7 }; print(greet(&e)); }
    `);
    expect(js).toContain("_witness_T_Greet.hello(t)");
    expect(runEmittedJs(js)).toEqual(["7"]);
  });

  it("passes a default method's own arguments before the witness", (): void => {
    const js = emittedJs(`
      trait Scale {
        fn base(&self) -> i32;
        fn scaled(&self, k: i32) -> i32 { self.base() * k }
      }
      struct N { v: i32 }
      impl Scale for N { fn base(&self) -> i32 { self.v } }
      fn main() { let n = N { v: 3 }; print(n.scaled(4)); }
    `);
    expect(js).toContain(
      "function Scale$scaled$default(self, k, _witness_Self_Scale)",
    );
    expect(js).toContain("Scale$scaled$default(n, 4, __witness_Scale_N)");
    expect(runEmittedJs(js)).toEqual(["12"]);
  });

  it("uses an impl's override, not `Trait$m$default`, when the impl provides the method", (): void => {
    const js = emittedJs(`
      trait Greet {
        fn name(&self) -> i32;
        fn hello(&self) -> i32 { self.name() }
      }
      struct En { who: i32 }
      impl Greet for En {
        fn name(&self) -> i32 { self.who }
        fn hello(&self) -> i32 { self.who + 100 }
      }
      fn greet<T: Greet>(t: &T) -> i32 { t.hello() }
      fn main() {
        let e = En { who: 5 };
        print(e.hello());
        print(greet(&e));
      }
    `);
    expect(js).toContain("hello: En$Greet$hello");
    expect(js).not.toMatch(/w\.hello = /);
    expect(js).toContain("En$Greet$hello(e)");
    expect(runEmittedJs(js)).toEqual(["105", "105"]);
  });

  it("leaves a default body's supertrait call as a plain method call (supertrait dispatch is a later slice)", (): void => {
    const js = emittedJs(`
      trait Base { fn base(&self) -> i32; }
      trait Ext: Base {
        fn ext(&self) -> i32 { self.base() + 1 }
      }
      struct S { n: i32 }
      impl Base for S { fn base(&self) -> i32 { self.n } }
      impl Ext for S {}
      fn main() { print(0); }
    `);
    // `self.base()` in `Ext`'s default resolves to `Base`, not `Ext` - no
    // `_witness_Self_Base` param exists, so it stays a plain method call.
    expect(js).toContain("function Ext$ext$default(self, _witness_Self_Ext)");
    expect(js).toContain("self.base()");
    expect(js).not.toContain("_witness_Self_Base");
  });
});

describe("a rejected construct is named without an internal roadmap slice", (): void => {
  it.each([
    ["fn main() { loop {} }", "`loop` expressions are not yet supported"],
    ["fn main() { while true {} }", "`while` loops are not yet supported"],
    ["fn main() { for x in v {} }", "`for` loops are not yet supported"],
    [
      "fn f() { let x: Vec::<i32> = v; }",
      "generic type arguments are not yet supported",
    ],
    ["fn f() { let x: 'a = y; }", "lifetime annotations are not yet supported"],
    ["fn f(x: (i32, i32)) {}", "tuple types are not yet supported"],
    ["fn f(x: [i32]) {}", "slice types (`[T]`) are not yet supported"],
    ["fn f(x: !) {}", "the never type (`!`) is not yet supported"],
    ["let x: Vec<'a> = v;", "lifetime arguments are not yet supported"],
    ["async fn f() {}", "`async` is not yet supported"],
    ["export fn f() {}", "`export` declarations are not yet supported"],
    ["extern fn f() {}", "`extern` declarations are not yet supported"],
    ["use foo;", "`use` is not yet supported"],
    ["mod foo;", "`mod` is not yet supported"],
    ["pub(crate) struct Foo;", "`pub(crate)` visibility is not yet supported"],
    [
      "fn f() { let x: i32::Foo = 0; }",
      "qualified type paths are not supported yet",
    ],
    ["fn f(x: UnknownType) {}", "cannot find type `UnknownType` in this scope"],
    ["fn f() -> Nope { 0 }", "cannot find type `Nope` in this scope"],
  ])("%j is rejected with a slice-free message", (source, message): void => {
    const { diagnostics } = compile(source);
    expect(messageOf(diagnostics[0])).toBe(message);
  });
});

describe("dyn Trait as a type", (): void => {
  it("throws at JSIM lowering for a semantically clean program that uses a dyn type, since dispatch codegen is not implemented yet", (): void => {
    expect(() =>
      compile(`
        trait Draw {
          fn draw(&self) -> str;
        }
        fn f(x: dyn Draw) {}
        fn main() {
          print("done");
        }
      `),
    ).toThrow("dyn Trait code generation is not implemented yet");
  });

  it("throws at JSIM lowering for a dyn type nested inside an array parameter", (): void => {
    expect(() =>
      compile(`
        trait Draw { fn draw(&self) -> str; }
        fn f(xs: [dyn Draw; 2]) {}
        fn main() { print("done"); }
      `),
    ).toThrow("dyn Trait code generation is not implemented yet");
  });
});

describe("std prelude", (): void => {
  it("resolves a user `impl Drop for X` against the prelude without a local trait declaration", (): void => {
    const result = compile(`
      struct Handle { fd: i32 }
      impl Drop for Handle { fn drop(&mut self) {} }
      fn main() {}
    `);
    expect(result.diagnostics).toEqual([]);
    expect(isSome(result.code)).toBe(true);
  });

  it("rejects `impl Eq for X` with no `impl PartialEq for X`, resolving Eq's supertrait from the prelude", (): void => {
    const result = compile(`
      struct Counter { n: i32 }
      impl Eq for Counter {}
      fn main() {}
    `);
    expect(isNone(result.code)).toBe(true);
    expect(result.diagnostics.map((d) => `${d.code}: ${messageOf(d)}`)).toEqual(
      [
        "HEDGE-TRAIT-002: the trait bound `Counter: PartialEq` is not satisfied",
      ],
    );
  });

  it("still recovers a missing-item-name error whose source offset collides with a prelude token", (): void => {
    // The bad-name token (`struct`) is padded to sit at the same source
    // offset as the prelude's first `fn`, the case where a span-keyed
    // recovery lookup could pick the prelude token instead of the user's.
    const pad = " ".repeat(PRELUDE_SOURCE.indexOf("fn ") - "fn ".length);
    const result = compile(
      `${pad}fn struct() {}\nfn main() { let x: Bogus = 1; }`,
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "HEDGE-PARSE-001",
      "HEDGE-NAME-001",
      "HEDGE-TYPE-001",
    ]);
  });

  it("leaves emitted JavaScript byte-identical to the same program compiled before the prelude existed", (): void => {
    const result = compile(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let mut p = Point { x: 1, y: 2 };
        p.x = p.x + p.y;
      }
    `);
    assert(isSome(result.code), "expected code");
    const { javascript } = result.code.value;
    assert(isSome(javascript), "expected javascript");
    expect(javascript.value).toBe(
      [
        "#!/usr/bin/env node",
        "",
        "function main() {",
        "  let p = ({x: 1, y: 2, [Symbol.dispose]() {}});",
        "  p.x = ((p.x + p.y)|0);",
        "}",
        "",
        "main();",
        "",
      ].join("\n"),
    );
  });
});
