import { describe, expect, it } from "vitest";
import { assert } from "../assert.js";

import { tokenize } from "../lexer/lexer.js";
import { isSome, none } from "../option.js";
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

  describe("shift operand types", () => {
    it("accepts a shift amount whose type differs from the shifted value", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 1; let n: u8 = 2u8; let y: i32 = x << n; }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a non-bigint shift amount against a bigint value", () => {
      const result = diagnose(
        "fn main() { let x: i64 = 1i64; let n: i32 = 2; let y: i64 = x << n; }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a non-integer shift amount", () => {
      const result = diagnose(
        'fn main() { let x: i32 = 1; let s: str = "a"; let y: i32 = x << s; }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "the shift amount must be an integer",
      );
    });

    it("still requires matching operand types for a non-shift bitwise operator", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 1; let n: u8 = 2u8; let y: i32 = x & n; }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "bitwise operands must have the same type",
      );
    });

    it("rejects shifting a non-integer value", () => {
      const result = diagnose("fn main() { let y = 1.5 << 2; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "the shifted value must be an integer",
      );
    });
  });

  describe("binary operator type checking", () => {
    it("rejects an equality comparison on a struct type, which has no equality capability", () => {
      const result = diagnose(`
        struct P { x: i32 }
        fn main() { let a: P = P { x: 1 }; let b: P = P { x: 2 }; let c = a == b; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "type does not support equality comparison",
      );
    });

    it("rejects an equality comparison between two individually-comparable but differently-typed operands", () => {
      const result = diagnose('fn main() { let x = 1 == "a"; }');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "comparison operands must have the same type",
      );
    });

    it("rejects an ordering comparison between two individually-ordered but differently-typed operands", () => {
      const result = diagnose("fn main() { let x = 'a' < 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "comparison operands must have the same type",
      );
    });

    it("does not cascade a capability diagnostic when a comparison operand is an unresolved name", () => {
      const result = diagnose("fn main() { let x = missing_name == 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        'Cannot find name "missing_name" in this scope.',
      );
    });

    it("rejects a logical operator with a non-bool left operand", () => {
      const result = diagnose("fn main() { let x = 1 && true; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "logical operator operands must be `bool`",
      );
    });

    it("rejects a logical operator with a non-bool right operand", () => {
      const result = diagnose("fn main() { let x = true && 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "logical operator operands must be `bool`",
      );
    });

    it("reports both operands independently when neither side of a logical operator is bool", () => {
      const result = diagnose('fn main() { let x = 1 && "a"; }');
      expect(result.diagnostics).toHaveLength(2);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.message).toBe(
          "logical operator operands must be `bool`",
        );
      }
    });

    it("rejects arithmetic between two individually-numeric but differently-typed operands", () => {
      const result = diagnose("fn main() { let x = 1 + 1.5; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "arithmetic operands must have the same type",
      );
    });

    it("rejects a bitwise operator on a non-integer operand, alongside the resulting type mismatch", () => {
      // The capability check and the same-type check are independent, not
      // an if/else-if - both fire here since `f64`/`i32` are also
      // different types, unlike the comparison operators above.
      const result = diagnose("fn main() { let x = 1.5 & 2; }");
      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics[0]?.message).toBe(
        "bitwise operations require integer operands",
      );
      expect(result.diagnostics[1]?.message).toBe(
        "bitwise operands must have the same type",
      );
    });

    it("rejects a bitwise operator on two same-typed non-integer operands, isolating the capability check", () => {
      const result = diagnose("fn main() { let x = 1.5 & 2.5; }");
      expect(result.diagnostics).toHaveLength(2);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.message).toBe(
          "bitwise operations require integer operands",
        );
      }
    });
  });

  describe("method call and tuple expressions (Slice 1 placeholders)", () => {
    it("still resolves an undeclared name inside a method call's receiver", () => {
      const result = diagnose("fn main() { missing.foo(); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        'Cannot find name "missing" in this scope.',
      );
    });

    it("still resolves an undeclared name inside a method call's arguments", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 1; x.foo(missing_arg); }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        'Cannot find name "missing_arg" in this scope.',
      );
    });

    it("accepts a method call with no diagnostics when receiver and arguments are well-formed", () => {
      const result = diagnose("fn main() { let x: i32 = 1; x.foo(); }");
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a non-empty tuple literal with no diagnostics, since tuple types aren't checked yet", () => {
      const result = diagnose("fn main() { let x = (1, 2); }");
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("array length bound", () => {
    it("accepts an array length equal to the maximum a usize index can hold", () => {
      const result = diagnose("fn f(arr: [i32; 4294967295]) { }");
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects an array length one past that maximum", () => {
      const result = diagnose("fn f(arr: [i32; 4294967296]) { }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("exceeds the maximum");
    });
  });

  describe("unary `!`", () => {
    it("keeps `bool` for a logical negation", () => {
      const result = diagnose(
        "fn main() { let b: bool = true; let c: bool = !b; }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("yields the operand's integer type for a bitwise negation", () => {
      const result = diagnose("fn main() { let x: i32 = 5; let y: i32 = !x; }");
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects binding a negated integer to bool", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 5; let b: bool = !x; }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("type mismatch");
    });

    it("rejects negating a string", () => {
      const result = diagnose(
        'fn main() { let s: str = "a"; let b: bool = !s; }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "`!` requires `bool` or an integer, found `str`",
      );
    });

    it("rejects negating a float, which has no bitwise meaning", () => {
      const result = diagnose(
        "fn main() { let f: f64 = 1.0; let b: bool = !f; }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("found `f64`");
    });
  });

  describe("if expression branch types", () => {
    it("rejects an empty else branch against a value-producing then branch", () => {
      const result = diagnose(
        "fn main() { let c: bool = true; let x: i32 = if c { 1 } else { }; }",
      );
      expect(result.diagnostics[0]?.message).toContain(
        "if expression branches have incompatible types",
      );
    });

    it("rejects branches of differing value types", () => {
      const result = diagnose(
        'fn main() { let c: bool = true; let x: i32 = if c { 1 } else { "a" }; }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "if expression branches have incompatible types",
      );
    });

    it("accepts a statement-position if whose branches both produce no value", () => {
      const result = diagnose(
        'fn main() { let c: bool = true; if c { print("a"); } else { print("b"); } }',
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("does not add a branch-type error when a branch's own analysis already failed", () => {
      const result = diagnose(
        "fn main() { let c: bool = true; let x: i32 = if c { nope } else { 2 }; }",
      );
      expect(
        result.diagnostics.filter((d) =>
          d.message.includes("if expression branches"),
        ),
      ).toEqual([]);
    });
  });

  describe("pattern type checking", () => {
    it("rejects a string-literal pattern against an integer scrutinee", () => {
      const result = diagnose(
        'fn main() { let x: i32 = 1; match x { "hello" => {}, _ => {} } }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `i32`, found `str`",
      );
    });

    it("rejects an integer-literal pattern against a string scrutinee", () => {
      const result = diagnose(
        'fn main() { let x: str = "a"; match x { 1 => {}, _ => {} } }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `str`, found `i32`",
      );
    });

    it("rejects a literal pattern against an enum scrutinee instead of crashing in lowering", () => {
      const result = diagnose(
        "enum E { A(i32) } fn main() { let e = E::A(1); match e { 7 => {}, _ => {} } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("expected `E`");
    });

    it("rejects a range pattern whose bounds disagree with the scrutinee", () => {
      const result = diagnose(
        "fn main() { let x: char = 'a'; match x { 1..=5 => {}, _ => {} } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `char`, found `i32`",
      );
    });

    it("rejects a range pattern whose two bounds have different types", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 1; match x { 1..='z' => {}, _ => {} } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "range bounds must have the same type",
      );
    });

    it("rejects a range whose lower bound exceeds its upper bound", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 1; match x { 10..=2 => {}, _ => {} } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("matches nothing");
    });

    it("rejects a mistyped pattern in an if let scrutinee too", () => {
      const result = diagnose(
        'fn main() { let x: i32 = 1; if let "s" = x { } }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `i32`, found `str`",
      );
    });

    it("coerces an unsuffixed integer-literal pattern to the scrutinee's type", () => {
      const result = diagnose(
        "fn main() { let x: u8 = 1; match x { 1 => {}, _ => {} } }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("range-checks a coerced literal pattern against the scrutinee's type", () => {
      const result = diagnose(
        "fn main() { let x: u8 = 1; match x { 300 => {}, _ => {} } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("out of range for u8");
    });

    it("accepts a negative range against a signed scrutinee", () => {
      const result = diagnose(
        "fn main() { let x: i32 = 1; match x { -5..=-1 => {}, _ => {} } }",
      );
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("call argument checking", () => {
    it("rejects a call with too few arguments", () => {
      const result = diagnose("fn f(a: i32, b: str) {} fn main() { f(); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "takes 2 argument(s), but 0 were supplied",
      );
    });

    it("rejects a call with too many arguments", () => {
      const result = diagnose("fn f(a: i32) {} fn main() { f(1, 2); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "takes 1 argument(s), but 2 were supplied",
      );
    });

    it("rejects an argument whose type does not match the parameter", () => {
      const result = diagnose("fn f(a: i32) {} fn main() { f(true); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "argument 1 to function `f` type mismatch: expected `i32`, found `bool`",
      );
    });

    it("reports each mismatched argument separately", () => {
      const result = diagnose(
        'fn f(a: i32, b: str) {} fn main() { f("x", 1); }',
      );
      expect(result.diagnostics).toHaveLength(2);
    });

    it("resolves a user-declared struct in a parameter type so a matching argument is accepted", () => {
      const result = diagnose(
        "struct P { x: i32 } fn f(p: P) {} fn main() { f(P { x: 1 }); }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a struct argument of the wrong struct type", () => {
      const result = diagnose(
        "struct P { x: i32 } struct Q { x: i32 } fn f(p: P) {} fn main() { f(Q { x: 1 }); }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("argument 1");
    });

    it("coerces an unsuffixed literal argument to the parameter type", () => {
      const result = diagnose("fn f(a: i8) {} fn main() { f(1 + 1); }");
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a string literal for a str parameter, like any other primitive", () => {
      const result = diagnose(
        'fn first(s: str) -> str { s } fn main() { print(first("hello")); }',
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a string literal for a shared-reference parameter, since a literal is not a reference", () => {
      const result = diagnose(
        'fn first(s: &str) -> &str { s } fn main() { print(first("hello")); }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `&str`, found `str`",
      );
    });

    it("rejects an integer literal for a shared-reference parameter, the same way", () => {
      const result = diagnose("fn f(r: &i32) {} fn main() { f(5); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `&i32`, found `i32`",
      );
    });

    it("still requires an explicit borrow when passing a binding to a reference parameter", () => {
      const result = diagnose(
        'fn f(s: &str) {} fn main() { let s = "a"; f(s); }',
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "expected `&str`, found `str`",
      );
    });

    it("accepts an explicit borrow of a binding for a reference parameter", () => {
      const result = diagnose(
        'fn f(s: &str) {} fn main() { let s = "a"; f(&s); }',
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("does not argument-check a builtin whose parameter list is a placeholder", () => {
      const result = diagnose("fn main() { print(42); }");
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("type scoping and declaration order", () => {
    it("resolves a struct field typed as an enum declared later in the file", () => {
      const result = diagnose("struct S { e: E } enum E { A } fn main() {}");
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a struct field typed as a struct declared later in the file", () => {
      const result = diagnose(
        "struct A { b: B } struct B { x: i32 } fn main() {}",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts two mutually recursive struct declarations", () => {
      const result = diagnose(
        "struct A { b: B } struct B { a: A } fn main() {}",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a forward type reference between two structs declared inside a block", () => {
      const result = diagnose(
        "fn main() { struct A { b: B } struct B { x: i32 } }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("lets a block-local struct shadow an outer one without disturbing the outer declaration", () => {
      const result = diagnose(
        "struct P { a: i32 } fn main() { { struct P { b: i32 } } let p: P = P { a: 1 }; }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("lets a block-local enum shadow an outer one without disturbing the outer declaration", () => {
      const result = diagnose(
        "enum E { A } fn main() { { enum E { B } } let e: E = E::A; }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("still rejects two structs with the same name in the same scope", () => {
      const result = diagnose(
        "struct P { a: i32 } struct P { b: i32 } fn main() {}",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "struct `P` is defined more than once",
      );
    });

    it("still rejects two enums with the same name in the same scope", () => {
      const result = diagnose("enum E { A } enum E { B } fn main() {}");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "enum `E` is defined more than once",
      );
    });
  });

  describe("enum declarations (semantically analyzed)", () => {
    it("analyzes a unit-variant enum declaration cleanly", () => {
      const result = diagnose("enum Message { Quit } fn main() {}");
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes a local (in-block) unit-variant enum declaration cleanly via analyzeStatement", () => {
      const result = diagnose("fn main() { enum Local { A, B } }");
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes a tuple-variant enum declaration cleanly", () => {
      const result = diagnose("enum Message { Move(i32, i32) } fn main() {}");
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes an enum mixing unit, tuple, and struct variants cleanly", () => {
      const result = diagnose(
        `enum Message { Quit, Move(i32, i32), Write { text: str } } fn main() {}`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects an unsupported field type inside a tuple variant", () => {
      const result = diagnose(
        "enum Message { Move(i32, UnknownType) } fn main() {}",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "cannot find type `UnknownType` in this scope",
      );
    });

    it("rejects an unsupported field type inside a struct variant", () => {
      const result = diagnose(
        "enum Message { Write { text: UnknownType } } fn main() {}",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "cannot find type `UnknownType` in this scope",
      );
    });

    it("accepts an enum type as a function parameter type", () => {
      const result = diagnose(`
        enum Message { Quit }
        fn take(m: Message) {}
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts an enum type as a function return type", () => {
      const result = diagnose(`
        enum Message { Quit }
        fn identity(m: Message) -> Message { m }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a function parameter typed as an enum declared later in the file", () => {
      const result = diagnose(`
        fn take(m: Message) {}
        enum Message { Quit }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects an enum with two variants sharing the same name", () => {
      const result = diagnose("enum Message { Quit, Quit } fn main() {}");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "variant `Quit` is defined more than once",
      );
    });
  });

  describe("enum variant construction (semantically analyzed)", () => {
    it("accepts a unit variant assigned to a let bound to its own enum type", () => {
      const result = diagnose(`
        enum Message { Quit }
        fn main() { let m: Message = Message::Quit; }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a unit variant construction to its enum's real type, not an ambiguous placeholder", () => {
      const result = diagnose(`
        enum Message { Quit }
        fn main() { let m: i32 = Message::Quit; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "type mismatch: explicit annotation does not match initializer type",
      );
    });

    it("rejects passing arguments to a unit variant", () => {
      const result = diagnose(`
        enum Message { Quit, Move(i32, i32) }
        fn main() { let m = Message::Quit(1); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "variant `Quit` takes no arguments, but 1 was supplied",
      );
    });

    it("accepts a tuple variant called with the correct arity and types", () => {
      const result = diagnose(`
        enum Message { Move(i32, i32) }
        fn main() { let m: Message = Message::Move(1, 2); }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a tuple variant called with too few arguments", () => {
      const result = diagnose(`
        enum Message { Move(i32, i32) }
        fn main() { let m = Message::Move(1); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "variant `Move` takes 2 argument(s), but 1 was supplied",
      );
    });

    it("rejects a tuple variant called with a mismatched argument type", () => {
      const result = diagnose(`
        enum Message { Move(i32, i32) }
        fn main() { let m = Message::Move(1, true); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "argument 2 to variant `Move` type mismatch: expected `i32`, found `bool`",
      );
    });

    it("rejects calling a struct variant with parens instead of braces", () => {
      const result = diagnose(`
        enum Message { Write { text: str } }
        fn main() { let m = Message::Write(1); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "variant `Write` has named fields; use `Write { ... }`",
      );
    });

    it("accepts a struct variant constructed with braces and the correct fields", () => {
      const result = diagnose(`
        enum Message { Write { text: str } }
        fn main() { let m: Message = Message::Write { text: "hi" }; }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a struct variant construction to its enum's real type, not an ambiguous placeholder", () => {
      const result = diagnose(`
        enum Message { Write { text: str } }
        fn main() { let m: i32 = Message::Write { text: "hi" }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "type mismatch: explicit annotation does not match initializer type",
      );
    });

    it("rejects a struct variant construction missing a required field", () => {
      const result = diagnose(`
        enum Message { Write { text: str, urgent: bool } }
        fn main() { let m = Message::Write { text: "hi" }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "missing required field `urgent` in struct literal of type `Write`",
      );
    });

    it("rejects a struct variant construction with an unknown field", () => {
      const result = diagnose(`
        enum Message { Write { text: str } }
        fn main() { let m = Message::Write { text: "hi", bogus: 1 }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "unknown field `bogus` for struct `Write`",
      );
    });

    it("rejects a bare unit-variant-shaped path naming an enum that doesn't exist", () => {
      const result = diagnose(`fn main() { let m = NotAnEnum::Variant; }`);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "cannot find enum `NotAnEnum` in this scope",
      );
    });

    it("rejects a call-shaped construction naming an enum that doesn't exist", () => {
      const result = diagnose(`fn main() { let m = NotAnEnum::Variant(1); }`);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "cannot find enum `NotAnEnum` in this scope",
      );
    });

    it("rejects a struct-literal-shaped construction naming an enum that doesn't exist", () => {
      const result = diagnose(
        `fn main() { let m = NotAnEnum::Variant { a: 1 }; }`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "cannot find enum `NotAnEnum` in this scope",
      );
    });
  });

  describe("match expressions (semantically analyzed)", () => {
    it("analyzes a match with a single plain-binding arm cleanly", () => {
      const result = diagnose("fn main() { match 1 { x => x }; }");
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a zero-arm match as non-exhaustive", () => {
      const result = diagnose("fn main() { match 1 {}; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "non-exhaustive patterns",
      );
    });

    it("analyzes a match used as an if-condition cleanly, since its own type comes from the arm bodies", () => {
      const result = diagnose("fn main() { if match 1 { x => true } { } }");
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes a match with a single wildcard arm cleanly as a function's return value", () => {
      const result = diagnose("fn f(x: i32) -> i32 { match x { _ => 0 } }");
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes a match used as a let initializer cleanly", () => {
      const result = diagnose(
        "fn f(x: i32) -> i32 { let y = match x { _ => 1 }; y }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a match whose only arm is a bare literal pattern as non-exhaustive", () => {
      const result = diagnose("fn f(x: i32) -> i32 { match x { 1 => 0 } }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "non-exhaustive patterns",
      );
    });
  });

  describe("match expressions over enum scrutinees (exhaustiveness)", () => {
    it("rejects a two-variant enum match covering only one variant, naming the missing one", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 { match m { Message::Quit => 0 } }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
      expect(result.diagnostics[0]?.message).toContain("Move");
    });

    it("rejects a three-variant enum match missing two variants, naming both", () => {
      const result = diagnose(`
        enum Message { Quit, Move, Stop }
        fn f(m: Message) -> i32 { match m { Message::Quit => 0 } }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("Move");
      expect(result.diagnostics[0]?.message).toContain("Stop");
    });

    it("analyzes a match covering both variants of a two-variant unit enum cleanly", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m { Message::Quit => 0, Message::Move => 1 }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a wildcard arm as satisfying enum exhaustiveness regardless of missing variants", () => {
      const result = diagnose(`
        enum Message { Quit, Move, Stop }
        fn f(m: Message) -> i32 {
          match m { Message::Quit => 0, _ => 1 }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("binds a tuple variant's fields with their declared types, usable in the arm body", () => {
      const result = diagnose(`
        enum Message { Quit, Move(i32, i32) }
        fn f(m: Message) -> i32 {
          match m { Message::Quit => 0, Message::Move(a, b) => a + b }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("shorthand-binds a struct variant's field with its declared type, usable in the arm body", () => {
      const result = diagnose(`
        enum Message { Quit, Write { text: str } }
        fn f(m: Message) -> str {
          match m { Message::Quit => "", Message::Write { text } => text }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes an exhaustive match mixing unit, tuple, and struct variants cleanly", () => {
      const result = diagnose(`
        enum Message { Quit, Move(i32, i32), Write { text: str } }
        fn f(m: Message) -> i32 {
          match m {
            Message::Quit => 0,
            Message::Move(a, b) => a + b,
            Message::Write { text } => 0,
          }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not let an unrelated sibling enum's variants satisfy the scrutinee enum's own exhaustiveness", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        enum Other { A, B }
        fn f(m: Message) -> i32 { match m { Message::Quit => 0 } }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("Move");
    });
  });

  describe("match expressions over plain (non-enum) struct scrutinees", () => {
    it("analyzes a struct pattern over a plain struct scrutinee cleanly, binding fields with their declared types", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { match p { Point { x, y } => x + y } }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes a tuple-struct pattern over a plain tuple-struct scrutinee cleanly", () => {
      const result = diagnose(`
        struct Pair(i32, i32);
        fn f(p: Pair) -> i32 { match p { Pair(a, b) => a + b } }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("still resolves a struct pattern's fields when a trailing `..` omits the rest", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { match p { Point { x, .. } => x } }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects an unknown field name in a plain struct pattern, naming the struct", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { match p { Point { x, z } => x } }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "no field `z` on struct `Point`",
      );
    });

    it("rejects a tuple-struct pattern whose element count does not match the struct's own field count", () => {
      const result = diagnose(`
        struct Pair(i32, i32);
        fn f(p: Pair) -> i32 { match p { Pair(a) => a } }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "struct `Pair` has 2 field(s), but the pattern has 1",
      );
    });

    it("resolves a nested struct pattern reached through an outer struct field", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        struct Line { start: Point, end: Point }
        fn f(l: Line) -> i32 {
          match l { Line { start: Point { x, y }, end } => x + y }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a tuple-struct pattern used against a struct declared with named fields", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) { match p { Point(a, b) => a }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "struct `Point` is not a tuple struct",
      );
    });

    it("rejects a struct pattern used against a struct declared with tuple fields", () => {
      const result = diagnose(`
        struct Pair(i32, i32);
        fn f(p: Pair) { match p { Pair { a } => a }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "struct `Pair` does not have named fields",
      );
    });

    it("rejects a struct pattern naming a different struct than the scrutinee's own type", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        struct Other { x: i32, y: i32 }
        fn f(p: Point) { match p { Other { x, y } => x + y }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "expected struct `Point`, found `Other`",
      );
    });

    it("rejects a tuple-struct pattern naming a different struct than the scrutinee's own type", () => {
      const result = diagnose(`
        struct Pair(i32, i32);
        struct Duo(i32, i32);
        fn f(p: Pair) { match p { Duo(a, b) => a }; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "expected struct `Pair`, found `Duo`",
      );
    });
  });

  describe("match expressions: struct/enum-variant pattern irrefutability", () => {
    it("treats a single struct-pattern arm over a plain struct as exhaustive with no other arms", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { match p { Point { x, y } => x + y } }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("treats a single tuple-struct-pattern arm over a single-variant enum as exhaustive with no other arms", () => {
      const result = diagnose(`
        enum Wrapper { Only(i32) }
        fn f(w: Wrapper) -> i32 { match w { Wrapper::Only(x) => x } }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("still rejects a single tuple-struct-pattern arm over a multi-variant enum as non-exhaustive", () => {
      const result = diagnose(`
        enum Wrapper { Only(i32), Empty }
        fn f(w: Wrapper) -> i32 { match w { Wrapper::Only(x) => x } }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
      expect(result.diagnostics[0]?.message).toContain("Empty");
    });
  });

  describe("match expressions over bool scrutinees (exhaustiveness)", () => {
    it("rejects a bool match covering only true", () => {
      const result = diagnose("fn f(x: bool) -> i32 { match x { true => 0 } }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
      expect(result.diagnostics[0]?.message).toContain("false");
    });

    it("rejects a bool match covering only false", () => {
      const result = diagnose(
        "fn f(x: bool) -> i32 { match x { false => 0 } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
      expect(result.diagnostics[0]?.message).toContain("true");
    });

    it("analyzes a bool match covering both true and false cleanly", () => {
      const result = diagnose(
        "fn f(x: bool) -> i32 { match x { true => 0, false => 1 } }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("analyzes a bool match with one literal arm plus a wildcard cleanly", () => {
      const result = diagnose(
        "fn f(x: bool) -> i32 { match x { true => 0, _ => 1 } }",
      );
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("match expressions: unreachable-arm detection", () => {
    it("rejects a duplicate bool literal arm as unreachable", () => {
      const result = diagnose(
        "fn f(x: bool) -> i32 { match x { true => 0, true => 1, false => 2 } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unreachable pattern");
    });

    it("rejects a duplicate enum-variant arm as unreachable", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m {
            Message::Quit => 0,
            Message::Quit => 1,
            Message::Move => 2,
          }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unreachable pattern");
    });

    it("rejects an arm following an unconditional wildcard as unreachable", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m { _ => 0, Message::Quit => 1 }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unreachable pattern");
    });

    it("rejects an arm fully subsumed by an earlier or-pattern as unreachable", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m {
            Message::Quit | Message::Move => 0,
            Message::Quit => 1,
          }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unreachable pattern");
    });

    it("treats an or-pattern with a wildcard alternative as irrefutable, satisfying exhaustiveness alone", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m { Message::Quit | _ => 0 }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects an or-pattern alternative following an already-irrefutable earlier one as unreachable", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m { _ | Message::Quit => 0 }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unreachable pattern");
    });

    it("rejects an arm following an irrefutable or-pattern as unreachable", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m { Message::Quit | _ => 0, Message::Move => 1 }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unreachable pattern");
    });

    it("points each unreachable-arm diagnostic at its own arm, not always the last one", () => {
      const source = `
        enum Message { A, B, C }
        fn f(m: Message) -> i32 {
          match m { _ => 0, Message::A => 1, Message::B => 2 }
        }
      `;
      const { result } = analyzeWithTokens(source);
      expect(result.diagnostics).toHaveLength(2);
      const [first, second] = result.diagnostics;
      assert(first !== undefined, "Expected first diagnostic");
      assert(second !== undefined, "Expected second diagnostic");
      assert(isSome(first.span), "Expected first span");
      assert(isSome(second.span), "Expected second span");
      expect(first.span.value.start).toBe(source.indexOf("Message::A"));
      expect(second.span.value.start).toBe(source.indexOf("Message::B"));
    });
  });

  describe("match expressions: guards and exhaustiveness", () => {
    it("does not let a guarded arm covering the only gap satisfy exhaustiveness", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message, cond: bool) -> i32 {
          match m {
            Message::Quit => 0,
            Message::Move if cond => 1,
          }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
      expect(result.diagnostics[0]?.message).toContain("Move");
    });

    it("does not let a guarded arm make a later identical unguarded arm unreachable", () => {
      const result = diagnose(`
        enum Message { Quit, Move }
        fn f(m: Message, cond: bool) -> i32 {
          match m {
            Message::Quit if cond => 0,
            Message::Quit => 1,
            Message::Move => 2,
          }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a bare wildcard as unreachable when only a guarded wildcard precedes it", () => {
      const result = diagnose(`
        fn f(x: i32, cond: bool) -> i32 {
          match x { _ if cond => 0, _ => 1 }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("match expressions over a #[non_exhaustive] enum", () => {
    it("analyzes an exhaustive match with no wildcard cleanly within the enum's own defining scope", () => {
      // TODO(Hedge-222): cross-package enforcement (a foreign match
      // needing `_`) has no referent yet - there's no module/package
      // system (ROADMAP Slice 7). Every match the compiler can analyze
      // today is "within the defining package", so #[non_exhaustive] is a
      // real no-op pre-Slice-7, not an oversight.
      const result = diagnose(`
        #[non_exhaustive]
        enum Message { Quit, Move }
        fn f(m: Message) -> i32 {
          match m { Message::Quit => 0, Message::Move => 1 }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("match expressions over other scrutinee types (general coverage rule)", () => {
    it("rejects an i32 match covering only literal arms, with no wildcard or binding", () => {
      const result = diagnose(
        "fn f(x: i32) -> i32 { match x { 1 => 0, 2 => 1 } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
    });

    it("accepts an i32 match with a final bare-binding arm (not `_`) as exhaustive", () => {
      const result = diagnose(
        "fn f(x: i32) -> i32 { match x { 1 => 0, n => n } }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a str match covering only literal arms, with no wildcard or binding", () => {
      const result = diagnose(
        `fn f(x: str) -> i32 { match x { "a" => 0, "b" => 1 } }`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
    });

    it("rejects a char match covering only literal arms, with no wildcard or binding", () => {
      const result = diagnose(
        "fn f(x: char) -> i32 { match x { 'a' => 0, 'b' => 1 } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("non-exhaustive");
    });
  });

  describe("match expressions: cascade hygiene", () => {
    it("does not cascade a non-exhaustive diagnostic when the scrutinee name is unresolved", () => {
      const result = diagnose(
        "fn f() -> i32 { match undefined_var { 1 => 0 } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("Cannot find name");
    });

    it("does not cascade a non-exhaustive diagnostic when the scrutinee's own type is already erroneous", () => {
      const result = diagnose(
        "fn f(x: i32) -> i32 { match x.nonexistent { 1 => 0 } }",
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "field access on non-struct type",
      );
    });
  });

  describe("while let (parsed, not yet semantically analyzed)", () => {
    it("rejects a while-let with a clean 'not yet supported' diagnostic", () => {
      const result = diagnose("fn main() { while let y = opt { } }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "not yet supported by semantic analysis",
      );
    });
  });

  describe("if let (semantically analyzed)", () => {
    it("analyzes an if-let with a valid enum scrutinee and pattern cleanly", () => {
      const result = diagnose(`
        enum Option { Some(i32), None }
        fn main() {
          let opt = Option::Some(1);
          if let Option::Some(x) = opt {
            print(x);
          }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a refutable multi-variant enum pattern, unlike let position", () => {
      const result = diagnose(`
        enum Message { Quit, Move(i32) }
        fn main() {
          let m = Message::Quit;
          if let Message::Move(x) = m {
            print(x);
          }
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a reference to the if-let pattern's bound name from the else branch", () => {
      const result = diagnose(`
        enum Option { Some(i32), None }
        fn main() {
          let opt = Option::Some(1);
          if let Option::Some(x) = opt {
          } else {
            print(x);
          }
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        'Cannot find name "x" in this scope.',
      );
    });

    it("rejects a reference to the if-let pattern's bound name after the whole if", () => {
      const result = diagnose(`
        enum Option { Some(i32), None }
        fn main() {
          let opt = Option::Some(1);
          if let Option::Some(x) = opt {
          }
          print(x);
        }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        'Cannot find name "x" in this scope.',
      );
    });

    it("reports exactly one diagnostic for an undefined scrutinee, no cascade", () => {
      const result = diagnose("fn main() { if let y = opt { } }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        'Cannot find name "opt" in this scope.',
      );
    });
  });

  describe("Slice 3 pattern kinds in let position (parser accepts, semantic analysis rejects)", () => {
    it("rejects a bare literal pattern in a let statement as refutable", () => {
      const result = diagnose("fn main() { let 1 = 5; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toBe(
        "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match",
      );
    });

    it("rejects a range pattern in a let statement as refutable", () => {
      const result = diagnose("fn main() { let 1..=5 = 3; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toBe(
        "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match",
      );
    });

    it("rejects an or-pattern of two refutable literals in a let statement as refutable", () => {
      const result = diagnose("fn main() { let 1 | 2 = 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toBe(
        "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match",
      );
    });

    it("rejects a tuple pattern in a let statement with a clear diagnostic", () => {
      const result = diagnose("fn main() { let (a, b) = (1, 2); }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });

    it("rejects a struct pattern in a let statement with a clear diagnostic", () => {
      const result = diagnose("fn main() { let Point { x, y } = 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });

    it("rejects a tuple-struct pattern in a let statement with a clear diagnostic", () => {
      const result = diagnose("fn main() { let Some(x) = 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });

    it("rejects a bare path pattern in a let statement with a clear diagnostic", () => {
      const result = diagnose("fn main() { let Message::Quit = 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });

    it("rejects a slice pattern in a let statement with a clear diagnostic", () => {
      const result = diagnose("fn main() { let [a, ..tail] = 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });

    it("rejects a destructuring pattern in function-parameter position too, not just let", () => {
      const result = diagnose("fn f(Point { x, y }: i32) {}");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });

    it("rejects an @-binding with a subpattern in a let statement instead of silently dropping the constraint", () => {
      const result = diagnose("fn main() { let n @ 1..=5 = 3; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "this pattern kind is not yet supported",
      );
    });
  });

  describe("irrefutable destructuring in let/parameter position", () => {
    it("destructures a struct pattern in a let statement, binding every field", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { let Point { x, y } = p; x + y }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("destructures a struct pattern in function-parameter position, binding every field", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(Point { x, y }: Point) -> i32 { x + y }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("destructures a tuple-struct pattern in a let statement", () => {
      const result = diagnose(`
        struct Pair(i32, i32);
        fn f(pair: Pair) -> i32 { let Pair(a, b) = pair; a + b }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("destructures a nested struct pattern in a let statement, binding names at every depth", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        struct Line { start: Point, end: Point }
        fn f(l: Line) -> i32 {
          let Line { start: Point { x, y }, end } = l;
          x + y
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("binds only the named fields when a let-position struct pattern has a trailing `..`", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { let Point { x, .. } = p; x + y }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("y");
    });

    it("destructures a single-variant enum's tuple pattern in a let statement", () => {
      const result = diagnose(`
        enum Wrapper { Only(i32) }
        fn f(w: Wrapper) -> i32 { let Wrapper::Only(x) = w; x }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("honors a per-field `mut` sigil in a let-position struct pattern, allowing that field alone to be reassigned", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { let Point { x: mut x, y } = p; x = 5; x + y }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("still rejects reassigning a let-position struct pattern field with no `mut` sigil", () => {
      const result = diagnose(`
        struct Point { x: i32, y: i32 }
        fn f(p: Point) -> i32 { let Point { x, y } = p; y = 5; x + y }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "cannot assign to immutable binding",
      );
    });

    it("rejects a refutable multi-variant enum-variant pattern in a let statement, naming `if let`", () => {
      const result = diagnose(`
        enum MyOption { MySome(i32), MyNone }
        fn f(opt: MyOption) { let MyOption::MySome(v) = opt; }
      `);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toBe(
        "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match",
      );
    });
  });

  describe("top-level item restriction", () => {
    it("bare expression at top level is an error", () => {
      const result = diagnose("x + y;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "only function, struct, enum, const, and static declarations are allowed at the top level",
      );
    });

    it("let statement at top level is an error", () => {
      const result = diagnose("let x = 1;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function, struct, enum, const, and static declarations are allowed at the top level",
      );
    });

    it("block at top level is an error", () => {
      const result = diagnose("{ 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function, struct, enum, const, and static declarations are allowed at the top level",
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

    it("names enum among the allowed top-level declarations in the restriction message", () => {
      const result = diagnose("x + y;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("enum");
    });

    it("const declaration at top level is accepted", () => {
      const result = diagnose("const N: usize = 3;");
      expect(result.diagnostics).toEqual([]);
    });

    it("static declaration at top level is accepted", () => {
      const result = diagnose("static COUNT: i32 = 0;");
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("const declarations", () => {
    it.each([
      "const N: i32 = 3;",
      "const N: i32 = -3;",
      "const N: bool = true;",
      "const N: char = 'x';",
      "const N: f64 = 1.5;",
      'const N: str = "hello";',
    ])("folds a %s literal initializer with no diagnostics", (source) => {
      const result = diagnose(source);
      expect(result.diagnostics).toEqual([]);
    });

    it("folds the boundary values i32::MIN and i32::MAX", () => {
      const result = diagnose(
        "const MIN: i32 = -2147483648; const MAX: i32 = 2147483647;",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("folds zero", () => {
      const result = diagnose("const ZERO: i32 = 0;");
      expect(result.diagnostics).toEqual([]);
    });

    it("inlines a const's folded value at its reference site", () => {
      const { result } = analyzeWithTokens(
        "const MAX: i32 = 100; fn f() -> i32 { MAX }",
      );
      expect(result.diagnostics).toEqual([]);
      const fn = result.program.items.find((item) => item.kind === "Function");
      assert(fn?.kind === "Function", "expected a Function item");
      const trailing = fn.body.trailingExpression;
      assert(
        isSome(trailing),
        "expected the function body to have a trailing expression",
      );
      expect(trailing.value).toMatchObject({
        kind: "IntLiteral",
        value: "100",
      });
    });

    describe("operator coverage", () => {
      it.each([
        ["const N: i32 = 1 + 2;"],
        ["const N: i32 = 5 - 2;"],
        ["const N: i32 = 3 * 4;"],
        ["const N: i32 = 7 / 2;"],
        ["const N: i32 = 7 % 2;"],
        ["const N: i32 = 1 & 3;"],
        ["const N: i32 = 1 | 2;"],
        ["const N: i32 = 1 ^ 3;"],
        ["const N: i32 = 1 << 2;"],
        ["const N: i32 = 8 >> 2;"],
        ["const N: bool = 1 < 2;"],
        ["const N: bool = 2 > 1;"],
        ["const N: bool = 1 <= 1;"],
        ["const N: bool = 1 >= 1;"],
        ["const N: bool = 1 == 1;"],
        ["const N: bool = 1 != 2;"],
        ["const N: bool = true && false;"],
        ["const N: bool = true || false;"],
        ["const N: i32 = -5;"],
        ["const N: bool = !true;"],
        ['const N: bool = "a" == "a";'],
        ['const N: bool = "a" != "b";'],
        ['const N: bool = "a" < "b";'],
        ["const N: f64 = 1.5 + 2.5;"],
        ["const N: f64 = 5.5 - 2.5;"],
        ["const N: f64 = 2.0 * 3.5;"],
        ["const N: f64 = 7.0 % 2.0;"],
        ["const N: bool = 1.5 < 2.5;"],
        ["const N: bool = 2.5 > 1.5;"],
        ["const N: bool = 1.5 == 1.5;"],
        ["const N: bool = 'a' < 'b';"],
        ["const N: bool = 'a' == 'a';"],
        ["const N: bool = 'b' != 'a';"],
      ])("folds %s with no diagnostics", (source) => {
        const result = diagnose(source);
        expect(result.diagnostics).toEqual([]);
      });
    });

    describe("settled-semantics interactions", () => {
      it("wraps on integer overflow (two's complement), matching runtime i32 arithmetic", () => {
        const { result } = analyzeWithTokens(
          "const N: i32 = 2147483647 + 1; fn f() -> i32 { N }",
        );
        expect(result.diagnostics).toEqual([]);
        const fn = result.program.items.find(
          (item) => item.kind === "Function",
        );
        assert(fn !== undefined, "expected a Function item");
        const trailing = fn.body.trailingExpression;
        assert(isSome(trailing), "expected a trailing expression");
        expect(trailing.value).toMatchObject({
          kind: "UnaryExpression",
          operator: "Neg",
          operand: { kind: "IntLiteral", value: "2147483648" },
        });
      });

      it("truncates negative division toward zero", () => {
        const { result } = analyzeWithTokens(
          "const N: i32 = -7 / 2; fn f() -> i32 { N }",
        );
        expect(result.diagnostics).toEqual([]);
        const fn = result.program.items.find(
          (item) => item.kind === "Function",
        );
        assert(fn?.kind === "Function", "expected a Function item");
        const trailing = fn.body.trailingExpression;
        assert(isSome(trailing), "expected a trailing expression");
        expect(trailing.value).toMatchObject({
          kind: "UnaryExpression",
          operator: "Neg",
          operand: { kind: "IntLiteral", value: "3" },
        });
      });

      it("folds float division by zero to Infinity with no zero-guard diagnostic", () => {
        const { result } = analyzeWithTokens(
          "const N: f64 = 1.0 / 0.0; fn f() -> f64 { N }",
        );
        expect(result.diagnostics).toEqual([]);
        const fn = result.program.items.find(
          (item) => item.kind === "Function",
        );
        assert(fn?.kind === "Function", "expected a Function item");
        const trailing = fn.body.trailingExpression;
        assert(isSome(trailing), "expected a trailing expression");
        expect(trailing.value).toMatchObject({
          kind: "FloatLiteral",
          value: "Infinity",
        });
      });
    });

    describe("chaining and forward references", () => {
      it("resolves a const initializer that references another const", () => {
        const result = diagnose("const A: i32 = 1; const B: i32 = A + 1;");
        expect(result.diagnostics).toEqual([]);
      });

      it("resolves a const initializer that forward-references a const declared later in the file", () => {
        const result = diagnose("const B: i32 = A + 1; const A: i32 = 1;");
        expect(result.diagnostics).toEqual([]);
      });
    });

    describe("malformed and adversarial initializers", () => {
      it("rejects a self-referencing const as a cycle, not a stack overflow", () => {
        const result = diagnose("const A: i32 = A;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("itself");
      });

      it("rejects a mutually cyclic pair of consts with exactly one diagnostic", () => {
        const result = diagnose("const A: i32 = B; const B: i32 = A;");
        expect(result.diagnostics).toHaveLength(1);
      });

      it("rejects a call to a non-const function as a non-const-foldable initializer", () => {
        const result = diagnose("fn one() -> i32 { 1 } const N: i32 = one();");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain(
          "compile-time constant expression",
        );
      });

      it("rejects a reference to a static in a const initializer as non-const-foldable", () => {
        const result = diagnose("static COUNT: i32 = 0; const N: i32 = COUNT;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain(
          "compile-time constant expression",
        );
      });

      it("rejects a reference to an undeclared name in a const initializer", () => {
        const result = diagnose("const N: i32 = MISSING;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("MISSING");
      });

      it("rejects string concatenation as non-const-foldable, since it is not primitive arithmetic", () => {
        const result = diagnose('const N: str = "a" + "b";');
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain(
          "compile-time constant expression",
        );
      });

      it("rejects a const whose folded value doesn't match its declared type", () => {
        const result = diagnose("const N: bool = 1 + 2;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("declared type");
      });

      it("rejects division by zero in a const initializer as a diagnostic, not a crash", () => {
        const result = diagnose("const N: i32 = 1 / 0;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("divide by zero");
      });

      it("rejects a negative shift amount in a const initializer as a diagnostic, not a crash", () => {
        const result = diagnose("const N: i32 = 1 << -1;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("shift");
      });

      it("rejects an excessively large shift amount in a const initializer as a diagnostic, not a crash", () => {
        // A raw BigInt `<<` with a huge positive shift tries to allocate an
        // astronomically large value before any wrapping ever gets a chance
        // to run - this must be rejected before the shift is attempted, not
        // after, or it throws instead of diagnosing.
        const result = diagnose("const N: i32 = 1 << 100000000000;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("shift");
      });

      it("rejects an out-of-range shift amount via >> the same way as <<", () => {
        const result = diagnose("const N: i32 = 1 >> 100000000000;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("shift");
      });

      it("accepts a shift amount at the boundary of a 64-bit width", () => {
        const result = diagnose("const N: i64 = 1 << 63;");
        expect(result.diagnostics).toEqual([]);
      });

      it("rejects a shift amount within [0, 64) but past a narrower declared width's own bit count", () => {
        // Regression: the shift-amount bound must track the const's actual
        // declared width, not a flat 64 - a runtime (non-const) i32 shift
        // lowers to JS's native `<<`, which masks the shift count to 5 bits
        // (mod 32). A const fold using full-precision BigInt shift + 32-bit
        // wrap would otherwise silently disagree with that: `1 << 40` folds
        // to 0 at compile time but runs to 256, a real determinism break.
        const result = diagnose("const N: i32 = 1 << 40;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("shift");
      });

      it("does not cascade past the one diagnostic for a broken const referenced elsewhere", () => {
        const result = diagnose(
          "const A: i32 = MISSING; const B: i32 = A + 1; fn f() -> i32 { A + B }",
        );
        expect(result.diagnostics).toHaveLength(1);
      });

      it("rejects a const whose name collides with an existing top-level function", () => {
        // A reference to the shared name always tries the const first (see
        // `analyzeExpression`'s "PathExpression" case), so `X()` against a
        // same-named function would otherwise try to call the const's
        // inlined literal value instead of the function - a real miscompile,
        // not just shadowing.
        const result = diagnose("const X: i32 = 100; fn X() -> i32 { 1 }");
        expect(result.diagnostics).toHaveLength(1);
        assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
        expect(result.diagnostics[0].message).toContain("collides");
      });

      it("rejects a const/static name collision with exactly one correctly-labeled diagnostic, const declared first", () => {
        const result = diagnose("const X: i32 = 1; static X: i32 = 0;");
        expect(result.diagnostics).toHaveLength(1);
        assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
        expect(result.diagnostics[0].message).toContain("collides");
        expect(result.diagnostics[0].message).not.toContain("function");
      });

      it("rejects a const/static name collision with exactly one correctly-labeled diagnostic, static declared first", () => {
        // Regression: statics get `bind()`-registered into scope as
        // `registerConstsAndStatics`'s loop runs, so a naive same-scope
        // check against that scope map is order-dependent - this ordering
        // used to produce a misleading "collides with an existing function
        // name" diagnostic instead of correctly naming the static.
        const result = diagnose("static X: i32 = 0; const X: i32 = 1;");
        expect(result.diagnostics).toHaveLength(1);
        assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
        expect(result.diagnostics[0].message).toContain("collides");
        expect(result.diagnostics[0].message).not.toContain("function");
      });
    });
  });

  describe("static declarations", () => {
    it("accepts a static with a literal initializer, with no diagnostics", () => {
      const result = diagnose("static COUNT: i32 = 0;");
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a static whose initializer calls an ordinary (non-const) function", () => {
      const result = diagnose(
        "fn make() -> i32 { 42 } static X: i32 = make();",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a reference to an undeclared name in a static initializer", () => {
      const result = diagnose("static X: i32 = MISSING;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("MISSING");
    });

    it("rejects a static whose initializer doesn't match its declared type", () => {
      const result = diagnose("static X: bool = 1;");
      expect(result.diagnostics).toHaveLength(1);
    });

    it("rejects pub on a static declaration", () => {
      const result = diagnose("pub static X: i32 = 0;");
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected diagnostic");
      expect(result.diagnostics[0].message).toContain("pub");
    });

    it("rejects a static whose name collides with an existing top-level function", () => {
      const result = diagnose("fn foo() {} static foo: i32 = 0;");
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
      expect(result.diagnostics[0].message).toContain("collides");
    });

    it("a reference to a static lowers to a zero-argument call to its own name", () => {
      const { result } = analyzeWithTokens(
        "static COUNT: i32 = 0; fn f() -> i32 { COUNT }",
      );
      expect(result.diagnostics).toEqual([]);
      const fn = result.program.items.find((item) => item.kind === "Function");
      assert(fn !== undefined, "expected a Function item");
      const trailing = fn.body.trailingExpression;
      assert(isSome(trailing), "expected a trailing expression");
      expect(trailing.value).toMatchObject({
        kind: "CallExpression",
        callee: { kind: "PathExpression" },
        arguments: [],
      });
    });
  });

  describe("function-local const and static", () => {
    it("accepts a const declared inside a function body, with no diagnostics", () => {
      const result = diagnose("fn f() -> i32 { const N: i32 = 3; N }");
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a function-local const that forward-references another local const", () => {
      const result = diagnose(
        "fn f() -> i32 { const B: i32 = A + 1; const A: i32 = 1; B }",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("lets a block-local const shadow an outer const of the same name", () => {
      const { result } = analyzeWithTokens(
        "const N: i32 = 1; fn f() -> i32 { const N: i32 = 2; N }",
      );
      expect(result.diagnostics).toEqual([]);
      const fn = result.program.items.find((item) => item.kind === "Function");
      assert(fn !== undefined, "expected a Function item");
      const trailing = fn.body.trailingExpression;
      assert(isSome(trailing), "expected a trailing expression");
      expect(trailing.value).toMatchObject({ kind: "IntLiteral", value: "2" });
    });

    it("rejects redefining a const twice in the same block", () => {
      const result = diagnose(
        "fn f() -> i32 { const N: i32 = 1; const N: i32 = 2; N }",
      );
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected diagnostic");
      expect(result.diagnostics[0].message).toContain("defined more than once");
    });

    it("rejects a static declared inside a function body", () => {
      const result = parse(tokenize("fn f() { static X: i32 = 0; }").tokens);
      expect(result.program).toEqual(none());
      assert(result.diagnostics[0] !== undefined, "expected a diagnostic");
      expect(result.diagnostics[0].message).toContain("Static");
    });

    it("lets a function parameter shadow an outer const of the same name", () => {
      const { result } = analyzeWithTokens(
        "const X: i32 = 100; fn f(X: i32) -> i32 { X }",
      );
      expect(result.diagnostics).toEqual([]);
      const fn = result.program.items.find((item) => item.kind === "Function");
      assert(fn !== undefined, "expected a Function item");
      const trailing = fn.body.trailingExpression;
      assert(isSome(trailing), "expected a trailing expression");
      // The parameter, not the const's inlined value - a genuine
      // PathExpression reading the parameter, not an IntLiteral.
      expect(trailing.value).toMatchObject({ kind: "PathExpression" });
    });

    it("lets a local let binding shadow an outer const of the same name", () => {
      const { result } = analyzeWithTokens(
        "const X: i32 = 100; fn f() -> i32 { let X = 7; X }",
      );
      expect(result.diagnostics).toEqual([]);
      const fn = result.program.items.find((item) => item.kind === "Function");
      assert(fn !== undefined, "expected a Function item");
      const trailing = fn.body.trailingExpression;
      assert(isSome(trailing), "expected a trailing expression");
      expect(trailing.value).toMatchObject({ kind: "PathExpression" });
    });

    it("rejects a const initializer referencing a name shadowed by an outer function's parameter", () => {
      const result = diagnose(
        "const X: i32 = 100; fn f(X: i32) -> i32 { const Y: i32 = X + 1; Y }",
      );
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(result.diagnostics[0].message).toContain(
        "compile-time constant expression",
      );
    });

    it("resolves a const array length correctly even from inside a function whose parameter shadows the const's name elsewhere", () => {
      // Regression check for the scope-stack alignment `analyzeFunctionDecl`
      // and `analyzeBlock` must share: a same-named parameter in a sibling
      // function must not desync const/static frame indices for this one.
      const result = diagnose(`
        const N: usize = 3;
        fn g(N: i32) -> i32 { N }
        fn f() {
          let arr: [i32; N] = [1, 2, 3];
          print(arr);
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("accepts &x as a shared borrow of a parameter, with no diagnostics", (): void => {
    const result = diagnose("fn f(x: i32) { &x; }");
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an unsupported param type naming an undeclared type", (): void => {
    const result = diagnose("fn f(x: UnknownType) {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toBe(
      "cannot find type `UnknownType` in this scope",
    );
  });

  it("rejects a qualified type in a param position as not yet supported", (): void => {
    const result = diagnose("fn f(x: i32::Foo) {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toBe(
      "qualified type paths are not supported yet",
    );
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
    expect(result.diagnostics[0]?.message).toBe(
      "cannot find type `unknownType` in this scope",
    );
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

    describe("literal coercion through a binary expression", () => {
      it("coerces both operands of an arithmetic expression to the annotated type", () => {
        const result = diagnose("fn main() { let v: i8 = 1 + 1; }");
        expect(result.diagnostics).toEqual([]);
      });

      it("coerces both operands to a bigint-backed annotated type", () => {
        const result = diagnose("fn main() { let v: i64 = 1 + 1; }");
        expect(result.diagnostics).toEqual([]);
      });

      it("coerces through a nested arithmetic expression", () => {
        const result = diagnose("fn main() { let v: i8 = (1 + 2) * 3; }");
        expect(result.diagnostics).toEqual([]);
      });

      it("coerces through a bitwise expression", () => {
        const result = diagnose("fn main() { let v: i8 = 1 & 2; }");
        expect(result.diagnostics).toEqual([]);
      });

      it("coerces a negated operand alongside a plain one", () => {
        const result = diagnose("fn main() { let v: i8 = -1 + 2; }");
        expect(result.diagnostics).toEqual([]);
      });

      it("range-checks each operand against the coerced type", () => {
        const result = diagnose("fn main() { let v: i8 = 200 + 1; }");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("out of range for i8");
      });

      it("does not coerce through a comparison operator, whose result is always bool", () => {
        const result = diagnose("fn main() { let v: i8 = 1 < 2; }");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("type mismatch");
      });

      it("still accepts a comparison expression bound to bool", () => {
        const result = diagnose("fn main() { let b: bool = 1 < 2; }");
        expect(result.diagnostics).toEqual([]);
      });
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

  describe("borrow outliving referent (HEDGE-LIFETIME-002)", () => {
    it("rejects a bare returned reference to a let-local declared in the function body", (): void => {
      const { diagnostics } = diagnose(
        "fn confusing(y: &i32) -> &i32 { let x = 5; &x }",
      );
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
      expect(diagnostics[0].message).toContain("x");
    });

    it("rejects a bare returned reference to a fresh borrow of a by-value parameter", (): void => {
      const { diagnostics } = diagnose("fn f(x: i32) -> &i32 { &x }");
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
    });

    it("rejects a struct literal field that borrows a let-local, when the struct instance is returned", (): void => {
      const { diagnostics } = diagnose(`
        struct Cursor<'a> { source: &'a str, pos: i32 }
        fn make() -> Cursor {
          let s = "hello";
          Cursor { source: &s, pos: 0 }
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
      expect(diagnostics[0].message).toContain("s");
    });

    it("accepts a bare parameter of reference type passed straight through, since no fresh borrow is taken", (): void => {
      const { diagnostics } = diagnose("fn first(s: &str) -> &str { s }");
      expect(diagnostics).toEqual([]);
    });

    it("accepts a reborrow through a dereference of a reference parameter", (): void => {
      const { diagnostics } = diagnose("fn peek(x: &i32) -> &i32 { &*x }");
      expect(diagnostics).toEqual([]);
    });

    it("rejects a dangling reference returned from one branch of an if/else trailing expression", (): void => {
      const { diagnostics } = diagnose(`
        fn confusing(cond: bool, y: &i32) -> &i32 {
          if cond {
            let x = 5;
            &x
          } else {
            y
          }
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
      expect(diagnostics[0].message).toContain("x");
    });

    it("rejects a dangling reference in the final else of an if/else-if/else chain", (): void => {
      const { diagnostics } = diagnose(`
        fn confusing(a: bool, b: bool, y: &i32) -> &i32 {
          if a {
            y
          } else if b {
            y
          } else {
            let x = 5;
            &x
          }
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
      expect(diagnostics[0].message).toContain("x");
    });

    it("rejects a dangling reference returned through a nested block's own trailing expression", (): void => {
      const { diagnostics } = diagnose(`
        fn confusing() -> &i32 {
          {
            let x = 5;
            &x
          }
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
      expect(diagnostics[0].message).toContain("x");
    });

    it("accepts an if/else trailing expression when both branches pass a reference parameter through cleanly", (): void => {
      const { diagnostics } = diagnose(`
        fn safe(cond: bool, y: &i32) -> &i32 {
          if cond {
            y
          } else {
            y
          }
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("does not cascade into a second diagnostic when the borrowed name is itself unresolved and the reconciled return type happens to match (no independent type-mismatch diagnostic to mask the check)", (): void => {
      const { diagnostics } = diagnose("fn f() -> &() { &missing_name }");
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected diagnostics");
      expect(diagnostics[0].message).toContain("missing_name");
      expect(diagnostics[0].code).toBe("HEDGE-NAME-001");
    });

    it("does not cascade into a third diagnostic when a struct field borrows an unresolved name, on top of the name-resolution and field-type-mismatch diagnostics", (): void => {
      const { diagnostics } = diagnose(`
        struct S { f: &i32 }
        fn make() -> S { S { f: &missing_name } }
      `);
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics.every((d) => d.code !== "HEDGE-LIFETIME-002")).toBe(
        true,
      );
    });

    it.fails(
      "rejects a returned reference to a let-local laundered through an intermediate alias binding, a known gap since the check is single-hop and does not trace through `let r = &x; r`",
      (): void => {
        const { diagnostics } = diagnose(
          "fn confusing() -> &i32 { let x = 5; let r = &x; r }",
        );
        expect(diagnostics).toHaveLength(1);
        assert(diagnostics[0] !== undefined, "Expected diagnostics");
        expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-002");
      },
    );
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
        "only function, struct, enum, const, and static declarations are allowed at the top level",
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
      "fn f(mut x: [i32; 3]) { let r = &mut x[0]; print(r); }",
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

describe("match binding modes over a reference scrutinee", () => {
  it("binds a plain name as a shared reference when the scrutinee is &x", () => {
    const result = diagnose(
      "fn f(x: i32) -> i32 { match &x { name => *name } }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still binds a plain name by value (not a reference) when the scrutinee is owned", () => {
    const result = diagnose("fn f(x: i32) { match x { name => *name }; }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "cannot dereference a non-reference type",
    );
  });

  it("binds a plain name as a mutable reference when the scrutinee is &mut x", () => {
    const result = diagnose(
      "fn f(mut x: i32) -> i32 { match &mut x { name => *name } }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a &name override binding as a shared reference when it merely matches the scrutinee's own default", () => {
    const result = diagnose(
      "fn f(x: i32) -> i32 { match &x { &name => *name } }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors a &name override binding as a shared reference even when the scrutinee is owned", () => {
    const result = diagnose(
      "fn f(x: i32) -> i32 { match x { &name => *name } }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("inherits the scrutinee's shared-reference default for every field of a destructured struct pattern", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(p: Point) -> i32 { match &p { Point { x, y } => *x + *y } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("lets one struct field override to a borrow while another inherits the owned scrutinee's move default", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(p: Point) -> i32 { match p { Point { x: &bx, y } => *bx + y } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats `mut name` as a reassignable local binding without turning it into a reference", () => {
    const result = diagnose(
      "fn f(x: i32) -> i32 { match x { mut name => { name = name + 1; name } } }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still rejects reassigning a plain (non-mut) match binding", () => {
    const result = diagnose(
      "fn f(x: i32) -> i32 { match x { name => { name = name + 1; name } } }",
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "cannot assign to immutable binding",
    );
  });
});

describe("binding-mode &mut-override legality", () => {
  it("rejects a &mut field override under a shared-reference (&x) scrutinee", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(p: Point) { match &p { Point { x: &mut bx, y } => { *bx; y } }; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "cannot bind `bx` as `&mut` through a shared reference",
    );
  });

  it("accepts a &mut field override under a mutable-reference (&mut x) scrutinee", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(mut p: Point) { match &mut p { Point { x: &mut bx, y } => { *bx; y } }; }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a &mut field override under an owned scrutinee whose root place is not mut", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(p: Point) { match p { Point { x: &mut bx, y } => { *bx; y } }; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "cannot bind `bx` as `&mut` because the underlying place is not mutable",
    );
  });

  it("accepts a &mut field override in a let-position destructuring pattern whose initializer's root place is mut", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(mut p: Point) -> i32 { let Point { x: &mut bx, y } = p; *bx + y }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a &mut field override on a destructured parameter with no mut marker", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(Point { x: &mut bx, y }: Point) -> i32 { *bx + y }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "cannot bind `bx` as `&mut` because the underlying place is not mutable",
    );
  });

  it("accepts a &mut field override on a destructured parameter marked mut", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      fn f(mut Point { x: &mut bx, y }: Point) -> i32 { *bx + y }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a &mut field override reached only through a nested mut-marked struct pattern, regardless of the outer scrutinee's own mutability", () => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      struct Line { start: Point, end: Point }
      fn f(l: Line) -> i32 {
        match l { Line { start: mut Point { x: &mut bx, y }, end } => *bx + y + end.x }
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("slice patterns over fixed-length arrays", () => {
  it("destructures a slice pattern whose element count exactly matches a fixed-length array", () => {
    const result = diagnose(`
      fn f(arr: [i32; 3]) -> i32 { let [a, b, c] = arr; a + b + c }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a slice pattern with no rest whose element count does not match the array's length, also naming it refutable", () => {
    // An arity-mismatched slice pattern is refutable in the strongest sense
    // (it never matches), so it's correctly rejected in let position for
    // that reason too, alongside the specific arity diagnostic - the same
    // two-independently-true-facts shape as the match/exhaustiveness case
    // above, and matches rustc's own behavior of reporting both.
    const result = diagnose(`
      fn f(arr: [i32; 3]) { let [a, b] = arr; }
    `);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toBe(
      "array has 3 element(s), but the pattern requires exactly 2",
    );
    expect(result.diagnostics[1]?.message).toBe(
      "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match",
    );
  });

  it("rejects a slice pattern with a rest whose required minimum exceeds the array's length, also naming it refutable", () => {
    const result = diagnose(`
      fn f(arr: [i32; 2]) { let [a, b, c, ..rest] = arr; }
    `);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toBe(
      "array has 2 element(s), but the pattern requires at least 3",
    );
    expect(result.diagnostics[1]?.message).toBe(
      "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match",
    );
  });

  it("clamps the rest binding's array length to zero, not negative, when the pattern's non-rest elements already exceed the array's length", () => {
    const result = diagnose(`
      fn f(arr: [i32; 2]) { let [a, b, c, ..rest] = arr; }
    `);
    const fn = result.program.items.find((item) => item.kind === "Function");
    assert(fn !== undefined, "Expected a function declaration");
    const letStmt = fn.body.statements[0];
    assert(letStmt?.kind === "LetStatement", "Expected a let statement");
    assert(letStmt.pattern.kind === "SlicePattern", "Expected a slice pattern");
    const restElement = letStmt.pattern.elements.at(-1);
    assert(
      restElement?.kind === "RestPattern",
      "Expected the last element to be a rest pattern",
    );
    assert(
      isSome(restElement.name),
      "Expected the rest binding to have a name",
    );
    expect(restElement.name.value.type).toMatchObject({
      kind: "ArrayType",
      length: 0,
    });
  });

  it("destructures a slice pattern with a rest binding, computing its fixed-length array type", () => {
    const result = diagnose(`
      fn f(arr: [i32; 5]) {
        let [first, ..rest] = arr;
        let check: [i32; 4] = rest;
        print(first);
        print(check);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a slice pattern with more than one `..` rest", () => {
    const result = diagnose(`
      fn f(arr: [i32; 5]) { let [a, .., b, .., c] = arr; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "a slice pattern can have at most one `..` rest, but this one has 2",
    );
  });

  it("treats a single slice-pattern match arm alone as exhaustive when its length matches the array", () => {
    const result = diagnose(`
      fn f(arr: [i32; 3]) -> i32 { match arr { [a, b, c] => a + b + c } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("also reports non-exhaustive when an arity-mismatched slice pattern is the only arm, since it can never match anything", () => {
    // An arity mismatch isn't "assume best case, treat as covering
    // everything" the way a malformed struct pattern is - this pattern
    // genuinely can never match, so the match genuinely doesn't cover
    // `arr` either. Both diagnostics are independently true, not a
    // cascade to suppress.
    const result = diagnose(`
      fn f(arr: [i32; 3]) { match arr { [a, b] => { print(a); print(b); } }; }
    `);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toBe(
      "array has 3 element(s), but the pattern requires exactly 2",
    );
    expect(result.diagnostics[1]?.message).toContain("non-exhaustive");
  });

  it("does not treat an arity-mismatched slice-pattern arm as a catch-all that suppresses a later, correctly-shaped arm", () => {
    const result = diagnose(`
      fn f(arr: [i32; 3]) -> i32 { match arr { [a, b] => 1, [c, d, e] => 2 } }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "array has 3 element(s), but the pattern requires exactly 2",
    );
  });

  it("binds a `&rest` sigil as a shared reference to the computed rest sub-array", () => {
    const result = diagnose(`
      fn f(arr: [i32; 3]) { let [first, ..&rest] = arr; print(*rest); }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a `&mut rest` override through a shared-reference scrutinee", () => {
    const result = diagnose(`
      fn f(arr: [i32; 3]) {
        match &arr { [first, ..&mut rest] => { print(*rest); } };
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "cannot bind `rest` as `&mut` through a shared reference",
    );
  });
});

describe("or-pattern binding consistency", () => {
  it("analyzes an or-pattern whose alternatives bind the same name with the same type cleanly", () => {
    const result = diagnose(`
      enum Res { Ok(i32), Err(i32) }
      fn f(r: Res) -> i32 { match r { Res::Ok(x) | Res::Err(x) => x } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts differing byRef sigils across alternatives when they produce the same resulting type and local mutability", () => {
    const result = diagnose(`
      enum Res { Ok(i32), Err(i32) }
      fn f(r: Res) { match &r { Res::Ok(name) | Res::Err(&name) => print(*name) } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an or-pattern whose alternatives bind different names", () => {
    const result = diagnose(`
      enum Res { Ok(i32), Err(i32) }
      fn f(r: Res) { match r { Res::Ok(a) | Res::Err(b) => { print(a); print(b); } }; }
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(
      result.diagnostics.some((d) =>
        d.message.startsWith(
          "or-pattern alternatives must bind the same names",
        ),
      ),
    ).toBe(true);
  });

  it("rejects an or-pattern whose alternatives bind the same name with different types", () => {
    const result = diagnose(`
      enum Res { Ok(i32), Err(str) }
      fn f(r: Res) { match r { Res::Ok(x) | Res::Err(x) => { print(x); } }; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "or-pattern alternatives must bind `x` with the same type and mode in every alternative",
    );
  });

  it("rejects an or-pattern whose alternatives bind the same name with different modes", () => {
    const result = diagnose(`
      enum Res { Ok(i32), Err(i32) }
      fn f(r: Res) { match r { Res::Ok(x) | Res::Err(mut x) => { print(x); } }; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "or-pattern alternatives must bind `x` with the same type and mode in every alternative",
    );
  });

  it("still analyzes an or-pattern where every alternative binds no names at all cleanly", () => {
    const result = diagnose(`
      enum Message { Quit, Move }
      fn f(m: Message) -> i32 { match m { Message::Quit | _ => 0 } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an or-pattern mixing a wildcard alternative with a binding alternative", () => {
    const result = diagnose(`
      enum Res { Ok(i32), Err(i32) }
      fn f(r: Res) { match r { _ | Res::Ok(x) => { print(x); } }; }
    `);
    expect(
      result.diagnostics.some((d) =>
        d.message.startsWith(
          "or-pattern alternatives must bind the same names",
        ),
      ),
    ).toBe(true);
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
    // requires `expr: Copy` (a struct-typed const isn't in this ticket's
    // const-eval scope, so still hits this check the same as any other
    // non-Copy value).
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

  it("rejects a repeat-form count that is a runtime variable, not a compile-time constant", (): void => {
    const result = diagnose(`
      fn main() {
        let n = 5;
        let arr = [0; n];
        print(arr);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    // `n` is a real, declared local shadowing nothing - `resolveConstRef`'s
    // shadow check (see `analyzer.ts`) resolves it to an ordinary binding
    // and reports the generic "not a constant expression" message, which
    // never actually names `n`. Assert the real message text, not a
    // substring that happens to match by coincidence (a prior version of
    // this assertion checked for the literal character "n", which passes
    // against "consta**n**t" regardless of what the diagnostic says).
    expect(result.diagnostics[0].message).toBe(
      "array length must be a compile-time constant expression",
    );
  });

  it("rejects a repeat-form count larger than the maximum array length", (): void => {
    const result = diagnose(`
      fn main() {
        let arr = [1; 99999999999999999999999999];
        print(arr[0]);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("exceeds the maximum");
  });

  it("rejects an array type annotation whose length exceeds the maximum", (): void => {
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
    expect(result.diagnostics[0].message).toContain("exceeds the maximum");
  });

  describe("const-length arrays", (): void => {
    it("resolves a [T; N] array type whose length is a const", (): void => {
      const result = diagnose(`
        const N: usize = 3;
        fn main() {
          let arr: [i32; N] = [1, 2, 3];
          print(arr);
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a [value; N] repeat-form array whose count is a const", (): void => {
      const result = diagnose(`
        const N: usize = 3;
        fn main() {
          let arr = [0; N];
          print(arr);
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves a const array length that is itself a const arithmetic expression", (): void => {
      const result = diagnose(`
        const N: usize = 1 + 2;
        fn main() {
          let arr: [i32; N] = [1, 2, 3];
          print(arr);
        }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a zero-length const array", (): void => {
      const result = diagnose(`
        const N: usize = 0;
        fn f(arr: [i32; N]) { print(arr); }
      `);
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects a const array length that references a const of a non-integer type", (): void => {
      const result = diagnose(`
        const N: bool = true;
        fn f(arr: [i32; N]) { print(arr); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(result.diagnostics[0].message).toContain("integer");
    });

    it("rejects a negative const array length", (): void => {
      const result = diagnose(`
        const N: i32 = -1;
        fn f(arr: [i32; N]) { print(arr); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(result.diagnostics[0].message).toContain("negative");
    });

    it("rejects a [T; N] array length referencing an undeclared name", (): void => {
      const result = diagnose(`
        fn f(arr: [i32; MISSING]) { print(arr); }
      `);
      expect(result.diagnostics).toHaveLength(1);
      assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(result.diagnostics[0].message).toContain("MISSING");
    });
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

describe("Self as a type", (): void => {
  it("rejects `Self::Item` as an unsupported qualified path", (): void => {
    const result = diagnose("fn f() -> Self::Item { }");
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(result.diagnostics[0].message).toBe(
      "qualified type paths are not supported yet",
    );
  });
});

describe("generic parameter shadowing an outer type of the same name", (): void => {
  it("resolves a function's own type parameter over an outer struct of the same name, with a warning", (): void => {
    const result = diagnose("struct T {} fn f<T>(x: T) {}");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("HEDGE-LINT-002");
    const fn = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "f",
    );
    assert(fn?.kind === "Function", "expected a Function item");
    expect(fn.signature.params[0]?.type.kind).toBe("NamedType");
  });

  it("resolves a function's own type parameter over an outer enum of the same name, with a warning", (): void => {
    const result = diagnose("enum T {} fn f<T>(x: T) {}");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("HEDGE-LINT-002");
    const fn = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "f",
    );
    assert(fn?.kind === "Function", "expected a Function item");
    expect(fn.signature.params[0]?.type.kind).toBe("NamedType");
  });

  it("warns once per occurrence when a shadowing type parameter is used more than once in a signature", (): void => {
    const result = diagnose("struct T {} fn f<T>(x: T) -> T { x }");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.code === "HEDGE-LINT-002")).toBe(true);
  });

  it("resolves a struct's own type parameter over an outer struct of the same name, with a warning", (): void => {
    const result = diagnose("struct T {} struct Pair<T> { a: T }");
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("HEDGE-LINT-002");
    const pair = result.program.items.find(
      (item) => item.kind === "Struct" && item.name.text === "Pair",
    );
    assert(pair?.kind === "Struct", "expected a Struct item");
    assert(pair.body.kind === "NamedFields", "expected named fields");
    expect(pair.body.fields[0]?.type.kind).toBe("NamedType");
  });

  it("does not warn when a generic parameter does not collide with any outer type", (): void => {
    const result = diagnose("fn f<T>(x: T) -> T { x }");
    expect(result.diagnostics).toEqual([]);
  });
});

describe("declared generic parameter names survive onto a resolved signature", (): void => {
  it("carries a generic function's declared type-parameter name onto its resolved FunctionType", (): void => {
    const result = diagnose(`
      fn identity<T>(x: T) -> T { x }
      fn main() {
        let f = identity;
      }
    `);
    expect(result.diagnostics).toEqual([]);
    const mainFn = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "main",
    );
    assert(mainFn?.kind === "Function", "expected a Function item");
    const letStatement = mainFn.body.statements.find(
      (s) => s.kind === "LetStatement",
    );
    assert(letStatement?.kind === "LetStatement", "expected a LetStatement");
    assert(isSome(letStatement.initializer), "expected an initializer");
    const initType = letStatement.initializer.value.type;
    assert(initType.kind === "FunctionType", "expected a FunctionType");
    expect(initType.genericParams).toEqual(["T"]);
  });

  it("carries a generic function's declared type-parameter name onto its own FunctionDecl", (): void => {
    const result = diagnose("fn identity<T>(x: T) -> T { x }");
    expect(result.diagnostics).toEqual([]);
    const identity = result.program.items.find(
      (item) =>
        item.kind === "Function" && item.signature.name.text === "identity",
    );
    assert(identity?.kind === "Function", "expected a Function item");
    expect(identity.signature.generics).toEqual(["T"]);
  });

  it("leaves generics empty for a non-generic function's FunctionDecl and resolved FunctionType", (): void => {
    const result = diagnose(`
      fn f(x: i32) -> i32 { x }
      fn main() {
        let g = f;
      }
    `);
    expect(result.diagnostics).toEqual([]);
    const fDecl = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "f",
    );
    assert(fDecl?.kind === "Function", "expected a Function item");
    expect(fDecl.signature.generics).toEqual([]);

    const mainFn = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "main",
    );
    assert(mainFn?.kind === "Function", "expected a Function item");
    const letStatement = mainFn.body.statements.find(
      (s) => s.kind === "LetStatement",
    );
    assert(letStatement?.kind === "LetStatement", "expected a LetStatement");
    assert(isSome(letStatement.initializer), "expected an initializer");
    const initType = letStatement.initializer.value.type;
    assert(initType.kind === "FunctionType", "expected a FunctionType");
    expect(initType.genericParams).toEqual([]);
  });

  it("carries a generic struct's declared type-parameter name onto its own StructDecl", (): void => {
    const result = diagnose("struct Wrapper<T> { value: T }");
    expect(result.diagnostics).toEqual([]);
    const wrapper = result.program.items.find(
      (item) => item.kind === "Struct" && item.name.text === "Wrapper",
    );
    assert(wrapper?.kind === "Struct", "expected a Struct item");
    expect(wrapper.generics).toEqual(["T"]);
  });

  it("carries a generic enum's declared type-parameter name onto its own EnumDecl", (): void => {
    const result = diagnose("enum Container<T> { Has(T), Empty }");
    expect(result.diagnostics).toEqual([]);
    const container = result.program.items.find(
      (item) => item.kind === "Enum" && item.name.text === "Container",
    );
    assert(container?.kind === "Enum", "expected an Enum item");
    expect(container.generics).toEqual(["T"]);
  });

  it("leaves generics empty for a non-generic struct and enum", (): void => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      enum Color { Red, Green, Blue }
    `);
    expect(result.diagnostics).toEqual([]);
    const point = result.program.items.find(
      (item) => item.kind === "Struct" && item.name.text === "Point",
    );
    assert(point?.kind === "Struct", "expected a Struct item");
    expect(point.generics).toEqual([]);

    const color = result.program.items.find(
      (item) => item.kind === "Enum" && item.name.text === "Color",
    );
    assert(color?.kind === "Enum", "expected an Enum item");
    expect(color.generics).toEqual([]);
  });

  it("preserves declaration order for multiple generic parameters", (): void => {
    const result = diagnose("fn pair<T, U>(a: T, b: U) -> T { a }");
    expect(result.diagnostics).toEqual([]);
    const pair = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "pair",
    );
    assert(pair?.kind === "Function", "expected a Function item");
    expect(pair.signature.generics).toEqual(["T", "U"]);
  });

  it("lists a generic parameter only ever used through a reference hop", (): void => {
    const result = diagnose("fn f<T>(x: &T) {}");
    expect(result.diagnostics).toEqual([]);
    const f = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "f",
    );
    assert(f?.kind === "Function", "expected a Function item");
    expect(f.signature.generics).toEqual(["T"]);
  });

  it("leaves generics empty for a lifetime-only parameter list", (): void => {
    const result = diagnose("fn f<'a>(x: &'a i32) -> &'a i32 { x }");
    expect(result.diagnostics).toEqual([]);
    const f = result.program.items.find(
      (item) => item.kind === "Function" && item.signature.name.text === "f",
    );
    assert(f?.kind === "Function", "expected a Function item");
    expect(f.signature.generics).toEqual([]);
  });
});

describe("bodiless function signatures", (): void => {
  it("rejects a top-level bodiless function signature, since extern/trait are its only legal containers and neither parses yet", (): void => {
    const result = diagnose("fn f();");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "a function signature with no body is not allowed as a top-level item",
    );
    expect(result.diagnostics[0]?.code).toBe("HEDGE-ITEM-001");
  });

  it("rejects a block-local bodiless function signature the same way, with context-specific wording", (): void => {
    const result = diagnose("fn main() { fn f(); }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "a function signature with no body is not allowed inside a block",
    );
    expect(result.diagnostics[0]?.code).toBe("HEDGE-ITEM-001");
  });

  it("still reports a bad parameter type on a bodiless signature, alongside the position restriction", (): void => {
    const result = diagnose("fn f(x: NotAType);");
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toBe(
      "a function signature with no body is not allowed as a top-level item",
    );
    expect(result.diagnostics[1]?.message).toBe(
      "cannot find type `NotAType` in this scope",
    );
  });

  it("still skips the missing-return-value check for a bodiless signature with a non-unit return type, alongside the position restriction", (): void => {
    const result = diagnose("fn f() -> i32;");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "a function signature with no body is not allowed as a top-level item",
    );
  });

  it("still rejects the equivalent bodied function for missing return value, unaffected", (): void => {
    const result = diagnose("fn f() -> i32 {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "missing return value: expected `i32`",
    );
  });

  it("reports both the position restriction (once per declaration) and the duplicate-name diagnostic for two same-named bodiless signatures", (): void => {
    const result = diagnose("fn f(); fn f();");
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "function `f` is defined more than once",
      "a function signature with no body is not allowed as a top-level item",
      "a function signature with no body is not allowed as a top-level item",
    ]);
  });
});

describe("trait and impl declarations", (): void => {
  it("analyzes an empty inherent impl with no diagnostics", (): void => {
    const result = diagnose(`
      struct Point { x: i32, y: i32 }
      impl Point {}
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects two impls of the same trait for the exact same concrete type", (): void => {
    const result = diagnose(`
      trait Draw { fn draw(&self) -> str; }
      struct Point { x: i32, y: i32 }
      impl Draw for Point { fn draw(&self) -> str { "a" } }
      impl Draw for Point { fn draw(&self) -> str { "b" } }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "trait `Draw` is already implemented for type `Point`",
    );
  });

  it("rejects two blanket impls of the same trait", (): void => {
    const result = diagnose(`
      trait A {}
      trait B { fn f(&self) -> str; }
      impl<T: A> B for T {}
      impl<T: A> B for T {}
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "conflicting implementations of trait `B`",
    );
  });

  it("rejects a blanket impl and a concrete impl of the same trait", (): void => {
    const result = diagnose(`
      trait A {}
      trait B { fn f(&self) -> str; }
      struct Point { x: i32, y: i32 }
      impl<T: A> B for T {}
      impl B for Point { fn f(&self) -> str { "a" } }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "conflicting implementations of trait `B` for type `Point`",
    );
  });

  it("accepts two impls of different traits for the same type", (): void => {
    const result = diagnose(`
      trait Draw { fn draw(&self) -> str; }
      trait Describe { fn describe(&self) -> str; }
      struct Point { x: i32, y: i32 }
      impl Draw for Point { fn draw(&self) -> str { "a" } }
      impl Describe for Point { fn describe(&self) -> str { "b" } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts two impls of the same trait for different types", (): void => {
    const result = diagnose(`
      trait Draw { fn draw(&self) -> str; }
      struct Point { x: i32, y: i32 }
      struct Circle { r: i32 }
      impl Draw for Point { fn draw(&self) -> str { "a" } }
      impl Draw for Circle { fn draw(&self) -> str { "b" } }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an inherent impl alongside a trait impl for the same type", (): void => {
    const result = diagnose(`
      trait Draw { fn draw(&self) -> str; }
      struct Point { x: i32, y: i32 }
      impl Point {}
      impl Draw for Point { fn draw(&self) -> str { "a" } }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
