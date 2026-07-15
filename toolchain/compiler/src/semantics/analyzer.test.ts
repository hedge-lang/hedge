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

  it("rejects &x with a Slice 1 diagnostic", (): void => {
    const result = diagnose("fn f(x: i32) { &x; }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
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

  it("still rejects a & expression operator inside a function whose declared types are all references (the Slice-1 borrow-expression guardrail is untouched)", (): void => {
    const result = diagnose("fn f(x: i32) { let r = &x; print(r); }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "borrow expressions are not supported in Slice 1",
    );
  });

  it("still rejects a * expression operator the same way, even for a &i32-typed binding", (): void => {
    const result = diagnose("fn f(x: &'a i32) -> i32 { *x }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain(
      "dereference expressions are not supported in Slice 1",
    );
  });
});
