import { describe, expect, it } from "vitest";
import { assert } from "../assert.js";

import { tokenize } from "../lexer/lexer.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import type { AnalysisResult } from "./analyzer.js";
import { analyze } from "./analyzer.js";

function analyzeWithTokens(source: string): {
  result: AnalysisResult;
  tokens: ReturnType<typeof tokenize>["tokens"];
} {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return { result: analyze(program.value, tokens), tokens };
}

function diagnose(source: string): AnalysisResult {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return analyze(program.value, tokens);
}

describe("semantic analysis", (): void => {
  it("accepts the tracer bullet with no diagnostics", (): void => {
    const result = diagnose(`
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an undefined name", (): void => {
    const result = diagnose("fn main() { print(missing); }");
    expect(result.diagnostics).toHaveLength(1);
    const first = result.diagnostics[0];
    expect(first?.severity).toBe("error");
    expect(first?.message).toContain("missing");
  });

  it("resolves a let binding within its block", (): void => {
    const result = diagnose('fn main() { let x = "a"; print(x); }');
    expect(result.diagnostics).toEqual([]);
  });

  it("does not resolve a name used before its let binding", (): void => {
    const result = diagnose('fn main() { print(x); let x = "a"; }');
    expect(result.diagnostics).toHaveLength(1);
    const first = result.diagnostics[0];
    expect(first?.message).toContain("x");
  });

  it("resolves a function parameter name inside the function body", (): void => {
    const result = diagnose("fn f(x: i32) { print(x); }");
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an error for a name that does not match any parameter", (): void => {
    const result = diagnose("fn f(x: i32) { print(y); }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("y");
  });

  describe("top-level function resolution", () => {
    it("resolves a call to a top-level function from another top-level function", (): void => {
      const result = diagnose(
        "fn add(a: i32, b: i32) -> i32 { a + b } fn main() { print(add(1, 2)); }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a call to a top-level function declared later in the file", (): void => {
      const result = diagnose(
        "fn main() { print(later(3)); } fn later(x: i32) -> i32 { x + 1 }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a genuinely undefined top-level function call", (): void => {
      const result = diagnose("fn main() { print(missing_fn(1)); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("missing_fn");
    });

    it("rejects a duplicate top-level function declaration", (): void => {
      const result = diagnose(
        "fn add(a: i32) -> i32 { a } fn add(b: i32) -> i32 { b } fn main() {}",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "defined more than once",
      );
    });

    it("does not flag a top-level function named the same as a builtin as a duplicate", (): void => {
      const result = diagnose("fn print() {} fn main() {}");
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("struct declaration does not crash the analyzer", (): void => {
    const result = diagnose("struct Foo;");
    expect(result.diagnostics).toEqual([]);
  });

  describe("top-level item restriction", () => {
    it("bare expression at top level is an error", () => {
      const result = diagnose("x + y;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    });

    it("let statement at top level is an error", () => {
      const result = diagnose("let x = 1;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    });

    it("block at top level is an error", () => {
      const result = diagnose("{ 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    });

    it("function declaration at top level is accepted", () => {
      const result = diagnose("fn f() {}");
      expect(result.diagnostics).toEqual([]);
    });

    it("struct declaration at top level is accepted", () => {
      const result = diagnose("struct Foo;");
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("accepts &x as a shared borrow of a parameter, with no diagnostics", (): void => {
    const result = diagnose("fn f(x: i32) { &x; }");
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an unsupported param type with a Slice 1 diagnostic", (): void => {
    const result = diagnose("fn f(x: UnknownType) {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("rejects a qualified type in a param position with a Slice 1 diagnostic", (): void => {
    const result = diagnose("fn f(x: i32::Foo) {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("unsupported param type diagnostic span points at the type token", (): void => {
    const source = "fn f(x: UnknownType) {}";
    const { result } = analyzeWithTokens(source);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
    const span = result.diagnostics[0].span;
    assert(isSome(span), "Expected span");
    expect(span.value.start).toBe(source.indexOf("UnknownType"));
  });

  it("accepts a struct type as a function parameter type", (): void => {
    const result = diagnose(`
      struct Boxed { value: i32 }
      fn take(v: Boxed) { print(v.value); }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a struct type as a function return type", (): void => {
    const result = diagnose(`
      struct Boxed { value: i32 }
      fn make() -> Boxed { Boxed { value: 1 } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  describe("integer literal range validation", () => {
    describe("negated literal in binary expression", () => {
      it("rejects a negated literal below i8 min in a comparison", () => {
        const result = diagnose("fn f(x: i8) { print(-0x81 == x); }");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("out of range for i8");
      });

      it("accepts a negated literal at exactly i8 min in a comparison", () => {
        const result = diagnose("fn f(x: i8) { print(-0x80 == x); }");
        expect(result.diagnostics).toEqual([]);
      });
    });
  });

  it("rejects comparisons with right-side boolean", (): void => {
    const result = diagnose("fn main() { let x = 1 < (2 < 3); }");
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        message: "type does not support ordering comparison",
      },
    ]);
  });

  it("rejects comparisons with left-side boolean", (): void => {
    const result = diagnose("fn main() { let x = (1 < 2) < 3; }");
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        message: "type does not support ordering comparison",
      },
    ]);
  });

  it("rejects ordering comparison between two booleans", (): void => {
    const result = diagnose("fn main() { let x = true < false; }");
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        message: "type does not support ordering comparison",
      },
    ]);
  });

  it("rejects arithmetic on unit-typed operands", (): void => {
    const result = diagnose('fn main() { let x = print("hi") + 1; }');
    const numericError = result.diagnostics.find((d) =>
      d.message.includes("arithmetic operands must be numeric"),
    );
    assert(numericError !== undefined, "Expected a numeric-operand error");
    expect(numericError.severity).toBe("error");
    expect(numericError.message).toContain("()");
  });

  it.each(["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>="])(
    "rejects `%s` assignment to immutable let binding",
    (op): void => {
      const result = diagnose(`fn main() { let x = 1; x ${op} 1; print(x); }`);
      expect(result.diagnostics).toMatchObject([
        { severity: "error", message: "cannot assign to immutable binding" },
      ]);
    },
  );

  it("rejects field assignment to immutable binding (inherited mutability)", (): void => {
    const result = diagnose("fn f(s: Point) { s.x = 1; }");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "cannot assign to immutable binding",
        }),
      ]),
    );
  });

  it("emits exactly one diagnostic for an unsupported param type on a block-local fn", (): void => {
    const result = diagnose("fn main() { fn f(x: unknownType) {} }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("struct defined in one function body does not leak into a sibling function", (): void => {
    const result = diagnose(`
      fn first() { struct Foo { x: i32 } }
      fn second() { struct Foo { x: i32 } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not cascade a type-mismatch diagnostic for an unresolved let initializer", (): void => {
    const { diagnostics } = diagnose("fn main() { let x: i32 = missing_var; }");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("missing_var");
  });

  it("rejects a genuinely unit-typed let initializer against a non-unit annotation", (): void => {
    const { diagnostics } = diagnose("fn main() { let x: i32 = {}; }");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("type mismatch");
  });

  describe("range expression analysis", () => {
    it("recurses into both operands, reporting each unresolved name once", (): void => {
      const { diagnostics } = diagnose(
        "fn main() { let x = missing_start..missing_end; }",
      );
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]?.message).toContain("missing_start");
      expect(diagnostics[1]?.message).toContain("missing_end");
    });

    it("does not cascade a spurious type-mismatch when used as a mismatched-type let initializer (UnitType is ambiguous, not genuine)", (): void => {
      const { diagnostics } = diagnose("fn main() { let x: i32 = 1..2; }");
      expect(diagnostics).toEqual([]);
    });
  });

  describe("function return type", () => {
    it("rejects a body whose trailing expression does not match the declared return type", (): void => {
      const { diagnostics } = diagnose('fn bad() -> i32 { "x" }');
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("return type mismatch");
      expect(diagnostics[0].message).toContain("i32");
      expect(diagnostics[0].message).toContain("str");
    });

    it("return type mismatch diagnostic span points at the trailing expression", (): void => {
      const source = 'fn bad() -> i32 { "x" }';
      const { result } = analyzeWithTokens(source);
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
      const span = result.diagnostics[0].span;
      assert(isSome(span), "Expected span");
      expect(span.value.start).toBe(source.indexOf('"x"'));
    });

    it("accepts a matching i32 return type", (): void => {
      const result = diagnose("fn f() -> i32 { 5 }");
      expect(result.diagnostics).toEqual([]);
    });

    it("coerces an unsuffixed literal trailing expression to the declared return type", (): void => {
      const result = diagnose("fn f() -> u8 { 5 }");
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a coerced literal trailing expression that is out of range for the return type", (): void => {
      const { diagnostics } = diagnose("fn f() -> u8 { 300 }");
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("out of range for u8");
    });

    it("accepts a negated literal at exactly i8 min as the return value", (): void => {
      const { diagnostics } = diagnose("fn f() -> i8 { -0x80 }");
      expect(diagnostics).toEqual([]);
    });

    it("rejects a negated literal below i8 min as the return value", (): void => {
      const { diagnostics } = diagnose("fn f() -> i8 { -0x81 }");
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("out of range for i8");
    });

    it("does not cascade a return-type-mismatch diagnostic for an unresolved trailing name", (): void => {
      const { diagnostics } = diagnose("fn bad() -> i32 { unknown_name }");
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("unknown_name");
    });

    it("rejects a genuinely unit-typed trailing expression against a non-unit return type", (): void => {
      const { diagnostics } = diagnose('fn f() -> i32 { print("hi") }');
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("return type mismatch");
      expect(diagnostics[0].message).toContain("i32");
      expect(diagnostics[0].message).toContain("()");
    });

    it("accepts a body with no trailing expression when the return type is implicit unit", (): void => {
      const { diagnostics } = diagnose("fn f() {}");
      expect(diagnostics).toEqual([]);
    });

    it("rejects a declared non-unit return type with no trailing expression", (): void => {
      const { diagnostics } = diagnose("fn f() -> i32 {}");
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("missing return value");
      expect(diagnostics[0].message).toContain("i32");
    });

    it("accepts a matching if/else trailing expression as the return value", (): void => {
      const { diagnostics } = diagnose(
        "fn f() -> i32 { if true { 1 } else { 2 } }",
      );
      expect(diagnostics).toEqual([]);
    });

    it("rejects a mismatching if/else trailing expression as the return value", (): void => {
      const { diagnostics } = diagnose(
        "fn f() -> bool { if true { 1 } else { 2 } }",
      );
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("return type mismatch");
    });

    it("checks the return type of a block-local function", (): void => {
      const { diagnostics } = diagnose('fn main() { fn bad() -> i32 { "x" } }');
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("return type mismatch");
    });
  });

  describe("struct field type", () => {
    it("rejects a field value whose type does not match the declared field type", (): void => {
      const { diagnostics } = diagnose(`
        struct Point { x: i32 }
        fn main() { let p = Point { x: "bad" }; print(p.x); }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("x");
      expect(diagnostics[0].message).toContain("i32");
      expect(diagnostics[0].message).toContain("str");
    });

    it("field type mismatch diagnostic span points at the field value", (): void => {
      const source =
        'struct Point { x: i32 } fn main() { let p = Point { x: "bad" }; }';
      const { result } = analyzeWithTokens(source);
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
      const span = result.diagnostics[0].span;
      assert(isSome(span), "Expected span");
      expect(span.value.start).toBe(source.indexOf('"bad"'));
    });

    it("accepts a matching field value", (): void => {
      const { diagnostics } = diagnose(`
        struct Point { x: i32 }
        fn main() { let p = Point { x: 1 }; print(p.x); }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("coerces an unsuffixed literal field value to the declared field type", (): void => {
      const { diagnostics } = diagnose(`
        struct Point { x: u8 }
        fn main() { let p = Point { x: 5 }; print(p.x); }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("rejects a coerced literal field value that is out of range for the field type", (): void => {
      const { diagnostics } = diagnose(`
        struct Point { x: u8 }
        fn main() { let p = Point { x: 300 }; print(p.x); }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("out of range for u8");
    });

    it("reports each mismatched field independently", (): void => {
      const { diagnostics } = diagnose(`
        struct P { x: i32, y: bool }
        fn main() { let p = P { x: "a", y: 1 }; }
      `);
      expect(diagnostics).toHaveLength(2);
    });

    it("does not cascade a field-type-mismatch diagnostic for an unresolved field value", (): void => {
      const { diagnostics } = diagnose(`
        struct P { x: i32 }
        fn main() { let p = P { x: unknown_name }; }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("unknown_name");
    });

    it("rejects a genuinely unit-typed field value against a non-unit field type", (): void => {
      const { diagnostics } = diagnose(`
        struct P { x: i32 }
        fn main() { let p = P { x: print("hi") }; }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("type mismatch");
    });

    it("leaves a shorthand field untouched", (): void => {
      const { diagnostics } = diagnose(`
        struct P { x: i32 }
        fn main() { let x: i32 = 1; let p = P { x }; print(p.x); }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("still checks field types when a struct-update base is present", (): void => {
      const { diagnostics } = diagnose(`
        struct P { x: i32, y: i32 }
        fn main() {
          let base = P { x: 1, y: 2 };
          let p = P { x: "bad", ..base };
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("x");
    });
  });

  it.fails.each(["loop", "while", "for x in [1, 2, 3]"])(
    "%s statement at top level is an error",
    (stmt) => {
      const result = diagnose(`${stmt}; fn main() {}`);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    },
  );
});

describe("reference types", (): void => {
  it("type-checks a function returning its own reference-typed parameter with no diagnostics, since the body never uses a &/* operator", (): void => {
    const result = diagnose("fn first(s: &str) -> &str { s }");
    expect(result.diagnostics).toEqual([]);
  });

  it("type-checks a signature with fully explicit lifetime annotations with no diagnostics", (): void => {
    const result = diagnose(
      "fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a mutability mismatch between a &i32 parameter and a &mut i32 return type", (): void => {
    const result = diagnose("fn f(x: &'a i32) -> &'a mut i32 { x }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("return type mismatch");
    expect(result.diagnostics[0].message).toContain("&mut i32");
    expect(result.diagnostics[0].message).toContain("&i32");
  });

  it("rejects a referent-type mismatch between a &i32 parameter and a &str return type", (): void => {
    const result = diagnose("fn f(x: &'a i32) -> &'a str { x }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("return type mismatch");
  });

  it("accepts a & expression operator borrowing a bare local, with no diagnostics", (): void => {
    const result = diagnose("fn f(x: i32) { let r = &x; print(r); }");
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a &mut expression operator borrowing a field place, with no diagnostics", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(mut foo: Foo) { let r = &mut foo.value; print(r); }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a &mut expression operator borrowing a nested field chain, with no diagnostics", (): void => {
    const result = diagnose(
      `struct Inner { v: i32 }
       struct Outer { inner: Inner }
       fn f(mut o: Outer) { let r = &mut o.inner.v; print(r); }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a &mut expression operator borrowing an index place, with no diagnostics", (): void => {
    const result = diagnose(
      "fn f(mut x: i32) { let r = &mut x[0]; print(r); }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a &mut expression operator reborrowing a dereferenced place, with no diagnostics", (): void => {
    const result = diagnose(
      "fn f(r: &'a mut i32) { let rr = &mut *r; print(rr); }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a &mut expression operator borrowing a field reached through a dereference, with no diagnostics", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(r: &'a mut Foo) { let rr = &mut (*r).value; print(rr); }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a &mut expression operator borrowing an absolute path, since it isn't a bare local", (): void => {
    const result = diagnose(
      "fn f() { let mut x = 1; let r = &mut ::x; print(r); }",
    );
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "only a local binding, a parameter, or a field, index, or dereference of one can be borrowed directly",
    );
  });

  it("rejects a &mut expression operator borrowing a non-place expression, without misnaming it as a field or index place", (): void => {
    const result = diagnose(
      "fn f() { let mut x = 1; let r = &mut (x + 1); print(r); }",
    );
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "only a local binding, a parameter, or a field, index, or dereference of one can be borrowed directly",
    );
    expect(result.diagnostics[0].message).not.toContain("field or index place");
  });

  it("type-checks *x as the referent type of a &i32 parameter, with no diagnostics", (): void => {
    const result = diagnose("fn f(x: &'a i32) -> i32 { *x }");
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts assignment through a &mut i32 parameter, with no diagnostics", (): void => {
    const result = diagnose("fn f(x: &'a mut i32) { *x = 1; }");
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects assignment through a shared &i32 parameter", (): void => {
    const result = diagnose("fn f(x: &'a i32) { *x = 1; }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "cannot assign through a shared reference",
    );
  });

  it("rejects dereferencing a non-reference type", (): void => {
    const result = diagnose("fn f(x: i32) { *x; }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "cannot dereference a non-reference type",
    );
  });

  it("does not cascade a second dereference diagnostic for an unresolved operand", (): void => {
    const result = diagnose("fn f() { *missing; }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("missing");
  });

  it("resolves a field read through a shared reference to the referent struct's field type", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(r: &Foo) -> i32 { r.value }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves a field read through a mutable reference to the referent struct's field type", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(r: &mut Foo) -> i32 { r.value }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts field assignment through a &mut reference even though the reference binding itself isn't `let mut`", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(mut foo: Foo) { let r = &mut foo; r.value = 2; }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects field assignment through a shared reference even when the reference binding itself is `let mut`", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(foo: Foo) { let mut r = &foo; r.value = 1; }",
    );
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "cannot assign through a shared reference",
    );
  });

  it("rejects field assignment through a parenthesized dereference of a shared reference", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(foo: Foo) { let r = &foo; (*r).value = 1; }",
    );
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "cannot assign through a shared reference",
    );
  });

  it("accepts field assignment through a parenthesized dereference of a mutable reference", (): void => {
    const result = diagnose(
      "struct Foo { value: i32 } fn f(mut foo: Foo) { let r = &mut foo; (*r).value = 1; }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts writing through a struct field that itself holds a &mut reference, regardless of the containing binding's own mutability", (): void => {
    const result = diagnose(`
      struct Bar { value: i32 }
      struct Foo<'a> { b: &'a mut Bar }
      fn f(foo: Foo) { foo.b.value = 2; }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects writing through a struct field that holds a shared & reference, even when the containing binding is mut", (): void => {
    const result = diagnose(`
      struct Bar { value: i32 }
      struct Foo<'a> { b: &'a Bar }
      fn f(mut foo: Foo) { foo.b.value = 2; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "cannot assign through a shared reference",
    );
  });
});

describe("array types", (): void => {
  it("type-checks a [i32; 3] annotation against a matching array literal", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        print(arr);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an array literal whose element count does not match the declared length", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2];
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("type mismatch");
  });

  it("rejects an array literal whose element type does not match the declared element type", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, true];
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("infers [i32; 3] from an array literal with no explicit annotation", (): void => {
    const result = diagnose(`
      fn main() {
        let arr = [1, 2, 3];
        print(arr);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("type-checks the repeat-form array literal [0; 5]", (): void => {
    const result = diagnose(`
      fn main() {
        let arr = [0; 5];
        print(arr);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a repeat-form array literal whose element type is not Copy", (): void => {
    // Unlike the list form (each element is its own expression), a repeat
    // form's single value expression is evaluated once and its result
    // reused for every slot - codegen lowers this to `.fill(value)`, which
    // would put the exact same JS object reference in every element rather
    // than a distinct value per slot. Matches Rust's own rule that `[expr; N]`
    // requires `expr: Copy` (or a const item, which Hedge doesn't have yet).
    const result = diagnose(`
      struct Boxed { value: i32 }
      fn main() {
        let arr = [Boxed { value: 1 }; 3];
        print(arr[0].value);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("Copy");
  });

  it("rejects a repeat-form count that is not a literal integer", (): void => {
    const result = diagnose(`
      fn main() {
        let n = 5;
        let arr = [0; n];
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("literal integer");
  });

  it("rejects a repeat-form count too large to represent as a safe integer", (): void => {
    const result = diagnose(`
      fn main() {
        let arr = [1; 99999999999999999999999999];
        print(arr[0]);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("too large");
  });

  it("rejects an array type annotation whose length is too large to represent as a safe integer", (): void => {
    // Uses a function parameter's type, not a `let` annotation, so the only
    // diagnostic in play is the length check itself - a `let` annotation
    // this invalid would independently trigger a second, pre-existing
    // "type mismatch" diagnostic against its initializer (unrelated to this
    // check), the same cascade an unresolved struct-name annotation already
    // produces today.
    const result = diagnose(`
      fn f(arr: [i32; 99999999999999999999999999]) { print(arr); }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("too large");
  });

  it("rejects list-literal elements that do not all share the same type", (): void => {
    const result = diagnose(`
      fn main() {
        let arr = [1, true, "x"];
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "array elements must all have the same type",
    );
  });

  it("rejects an empty array literal with no explicit annotation, since the element type can't be inferred", (): void => {
    const result = diagnose(`
      fn main() {
        let arr = [];
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("infer");
  });

  it("accepts an empty array literal with an explicit [i32; 0] annotation", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 0] = [];
        print(arr);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("type-checks indexing an array with a literal in-range index", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let x: i32 = arr[0];
        print(x);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("type-checks indexing an array with a usize-typed variable index", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let i: usize = 1;
        let x: i32 = arr[i];
        print(x);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a non-integer array index", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let x = arr[true];
        print(x);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("usize");
  });

  it("rejects an i32-typed variable index, since indices must specifically be usize, not just any integer type", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let i: i32 = 1;
        let x = arr[i];
        print(x);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("usize");
  });

  it("rejects indexing a non-array type", (): void => {
    const result = diagnose(`
      fn main() {
        let x: i32 = 1;
        let y = x[0];
        print(y);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("cannot index");
  });

  it("accepts a literal index equal to the last valid position (length - 1)", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let x: i32 = arr[2];
        print(x);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a literal index one past the end (length) as a compile-time out-of-bounds error", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let x: i32 = arr[3];
        print(x);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("out of bounds");
  });

  it("rejects a literal negative index as a compile-time error", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        let x: i32 = arr[-1];
        print(x);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("type-checks binding an array's own value to a second let, regardless of move-checking (a separate pass)", (): void => {
    const result = diagnose(`
      fn main() {
        let a: [i32; 3] = [1, 2, 3];
        let b = a;
        print(b);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("type-checks a non-Copy struct element type inferred from an array literal", (): void => {
    const result = diagnose(`
      struct Boxed { value: i32 }
      fn main() {
        let arr = [Boxed { value: 1 }, Boxed { value: 2 }];
        print(arr);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("type-checks a non-Copy struct element type in an explicit array type annotation", (): void => {
    const result = diagnose(`
      struct Boxed { value: i32 }
      fn f(arr: [Boxed; 2]) { print(arr); }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts writing through an index on a mut array binding", (): void => {
    const result = diagnose(`
      fn main() {
        let mut arr: [i32; 3] = [1, 2, 3];
        arr[0] = 99;
        print(arr);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects writing through an index on a non-mut array binding", (): void => {
    const result = diagnose(`
      fn main() {
        let arr: [i32; 3] = [1, 2, 3];
        arr[0] = 99;
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("immutable");
  });
});
