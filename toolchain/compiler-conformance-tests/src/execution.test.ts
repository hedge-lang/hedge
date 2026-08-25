import { describe, it, expect } from "vitest";
import {
  executeHedgeCode,
  compileHedgeCode,
  hasCompileErrors,
  assertRunsTo,
  assertCompilesClean,
  assertRejectsWithMessage,
  assertRejects,
  assertNoCascade,
} from "./test-harness.js";

describe("execution tests", (): void => {
  describe("basic output", (): void => {
    it("prints a string literal", (): void => {
      assertRunsTo(`fn main() { print("Hello"); }`, ["Hello"]);
    });

    it("prints a variable", (): void => {
      assertRunsTo(`fn main() { let msg = "world"; print(msg); }`, ["world"]);
    });

    it("prints multiple values", (): void => {
      assertRunsTo(
        `fn main() { print("first"); print("second"); print("third"); }`,
        ["first", "second", "third"],
      );
    });
  });

  describe("arithmetic", (): void => {
    it("evaluates 1 + 2 correctly", (): void => {
      assertRunsTo(`fn main() { let x = 1 + 2; print(x); }`, ["3"]);
    });

    it("respects operator precedence", (): void => {
      assertRunsTo(`fn main() { let x = 1 + 2 * 3; print(x); }`, ["7"]);
    });

    it("handles subtraction", (): void => {
      assertRunsTo(`fn main() { let x = 10 - 3; print(x); }`, ["7"]);
    });

    it("handles multiplication", (): void => {
      assertRunsTo(`fn main() { let x = 4 * 5; print(x); }`, ["20"]);
    });

    it("handles division", (): void => {
      assertRunsTo(`fn main() { let x = 20 / 4; print(x); }`, ["5"]);
    });

    it("handles modulo", (): void => {
      assertRunsTo(`fn main() { print(10 % 3); }`, ["1"]);
    });

    it("handles unary negation", (): void => {
      assertRunsTo(`fn main() { let x = 5; print(-x); }`, ["-5"]);
    });

    it("handles boolean not", (): void => {
      assertRunsTo(`fn main() { print(!true); }`, ["false"]);
    });

    it("handles negative integer literals", (): void => {
      assertRunsTo(`fn main() { let x = -5; print(x); }`, ["-5"]);
    });

    it("division before addition in mixed expression", (): void => {
      assertRunsTo(`fn main() { print(6 / 2 + 1); }`, ["4"]);
    });

    it("subtraction is left-associative", (): void => {
      assertRunsTo(`fn main() { print(10 - 3 - 2); }`, ["5"]);
    });

    it("bitwise AND", (): void => {
      assertRunsTo(`fn main() { print(6 & 3); }`, ["2"]);
    });

    it("bitwise OR", (): void => {
      assertRunsTo(`fn main() { print(6 | 3); }`, ["7"]);
    });

    it("bitwise XOR", (): void => {
      assertRunsTo(`fn main() { print(6 ^ 3); }`, ["5"]);
    });

    it("shift left", (): void => {
      assertRunsTo(`fn main() { print(1 << 3); }`, ["8"]);
    });

    it("shift right", (): void => {
      assertRunsTo(`fn main() { print(16 >> 2); }`, ["4"]);
    });

    it("arithmetic right shift is signed (sign-extending)", (): void => {
      // Rust and JS both use arithmetic (sign-extending) >>
      // -8 in binary: 1111...1000; >> 1 = 1111...1100 = -4
      assertRunsTo(`fn main() { print(-8 >> 1); }`, ["-4"]);
    });

    it("double negation of integers returns original value", (): void => {
      assertRunsTo(`fn main() { print(-(-5)); }`, ["5"]);
      assertRunsTo(`fn main() { print(-(-42)); }`, ["42"]);
    });
  });

  describe("control flow", (): void => {
    it("executes if-true branch", (): void => {
      assertRunsTo(`fn main() { if true { print("yes"); } }`, ["yes"]);
    });

    it("skips if-false branch", (): void => {
      assertRunsTo(`fn main() { if false { print("no"); }; print("after"); }`, [
        "after",
      ]);
    });

    it("executes if-else correctly", (): void => {
      assertRunsTo(
        `fn main() { if false { print("no"); } else { print("yes"); } }`,
        ["yes"],
      );
    });

    it("chains else-if correctly", (): void => {
      assertRunsTo(
        `fn main() {
          let x = 2;
          if x == 1 { print("one"); } else if x == 2 { print("two"); } else { print("other"); }
        }`,
        ["two"],
      );
    });

    it("if expression as let initializer", (): void => {
      assertRunsTo(
        `fn main() { let x = if true { 1 } else { 2 }; print(x); }`,
        ["1"],
      );
    });
  });

  describe("comparisons", (): void => {
    it("evaluates == correctly", (): void => {
      assertRunsTo(
        `fn main() { if 5 == 5 { print("equal"); } else { print("not equal"); } }`,
        ["equal"],
      );
    });

    it("evaluates < correctly", (): void => {
      assertRunsTo(`fn main() { if 3 < 5 { print("yes"); } }`, ["yes"]);
    });

    it("evaluates > correctly", (): void => {
      assertRunsTo(`fn main() { if 10 > 5 { print("yes"); } }`, ["yes"]);
    });

    it("evaluates != correctly", (): void => {
      assertRunsTo(`fn main() { print(3 != 4); }`, ["true"]);
    });

    it("evaluates <= correctly", (): void => {
      assertRunsTo(`fn main() { print(3 <= 3); }`, ["true"]);
    });

    it("evaluates >= correctly", (): void => {
      assertRunsTo(`fn main() { print(5 >= 3); }`, ["true"]);
    });

    it("evaluates && correctly", (): void => {
      assertRunsTo(`fn main() { print(true && false); }`, ["false"]);
    });

    it("evaluates || correctly", (): void => {
      assertRunsTo(`fn main() { print(false || true); }`, ["true"]);
    });
  });

  describe("operator precedence", (): void => {
    it("logical-and binds tighter than logical-or", (): void => {
      // true || (false && false) = true; wrong grouping gives false
      assertRunsTo(`fn main() { print(true || false && false); }`, ["true"]);
    });

    it("comparison binds tighter than logical-and", (): void => {
      // (1 + 1 == 2) && (3 > 1) = true && true = true
      assertRunsTo(`fn main() { print(1 + 1 == 2 && 3 > 1); }`, ["true"]);
    });

    it("arithmetic binds tighter than comparison", (): void => {
      // (1 + 2) == 3, not 1 + (2 == 3)
      assertRunsTo(`fn main() { print(1 + 2 == 3); }`, ["true"]);
    });

    it("unary minus binds tighter than addition", (): void => {
      // (-3) + 4 = 1, not -(3 + 4) = -7
      assertRunsTo(`fn main() { print(-3 + 4); }`, ["1"]);
    });

    it("unary not binds tighter than logical-and", (): void => {
      // (!true) && false = false; !(true && false) = true (wrong grouping)
      assertRunsTo(`fn main() { print(!true && false); }`, ["false"]);
    });

    it("bitwise-and binds tighter than equality (Rust semantics)", (): void => {
      // Rust: (6 & 3) == 2 = 2 == 2 = true
      // JS-style grouping would give: 6 & (3 == 2) = 6 & false = 0
      assertRunsTo(`fn main() { print(6 & 3 == 2); }`, ["true"]);
    });

    it("bitwise-or binds tighter than equality (Rust semantics)", (): void => {
      // Rust: (5 | 2) == 7 = 7 == 7 = true
      assertRunsTo(`fn main() { print(5 | 2 == 7); }`, ["true"]);
    });

    it("bitwise-xor binds tighter than bitwise-or", (): void => {
      // (5 ^ 2) | 3 = 7 | 3 = 7; if | were tighter: 5 ^ (2 | 3) = 5 ^ 3 = 6
      assertRunsTo(`fn main() { print(5 ^ 2 | 3); }`, ["7"]);
    });

    it("bitwise-and binds tighter than bitwise-xor", (): void => {
      // (3 & 6) ^ 5 = 2 ^ 5 = 7; if ^ were tighter: 3 & (6 ^ 5) = 3 & 3 = 3
      assertRunsTo(`fn main() { print(3 & 6 ^ 5); }`, ["7"]);
    });
  });

  describe("blocks and scopes", (): void => {
    it("executes block statements", (): void => {
      assertRunsTo(`fn main() { let x = 1; { let y = 2; print(x + y); } }`, [
        "3",
      ]);
    });

    it("block with trailing expression", (): void => {
      assertRunsTo(
        `fn main() { let x = { let a = 5; let b = 3; a + b }; print(x); }`,
        ["8"],
      );
    });

    it("let mut rebinding updates the value", (): void => {
      assertRunsTo(`fn main() { let mut x = 1; x = 2; print(x); }`, ["2"]);
    });

    it("let mut modifier compiles and executes", (): void => {
      assertRunsTo(`fn main() { let mut x = 5; print(x); }`, ["5"]);
    });

    it("type annotation on let binding compiles correctly", (): void => {
      assertRunsTo(`fn main() { let x: i32 = 5; print(x); }`, ["5"]);
    });

    it("compound assignment += updates a let mut binding", (): void => {
      assertRunsTo(`fn main() { let mut x = 1; x += 5; print(x); }`, ["6"]);
    });

    it("compound assignment -= updates a let mut binding", (): void => {
      assertRunsTo(`fn main() { let mut x = 10; x -= 3; print(x); }`, ["7"]);
    });

    it("multiple assignments to let mut binding update sequentially", (): void => {
      assertRunsTo(`fn main() { let mut x = 1; x = 2; x = 3; print(x); }`, [
        "3",
      ]);
    });

    it("wildcard let evaluates its initializer for its side effect", (): void => {
      assertRunsTo(`fn main() { let _ = print(5); }`, ["5"]);
    });

    it("inner scope shadow does not affect outer binding", (): void => {
      assertRunsTo(
        `fn main() {
          let x = 1;
          {
            let x = 2;
            print(x);
          }
          print(x);
        }`,
        ["2", "1"],
      );
    });

    it("variable shadowing emits correct output", (): void => {
      assertRunsTo(`fn main() { let x = 1; let x = 2; print(x); }`, ["2"]);
    });
  });

  describe("block grammar (EXEC-BLOCKS)", (): void => {
    it("empty block returns unit", (): void => {
      assertCompilesClean(`fn main() { }`);
    });

    it("block with only empty statements returns unit", (): void => {
      assertCompilesClean(`fn main() { ; ; ; }`);
    });

    it("nested blocks evaluate innermost trailing expression", (): void => {
      assertRunsTo(`fn main() { let x = { { 42 } }; print(x); }`, ["42"]);
    });

    it("local fn declaration inside block is callable", (): void => {
      assertRunsTo(
        `fn main() { fn greet() { print("hello"); } greet(); greet(); }`,
        ["hello", "hello"],
      );
    });

    it("local struct declaration inside block is usable", (): void => {
      assertRunsTo(
        `fn main() { struct Point { x: i32 } let p = Point { x: 7 }; print(p.x); }`,
        ["7"],
      );
    });

    it("let without initializer parses cleanly", (): void => {
      assertCompilesClean(`fn main() { let x; }`);
    });
  });

  describe("range grammar (EXEC-RANGES)", (): void => {
    it("range expression as a let initializer compiles clean", (): void => {
      assertCompilesClean(`fn main() { let r = 0..10; }`);
    });

    it("bare range (RangeFull) as a let initializer compiles clean", (): void => {
      assertCompilesClean(`fn main() { let r = ..; }`);
    });
  });

  describe("literal types", (): void => {
    it("float literal prints correctly", (): void => {
      assertRunsTo(`fn main() { let x = 3.14; print(x); }`, ["3.14"]);
    });

    it("char literal prints as its character", (): void => {
      assertRunsTo(`fn main() { let c = 'A'; print(c); }`, ["A"]);
    });

    it("two unit values compare equal under ==", (): void => {
      assertRunsTo(`fn main() { let a = (); let b = (); print(a == b); }`, [
        "true",
      ]);
    });

    it("two unit values compare unequal as false under !=", (): void => {
      assertRunsTo(`fn main() { let a = (); let b = (); print(a != b); }`, [
        "false",
      ]);
    });

    it("a unit value from a unit-returning function call compares equal to a unit literal", (): void => {
      assertRunsTo(`fn noop() {} fn main() { print(noop() == ()); }`, ["true"]);
    });
  });

  describe("structs", (): void => {
    it("struct declaration compiles alongside fn main", (): void => {
      assertRunsTo(`struct Foo { x: i32 } fn main() { print(1); }`, ["1"]);
    });

    it("struct literal field access evaluates correctly", (): void => {
      assertRunsTo(
        `struct Foo { x: i32 } fn main() { let f = Foo { x: 42 }; print(f.x); }`,
        ["42"],
      );
    });

    it("struct declared after use resolves correctly", (): void => {
      assertRunsTo(
        `fn main() { let f = Foo { x: 42 }; print(f.x); } struct Foo { x: i32 }`,
        ["42"],
      );
    });

    it("fn, struct, i32/bool, let/let mut, arithmetic, calls, if/else, and blocks execute together", (): void => {
      assertRunsTo(
        `
        struct Point { x: i32, y: i32 }

        fn main() {
          fn describe(x: i32, y: i32) {
            if x > y {
              print("x wins");
            } else {
              print("y wins");
            }
          }

          let mut total: i32 = 0;
          let a = 3;
          let b = 4;
          total = a * b + 2;
          let is_big = total > 10;
          print(total);
          print(is_big);

          let p = Point { x: 5, y: 9 };
          describe(p.x, p.y);
        }
        `,
        ["14", "true", "y wins"],
      );
    });
  });

  describe("functions", (): void => {
    it("function trailing expression returns a value", (): void => {
      assertRunsTo(
        `fn double(x: i32) -> i32 { x * 2 } fn main() { print(double(5)); }`,
        ["10"],
      );
    });

    it("if/else trailing expression returns a value", (): void => {
      assertRunsTo(
        `
        fn sign(x: i32) -> i32 { if x > 0 { 1 } else { -1 } }
        fn main() {
          print(sign(5));
          print(sign(-5));
        }
        `,
        ["1", "-1"],
      );
    });

    it("else-if chain trailing expression returns from every branch", (): void => {
      assertRunsTo(
        `
        fn sign(x: i32) -> i32 {
          if x > 0 { 1 } else if x < 0 { -1 } else { 0 }
        }
        fn main() {
          print(sign(5));
          print(sign(-5));
          print(sign(0));
        }
        `,
        ["1", "-1", "0"],
      );
    });

    it("nested user-defined function calls use real return values", (): void => {
      assertRunsTo(
        `fn inc(x: i32) -> i32 { x + 1 } fn main() { let y = inc(inc(1)); print(y); }`,
        ["3"],
      );
    });

    it("calling a top-level function declared later in the file (forward reference)", (): void => {
      assertRunsTo(
        `fn main() { print(later(3)); } fn later(x: i32) -> i32 { x + 1 }`,
        ["4"],
      );
    });

    it("a unit-returning function's trailing expression is still discarded", (): void => {
      assertRunsTo(`fn log(x: i32) { print(x); } fn main() { log(9); }`, ["9"]);
    });

    it("returns the correct value at the i32 boundary", (): void => {
      assertRunsTo(
        `
        fn clampish(x: i32) -> i32 { if x > 100 { 100 } else { x } }
        fn main() { print(clampish(2147483647)); }
        `,
        ["100"],
      );
    });

    it("a function's return value composes directly into another call's argument", (): void => {
      assertRunsTo(
        `
        fn double(x: i32) -> i32 { x * 2 }
        fn sign(x: i32) -> i32 { if x > 0 { 1 } else { -1 } }
        fn main() { print(double(sign(5))); }
        `,
        ["2"],
      );
    });
  });

  describe("error handling", (): void => {
    it("fails to compile unknown variable", (): void => {
      const result = compileHedgeCode(`fn main() { print(unknown_var); }`);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("produces no output on compile error", (): void => {
      const result = executeHedgeCode(`fn main() { print(unknown_var); }`);
      expect(result).toBeNull();
    });
  });

  describe("runtime behavior: integer safety", (): void => {
    it("integer division by zero causes runtime error, not Infinity", (): void => {
      const result = executeHedgeCode(`fn main() { print(1 / 0); }`);
      expect(result?.exitCode).not.toBe(0);
    });

    it("float division by zero yields Infinity (IEEE 754)", (): void => {
      assertRunsTo(
        `fn main() { let a = 1.0f32; let b = 0.0f32; print(a / b); }`,
        ["Infinity"],
      );
    });

    it("i64 addition wraps on overflow (two's complement)", (): void => {
      assertRunsTo(`fn main() { print(0x7FFF_FFFF_FFFF_FFFF_i64 + 1); }`, [
        String(-0x8000_0000_0000_0000n),
      ]);
    });

    it("i32 addition wraps on overflow (two's complement)", (): void => {
      assertRunsTo(`fn main() { print(0x7FFF_FFFF_i32 + 1); }`, [
        String(-0x8000_0000),
      ]);
    });

    it("i16 addition wraps on overflow (two's complement)", (): void => {
      assertRunsTo(`fn main() { print(0x7FFF_i16 + 1); }`, [String(-0x8000)]);
    });

    it("i8 addition wraps on overflow (two's complement)", (): void => {
      assertRunsTo(`fn main() { print(0x7F_i8 + 1); }`, [String(-0x80)]);
    });

    it("u64 addition wraps on overflow", (): void => {
      assertRunsTo(`fn main() { print(0xFFFF_FFFF_FFFF_FFFF_u64 + 1); }`, [
        "0",
      ]);
    });

    it("u32 addition wraps on overflow", (): void => {
      assertRunsTo(`fn main() { print(0xFFFF_FFFF_u32 + 1); }`, ["0"]);
    });

    it("u16 addition wraps on overflow", (): void => {
      assertRunsTo(`fn main() { print(0xFFFF_u16 + 1); }`, ["0"]);
    });

    it("u8 addition wraps on overflow (two's complement)", (): void => {
      assertRunsTo(`fn main() { print(0xFF_u8 + 1); }`, ["0"]);
    });

    it("i64 negation of zeroes", () => {
      assertRunsTo(`fn main() { let x: i64 = 0; print(-x == 0); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i64 = -0; print(-x == 0); }`, ["true"]);
    });

    it("i64 negation of ones", () => {
      assertRunsTo(`fn main() { let x: i64 = 1; print(-x == -1); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i64 = -1; print(-x == 1); }`, ["true"]);
    });

    it("i64 negation of max value", () => {
      assertRunsTo(
        `fn main() { let x: i64 = 0x7FFF_FFFF_FFFF_FFFF; print(-x == -0x7FFF_FFFF_FFFF_FFFF); }`,
        ["true"],
      );
    });

    it("i64 assignment beyond max value", () => {
      assertRejects(
        `fn main() { let x: i64 = 0x8000_0000_0000_0000; print(x); }`,
      );
    });

    it("i64 assignment beyond min value", () => {
      assertRejects(
        `fn main() { let x: i64 = -0x8000_0000_0000_0000; print(-x == 0x8000_0000_0000_0000); }`,
      );
    });

    it("i64 negation of min value", () => {
      assertRunsTo(
        `fn main() { let x: i64 = -0x8000_0000_0000_0000; print(x); }`,
        ["-9223372036854775808"],
      );
    });

    it("i64 negated literal below min in comparison is rejected", () => {
      assertRejects(
        `fn main() { let x: i64 = 0; print(-0x8000_0000_0000_0001 == x); }`,
      );
    });

    it("i64 negated literal at min in comparison is accepted", () => {
      assertRunsTo(
        `fn main() { let x: i64 = -0x8000_0000_0000_0000; print(-0x8000_0000_0000_0000 == x); }`,
        ["true"],
      );
    });

    it("i32 negation of zeroes", () => {
      assertRunsTo(`fn main() { let x: i32 = 0; print(-x == 0); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i32 = -0; print(-x == 0); }`, ["true"]);
    });

    it("i32 negation of ones", () => {
      assertRunsTo(`fn main() { let x: i32 = 1; print(-x == -1); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i32 = -1; print(-x == 1); }`, ["true"]);
    });

    it("i32 negation of max value", () => {
      assertRunsTo(
        `fn main() { let x: i32 = 0x7FFF_FFFF; print(-x == -0x7FFF_FFFF); }`,
        ["true"],
      );
    });

    it("i32 assignment beyond max value", () => {
      assertRejects(`fn main() { let x: i32 = 0x8000_0000; print(x); }`);
    });

    it("i32 assignment beyond min value", () => {
      assertRejects(
        `fn main() { let x: i32 = -0x8000_0000; print(-x == 0x8000_0000); }`,
      );
    });

    it("i32 negation of min value", () => {
      assertRunsTo(`fn main() { let x: i32 = -0x8000_0000; print(x); }`, [
        "-2147483648",
      ]);
    });

    it("i32 negated literal below min in comparison is rejected", () => {
      assertRejects(`fn main() { let x: i32 = 0; print(-0x8000_0001 == x); }`);
    });

    it("i32 negated literal at min in comparison is accepted", () => {
      assertRunsTo(
        `fn main() { let x: i32 = -0x8000_0000; print(-0x8000_0000 == x); }`,
        ["true"],
      );
    });

    it("i16 negation of zeroes", () => {
      assertRunsTo(`fn main() { let x: i16 = 0; print(-x == 0); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i16 = -0; print(-x == 0); }`, ["true"]);
    });

    it("i16 negation of ones", () => {
      assertRunsTo(`fn main() { let x: i16 = 1; print(-x == -1); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i16 = -1; print(-x == 1); }`, ["true"]);
    });

    it("i16 negation of max value", () => {
      assertRunsTo(`fn main() { let x: i16 = 0x7FFF; print(-x == -0x7FFF); }`, [
        "true",
      ]);
    });

    it("i16 assignment beyond max value", () => {
      assertRejects(`fn main() { let x: i16 = 0x8000; print(x); }`);
    });

    it("i16 assignment beyond min value", () => {
      assertRejects(`fn main() { let x: i16 = -0x8000; print(-x == 0x8000); }`);
    });

    it("i16 negation of min value", () => {
      assertRunsTo(`fn main() { let x: i16 = -0x8000; print(x); }`, ["-32768"]);
    });

    it("i16 negated literal below min in comparison is rejected", () => {
      assertRejects(`fn main() { let x: i16 = 0; print(-0x8001 == x); }`);
    });

    it("i16 negated literal at min in comparison is accepted", () => {
      assertRunsTo(`fn main() { let x: i16 = -0x8000; print(-0x8000 == x); }`, [
        "true",
      ]);
    });

    it("i8 negation of zeroes", () => {
      assertRunsTo(`fn main() { let x: i8 = 0; print(-x == 0); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i8 = -0; print(-x == 0); }`, ["true"]);
    });

    it("i8 negation of ones", () => {
      assertRunsTo(`fn main() { let x: i8 = 1; print(-x == -1); }`, ["true"]);
      assertRunsTo(`fn main() { let x: i8 = -1; print(-x == 1); }`, ["true"]);
    });

    it("i8 negation of max value", () => {
      assertRunsTo(`fn main() { let x: i8 = 0x7F; print(-x == -0x7F); }`, [
        "true",
      ]);
    });

    it("i8 assignment beyond max value", () => {
      assertRejects(`fn main() { let x: i8 = 0x80; print(x); }`);
    });

    it("i8 assignment beyond min value", () => {
      assertRejects(`fn main() { let x: i8 = -0x80; print(-x == 0x80); }`);
    });

    it("i8 negation of min value", () => {
      assertRunsTo(`fn main() { let x: i8 = -0x80; print(x); }`, ["-128"]);
    });

    it("i8 negated literal below min in comparison is rejected", () => {
      assertRejects(`fn main() { let x: i8 = 0; print(-0x81 == x); }`);
    });

    it("i8 negated literal at min in comparison is accepted", () => {
      assertRunsTo(`fn main() { let x: i8 = -0x80; print(-0x80 == x); }`, [
        "true",
      ]);
    });
  });

  describe("type propagation through bindings", (): void => {
    it("propagates type through a single binding alias", (): void => {
      assertCompilesClean(`fn main() { let x = 1u32; let y: u32 = x; }`);
    });

    it("rejects a type mismatch through a binding alias", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = 1u32; let y = x; let z: str = y; }`,
        "type mismatch",
      );
    });

    it("propagates type through a three-step chain at runtime", (): void => {
      assertRunsTo(
        `fn main() { let x = 1u32; let y = x; let z = y; print(z); }`,
        ["1"],
      );
    });
  });

  describe("type-check rejections", (): void => {
    it("rejects non-numeric arithmetic operands", (): void => {
      assertRejectsWithMessage(
        `fn main() { let _x = true + false; }`,
        "arithmetic operands must be numeric",
      );
    });

    it("rejects non-integer bitwise operands", (): void => {
      assertRejectsWithMessage(
        `fn main() { let _x = true & false; }`,
        "bitwise operations require integer operands",
      );
    });

    it("rejects float bitwise operands", (): void => {
      assertRejectsWithMessage(
        `fn main() { let _x = 1.0f32 & 2.0f32; }`,
        "bitwise operations require integer operands",
      );
    });

    it("rejects non-bool if condition", (): void => {
      assertRejectsWithMessage(
        `fn main() { if 1 { print("x"); } }`,
        "if condition must be `bool`",
      );
    });

    it("rejects mismatched if-else branch types", (): void => {
      assertRejectsWithMessage(
        `fn main() { let _x = if true { 1u32 } else { true }; }`,
        "if expression branches have incompatible types",
      );
    });

    it("rejects `Self` as a return type used outside any trait or impl", (): void => {
      assertRejectsWithMessage(
        `fn f() -> Self { }`,
        "can only be used inside a trait or impl block",
      );
    });

    it("rejects `Self` as a parameter type used outside any trait or impl", (): void => {
      assertRejectsWithMessage(
        `fn f(x: Self) { }`,
        "can only be used inside a trait or impl block",
      );
    });

    it("rejects `&Self` used outside any trait or impl", (): void => {
      assertRejectsWithMessage(
        `fn f(x: &Self) { }`,
        "can only be used inside a trait or impl block",
      );
    });

    it("does not cascade a second diagnostic when `Self` is rejected outside a trait or impl", (): void => {
      assertNoCascade(`fn f() -> Self { }`);
    });

    it("does not cascade a return-type-mismatch diagnostic when a `Self` return type has a non-unit body", (): void => {
      assertNoCascade(`fn f() -> Self { 1 }`);
    });

    it("does not cascade an annotation-mismatch diagnostic when a `Self`-annotated `let` has an initializer", (): void => {
      assertNoCascade(`fn main() { let x: Self = 1; print(x); }`);
    });

    it("does not cascade a return-type-mismatch diagnostic when a `&Self` return type has a mismatched body", (): void => {
      assertNoCascade(`fn f(x: &i32) -> &Self { x }`);
    });
  });

  describe("Self as a type - deferred resolution", (): void => {
    // TODO(Hedge-51): resolve Self to the enclosing impl's own type once
    // impl blocks parse.
    it.fails(
      "resolves `Self` to the enclosing impl's own type and compiles cleanly",
      (): void => {
        assertRunsTo(
          `
          struct Foo { x: i32 }
          impl Foo {
            fn make() -> Self { Foo { x: 1 } }
          }
          fn main() {
            let f = Foo::make();
            print(f.x);
          }
          `,
          ["1"],
        );
      },
    );

    // TODO(Hedge-54): resolve Self::Item to the trait's real associated type.
    it.fails(
      "resolves `Self::Item` to the trait's own associated type and compiles cleanly",
      (): void => {
        assertRunsTo(
          `
          trait Container {
            type Item;
            fn get(&self) -> Self::Item;
          }
          struct IntBox { value: i32 }
          impl Container for IntBox {
            type Item = i32;
            fn get(&self) -> Self::Item { self.value }
          }
          fn main() {
            let b = IntBox { value: 42 };
            print(b.get());
          }
          `,
          ["42"],
        );
      },
    );
  });

  describe("generic parameters in type position", (): void => {
    it("resolves a generic function's own type parameter used as a parameter type", (): void => {
      assertCompilesClean(`fn take<T>(x: T) {}`);
    });

    it("still rejects a name that matches no declared generic parameter", (): void => {
      assertRejectsWithMessage(
        `fn take<T>(x: U) {}`,
        "cannot find type `U` in this scope",
      );
    });

    it("compiles cleanly when only one of several declared type parameters is used", (): void => {
      assertCompilesClean(`fn take<T, U>(x: T) {}`);
    });

    it("resolves a generic function's own type parameter used as a return type", (): void => {
      assertCompilesClean(`fn identity<T>(x: T) -> T { x }`);
    });

    it("rejects a return type that names a different declared type parameter than the argument", (): void => {
      assertRejects(`fn f<T, U>(x: T) -> U { x }`);
    });

    it("compiles cleanly when a nested function's own generic parameter accepts an enclosing function's same-spelled one", (): void => {
      assertCompilesClean(
        `fn outer<T>(x: T) { fn inner<T>(y: T) {} inner(x); }`,
      );
    });

    it("compiles cleanly when a sibling function's own generic parameter accepts another function's same-spelled one", (): void => {
      assertCompilesClean(`fn a<T>(x: T) {} fn b<T>(y: T) { a(y); }`);
    });

    it("resolves a shared reference to a generic type parameter as a parameter type", (): void => {
      assertCompilesClean(`fn borrow<T>(x: &T) {}`);
    });

    it("resolves a mutable reference to a generic type parameter as a parameter type", (): void => {
      assertCompilesClean(`fn borrow_mut<T>(x: &mut T) {}`);
    });

    it("resolves a shared reference to a generic type parameter as a return type", (): void => {
      assertCompilesClean(`fn borrow_ret<T>(x: &T) -> &T { x }`);
    });

    it("resolves a mutable reference to a generic type parameter as a return type", (): void => {
      assertCompilesClean(`fn borrow_mut_ret<T>(x: &mut T) -> &mut T { x }`);
    });

    it("coexists with an explicit lifetime parameter declared alongside the type parameter", (): void => {
      assertCompilesClean(`fn borrow<'a, T>(x: &'a T) -> &'a T { x }`);
    });

    it("resolves a two-hop reference to a generic type parameter", (): void => {
      assertCompilesClean(
        `fn double_ref<'a, T>(x: &'a mut &'a T) -> &'a mut &'a T { x }`,
      );
    });

    it("still rejects an undeclared name under a reference to it", (): void => {
      assertRejectsWithMessage(
        `fn borrow<T>(x: &U) {}`,
        "cannot find type `U` in this scope",
      );
    });

    it("resolves a struct's own type parameter used as a field type", (): void => {
      assertCompilesClean(`struct Pair<T> { a: T, b: T }`);
    });

    it("resolves an enum's own type parameter used in a tuple variant", (): void => {
      assertCompilesClean(`enum Container<T> { Full(T), Empty }`);
    });

    it("resolves an enum's own type parameter used in a named-fields variant", (): void => {
      assertCompilesClean(`enum Wrapper<T> { Item { value: T } }`);
    });

    it("does not cascade a second diagnostic when only one of a struct's fields uses an undeclared name", (): void => {
      assertNoCascade(`struct Pair<T> { a: T, b: U }`);
    });

    it("does not let one generic struct's type parameter leak into an unrelated sibling struct", (): void => {
      const result = compileHedgeCode(`struct A<T> { a: T } struct B { b: T }`);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-NAME-001");
    });

    it("does not let an enclosing generic function's type parameter leak into a struct declared inside its body", (): void => {
      assertRejectsWithMessage(
        `fn outer<T>(x: T) { struct Inner { y: T } }`,
        "cannot find type `T` in this scope",
      );
    });

    it("does not let an enclosing generic function's type parameter leak into a local const's declared type", (): void => {
      assertRejectsWithMessage(
        `fn outer<T>() { const C: T = 1; }`,
        "cannot find type `T` in this scope",
      );
    });

    // TODO(Hedge-268): a generic parameter in an array's element-type
    // position resolves today only as a side effect of the surrounding
    // recursive type resolution, not by deliberate design - array-of-generic
    // has no considered construction/copy/move/codegen story yet. These pin
    // the rejection that gap calls for until the position gets real
    // semantics.
    it.fails(
      "still rejects a generic type parameter used as a fixed-size array's element type",
      (): void => {
        assertRejectsWithMessage(
          `struct Foo<T> { a: [T; 3] }`,
          "generic type parameter `T` is not supported as an array element type",
        );
      },
    );

    it.fails(
      "still rejects a generic type parameter used as an array element type behind a reference",
      (): void => {
        assertRejectsWithMessage(
          `fn f<T>(x: &[T; 3]) {}`,
          "generic type parameter `T` is not supported as an array element type",
        );
      },
    );

    it("still rejects an undeclared name that is not a primitive, struct, or enum, with no generics involved at all", (): void => {
      assertRejectsWithMessage(
        `fn f(x: Bogus) {}`,
        "cannot find type `Bogus` in this scope",
      );
    });

    it("resolves a type parameter carrying an inline trait bound, even though the bound itself is not checked yet", (): void => {
      assertCompilesClean(`fn f<T: Draw>(x: T) -> T { x }`);
    });

    it("resolves a type parameter whose name collides with a primitive type's name", (): void => {
      assertCompilesClean(`fn f<i32>(x: i32) {}`);
    });

    it("rejects a generic type parameter used with a type-argument list, since a bare type parameter takes none", (): void => {
      assertRejectsWithMessage(
        `fn f<T>(x: T<i32>) {}`,
        "generic type parameter `T` does not accept type arguments",
      );
    });
  });

  describe("generic call-site type inference", (): void => {
    it("infers a generic parameter from a single argument, with no annotation", (): void => {
      assertRunsTo(
        `
        fn identity<T>(x: T) -> T { x }
        fn main() { print(identity(5)); }
        `,
        ["5"],
      );
    });

    it("infers a generic parameter through a single reference-hop argument", (): void => {
      assertRunsTo(
        `
        fn peek<T>(x: &T) -> &T { x }
        fn main() { let v = 5; print(*peek(&v)); }
        `,
        ["5"],
      );
    });

    it("infers two independent generic parameters from two arguments in one call", (): void => {
      assertRunsTo(
        `
        fn first<A, B>(a: A, b: B) -> A { a }
        fn main() { print(first(1, "s")); }
        `,
        ["1"],
      );
    });

    it("infers a repeated generic parameter consistently across two occurrences", (): void => {
      assertRunsTo(
        `
        fn same<T>(a: T, b: T) -> T { a }
        fn main() { print(same(1, 2)); }
        `,
        ["1"],
      );
    });

    it("leaves an ordinary non-generic call unaffected", (): void => {
      assertRunsTo(
        `
        fn add(a: i32, b: i32) -> i32 { a + b }
        fn main() { print(add(1, 2)); }
        `,
        ["3"],
      );
    });

    it("infers a generic call nested inside another generic function's own body", (): void => {
      assertRunsTo(
        `
        fn outer<T>(x: T) -> T {
          fn inner<T>(y: T) -> T { y }
          inner(x)
        }
        fn main() { print(outer(42)); }
        `,
        ["42"],
      );
    });

    it("infers a composed generic call passed as another generic call's argument", (): void => {
      assertRunsTo(
        `
        fn identity<T>(x: T) -> T { x }
        fn main() { print(identity(identity(5))); }
        `,
        ["5"],
      );
    });

    it("reports a conflicting inference across two occurrences of the same parameter, blaming the second", (): void => {
      const result = compileHedgeCode(
        `fn same<T>(a: T, b: T) -> T { a } fn main() { print(same(1, "s")); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "argument 2 to function `same` type mismatch: expected `i32`, found `str`",
      );
      expect(errors[0]?.relatedSpans).toEqual([
        { span: { start: 57, end: 58 }, label: "inferred as `i32` here" },
      ]);
    });

    it("reports a conflicting inference through a reference-hop parameter, at the same reference depth on both sides", (): void => {
      const result = compileHedgeCode(
        `
        fn samer<'a, T>(a: &'a T, b: &T) -> &'a T { a }
        fn main() { let x = 1; let y = "s"; print(*samer(&x, &y)); }
        `,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "argument 2 to function `samer` type mismatch: expected `&i32`, found `&str`",
      );
      expect(errors[0]?.relatedSpans).toEqual([
        { span: { start: 114, end: 115 }, label: "inferred as `i32` here" },
      ]);
    });

    it("lets an explicit turbofish override inference for the parameter it names", (): void => {
      assertRunsTo(
        `
        fn identity<T>(x: T) -> T { x }
        fn main() { print(identity::<i32>(5)); }
        `,
        ["5"],
      );
    });

    it("reports a conflict when a turbofish disagrees with the actual argument, blaming the argument", (): void => {
      const result = compileHedgeCode(
        `fn identity<T>(x: T) -> T { x } fn main() { print(identity::<i32>("s")); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "argument 1 to function `identity` type mismatch: expected `i32`, found `str`",
      );
    });

    it("treats an empty turbofish as full inference rather than an arity error", (): void => {
      assertRunsTo(
        `
        fn identity<T>(x: T) -> T { x }
        fn main() { print(identity::<>(5)); }
        `,
        ["5"],
      );
    });

    it("rejects a non-empty turbofish whose argument count does not match the callee's declared generics", (): void => {
      const result = compileHedgeCode(
        `fn identity<T>(x: T) -> T { x } fn main() { print(identity::<i32, str>(5)); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-011");
      expect(errors[0]?.message).toBe(
        "`identity` declares 1 generic parameter(s), but the turbofish supplies 2",
      );
    });

    it("does not cascade a second diagnostic when a generic argument is already an unresolved name", (): void => {
      assertNoCascade(
        `fn same<T>(a: T, b: T) -> T { a } fn main() { print(same(undefined_name, 5)); }`,
      );
    });

    it("infers through a let binding's own type annotation, consistent with the argument", (): void => {
      assertRunsTo(
        `
        fn identity<T>(x: T) -> T { x }
        fn main() { let x: i32 = identity(5); print(x); }
        `,
        ["5"],
      );
    });

    it("reports a conflict between a let annotation's seeded type and the argument, blaming the argument", (): void => {
      const result = compileHedgeCode(
        `fn identity<T>(x: T) -> T { x } fn main() { let x: str = identity(5); print(x); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "argument 1 to function `identity` type mismatch: expected `str`, found `i32`",
      );
    });

    it("does not seed a struct field initializer's declared type into a generic call's inference", (): void => {
      const result = compileHedgeCode(
        `
        struct Box { v: str }
        fn identity<T>(x: T) -> T { x }
        fn main() { let b = Box { v: identity(5) }; print(b.v); }
        `,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-001");
      expect(errors[0]?.message).toBe(
        "field `v` type mismatch: expected `str`, found `i32`",
      );
    });

    it("infers through the enclosing function's own declared return type, consistent with the argument", (): void => {
      assertRunsTo(
        `
        fn identity<T>(x: T) -> T { x }
        fn wrap() -> i32 { identity(5) }
        fn main() { print(wrap()); }
        `,
        ["5"],
      );
    });

    it("reports a conflict between the enclosing function's return type and the argument, blaming the argument", (): void => {
      const result = compileHedgeCode(
        `
        fn identity<T>(x: T) -> T { x }
        fn wrap() -> str { identity(5) }
        fn main() { print(wrap()); }
        `,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "argument 1 to function `identity` type mismatch: expected `str`, found `i32`",
      );
    });

    it("reports a generic parameter that never appears in any parameter or return position as unsolved", (): void => {
      const result = compileHedgeCode(
        `fn discard<T>(x: i32) -> i32 { x } fn main() { print(discard(5)); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-006");
      expect(errors[0]?.message).toBe(
        "cannot infer type of generic parameter `T` without an explicit type annotation or turbofish",
      );
    });

    it("rescues an otherwise-unsolved generic parameter via an explicit turbofish", (): void => {
      assertRunsTo(
        `
        fn discard<T>(x: i32) -> i32 { x }
        fn main() { print(discard::<str>(5)); }
        `,
        ["5"],
      );
    });

    it("coerces an unsuffixed literal argument against the already-resolved concrete type", (): void => {
      assertRunsTo(
        `
        fn same<T>(a: T, b: T) -> T { a }
        fn main() { print(same(5i64, 2)); }
        `,
        ["5"],
      );
    });

    it("range-checks a negative unsuffixed literal against the already-resolved concrete type", (): void => {
      const result = compileHedgeCode(
        `fn same<T>(a: T, b: T) -> T { a } fn main() { print(same(5i8, -200)); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-005");
      expect(errors[0]?.message).toBe("out of range for i8");
    });

    it("reports a structural mismatch (non-reference argument for a reference-hop parameter) as an ordinary type mismatch, not an unsolved variable", (): void => {
      const result = compileHedgeCode(
        `
        fn borrow<T>(x: &T) -> &T { x }
        fn main() { let v = 5; print(*borrow(v)); }
        `,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-001");
      expect(errors[0]?.message).toBe(
        "argument 1 to function `borrow` type mismatch: expected `&T`, found `i32`",
      );
    });

    it("reports a mutability mismatch on a reference-hop parameter as an ordinary type mismatch", (): void => {
      const result = compileHedgeCode(
        `
        fn borrowmut<T>(x: &mut T) {}
        fn main() { let v = 5; borrowmut(&v); }
        `,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-001");
      expect(errors[0]?.message).toBe(
        "argument 1 to function `borrowmut` type mismatch: expected `&mut T`, found `&i32`",
      );
    });

    it("does not cascade a second diagnostic when the enclosing function's return type is Self used outside a trait or impl", (): void => {
      assertNoCascade(
        `fn identity<T>(x: T) -> T { x } fn make() -> Self { identity(5) }`,
      );
    });

    it("does not cascade a second diagnostic when a let binding's annotation is Self used outside a trait or impl", (): void => {
      assertNoCascade(
        `fn identity<T>(x: T) -> T { x } fn main() { let x: Self = identity(5); print(x); }`,
      );
    });

    it("does not cascade a second diagnostic when a turbofish argument is Self used outside a trait or impl", (): void => {
      assertNoCascade(
        `fn identity<T>(x: T) -> T { x } fn main() { print(identity::<Self>(5)); }`,
      );
    });

    it("does not cascade an unsolved-variable diagnostic on top of a wrong-arity generic call", (): void => {
      assertNoCascade(
        `fn identity<T>(x: T) -> T { x } fn main() { identity(); }`,
      );
    });

    it("does not cascade an unsolved-variable diagnostic per parameter on a wrong-arity multi-generic call", (): void => {
      const result = compileHedgeCode(
        `fn pair<A, B>(a: A, b: B) -> A { a } fn main() { print(pair(1)); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-008");
    });

    it("does not cascade a second diagnostic when a turbofish conflicts with a let annotation", (): void => {
      const result = compileHedgeCode(
        `fn identity<T>(x: T) -> T { x } fn main() { let y: str = identity::<i32>(5); print(y); }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "call to `identity` type mismatch: expected `i32`, found `str`",
      );
    });

    it("does not cascade a second diagnostic when a turbofish conflicts with the enclosing function's return type", (): void => {
      const result = compileHedgeCode(
        `
        fn identity<T>(x: T) -> T { x }
        fn wrap() -> str { identity::<i32>(5) }
        fn main() { print(wrap()); }
        `,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("HEDGE-TYPE-010");
      expect(errors[0]?.message).toBe(
        "call to `identity` type mismatch: expected `i32`, found `str`",
      );
    });
  });

  describe("unused generic type parameters on a struct or enum", (): void => {
    it("rejects a struct's own type parameter that appears in none of its fields", (): void => {
      const result = compileHedgeCode(`struct Triple<A, B, C> { a: A, c: C }`);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe(
        "type parameter `B` is declared but never used",
      );
    });

    it("reports each unused type parameter separately", (): void => {
      const result = compileHedgeCode(`struct Foo<X, Y> {}`);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.map((e) => e.message)).toEqual([
        "type parameter `X` is declared but never used",
        "type parameter `Y` is declared but never used",
      ]);
    });

    it("does not reject a type parameter used more than once", (): void => {
      assertCompilesClean(`struct Pair<T> { a: T, b: T }`);
    });

    it("rejects an enum's own type parameter that appears in none of its variants", (): void => {
      const result = compileHedgeCode(
        `enum Container<T, U> { Full(T), Empty }`,
      );
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe(
        "type parameter `U` is declared but never used",
      );
    });

    it("does not reject a type parameter used only as an array element type", (): void => {
      const result = compileHedgeCode(`struct Foo<T> { a: [T; 3] }`);
      const unusedErrors = result.diagnostics.filter((d) =>
        d.message.includes("never used"),
      );
      expect(unusedErrors).toEqual([]);
    });

    it("rejects a type parameter used only in a trait bound, since a bound alone does not count as usage", (): void => {
      assertRejectsWithMessage(
        `struct Foo<T: Draw> { x: i32 }`,
        "type parameter `T` is declared but never used",
      );
    });
  });

  describe("array types", (): void => {
    it("reads back the correct element for a literal in-range index", (): void => {
      assertRunsTo(
        `
        fn main() {
          let arr: [i32; 3] = [10, 20, 30];
          print(arr[0]);
          print(arr[1]);
          print(arr[2]);
        }
      `,
        ["10", "20", "30"],
      );
    });

    it("reads back the correct element for a dynamic usize-typed index", (): void => {
      assertRunsTo(
        `
        fn main() {
          let arr: [i32; 3] = [10, 20, 30];
          let i: usize = 1;
          print(arr[i]);
        }
      `,
        ["20"],
      );
    });

    it("reads back all elements of a repeat-form array literal", (): void => {
      assertRunsTo(
        `
        fn main() {
          let arr: [i32; 3] = [7; 3];
          print(arr[0]);
          print(arr[1]);
          print(arr[2]);
        }
      `,
        ["7", "7", "7"],
      );
    });

    it("reflects a write through an index on a mut array binding", (): void => {
      assertRunsTo(
        `
        fn main() {
          let mut arr: [i32; 3] = [1, 2, 3];
          arr[1] = 99;
          print(arr[0]);
          print(arr[1]);
          print(arr[2]);
        }
      `,
        ["1", "99", "3"],
      );
    });

    it("moves an array into a new binding and runs cleanly, including scope-end disposal, without a runtime crash", (): void => {
      // [T; N] is move-only, not Copy (even with Copy elements - a JS
      // Array/TypedArray is itself a reference type, so a naive copy would
      // alias rather than duplicate). This exercises the move (only `b` is
      // used afterward, matching move-check.ts's own compile-time rules)
      // and confirms the array-disposer helper doesn't crash at scope exit.
      assertRunsTo(
        `
        fn main() {
          let mut a: [i32; 3] = [1, 2, 3];
          let mut b = a;
          b[0] = 99;
          print(b[0]);
          print(b[1]);
        }
      `,
        ["99", "2"],
      );
    });

    it("indexes into an array of non-Copy struct elements and disposes it cleanly at scope end", (): void => {
      // A struct element is move-only just like the array itself; this
      // exercises the recursive array-disposer helper against a real
      // non-Copy element type (the case #201 originally deferred), calling
      // each struct's own [Symbol.dispose] without crashing at scope exit.
      assertRunsTo(
        `
        struct Boxed { value: i32 }
        fn main() {
          let arr = [Boxed { value: 1 }, Boxed { value: 2 }];
          print(arr[0].value);
          print(arr[1].value);
        }
      `,
        ["1", "2"],
      );
    });

    it("throws a runtime RangeError reading a dynamic out-of-range index, rather than silently returning undefined", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let arr: [i32; 3] = [1, 2, 3];
          let i: usize = 5;
          print(arr[i]);
        }
      `);
      expect(result?.exitCode).not.toBe(0);
    });

    it("throws a runtime RangeError writing a dynamic out-of-range index, rather than silently growing the array", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let mut arr: [i32; 3] = [1, 2, 3];
          let i: usize = 5;
          arr[i] = 99;
        }
      `);
      expect(result?.exitCode).not.toBe(0);
    });

    it("does not throw reading or writing a dynamic in-range index", (): void => {
      assertRunsTo(
        `
        fn main() {
          let mut arr: [i32; 3] = [1, 2, 3];
          let i: usize = 2;
          arr[i] = 99;
          print(arr[i]);
        }
      `,
        ["99"],
      );
    });

    it("accepts a const-evaluated array length, not just a literal integer", (): void => {
      assertRunsTo(
        `
          const N: usize = 3;
          fn main() {
            let arr: [i32; N] = [1, 2, 3];
            print(arr[0]);
            print(arr[1]);
            print(arr[2]);
          }
        `,
        ["1", "2", "3"],
      );
    });

    it("writes through a &mut reference to a dynamic array index without crashing", (): void => {
      assertRunsTo(
        `
        fn main() {
          let mut arr: [i32; 3] = [1, 2, 3];
          let i: usize = 1;
          let r = &mut arr[i];
          *r = 99;
          print(arr[0]);
          print(arr[1]);
          print(arr[2]);
        }
      `,
        ["1", "99", "3"],
      );
    });

    it("keeps a &mut arr[i] reference pinned to the index's value at creation time, even if the index variable changes afterward", (): void => {
      assertRunsTo(
        `
        fn main() {
          let mut arr: [i32; 3] = [1, 2, 3];
          let mut i: usize = 0;
          let r = &mut arr[i];
          i = 2;
          *r = 99;
          print(arr[0]);
          print(arr[2]);
        }
      `,
        ["99", "3"],
      );
    });

    it("mutates through an index borrowed from an array reached via an existing &mut reference", (): void => {
      // `r[0]` first reaches through `r`'s own reference cell via `.v`, then
      // the borrowed index place gets its own capturing cell.
      assertRunsTo(
        `
        fn bump(r: &mut [i32; 3]) {
          let cell = &mut r[0];
          *cell = *cell + 1;
        }
        fn main() {
          let mut arr: [i32; 3] = [1, 2, 3];
          bump(&mut arr);
          print(arr[0]);
        }
      `,
        ["2"],
      );
    });
  });

  describe("const and static", (): void => {
    it("uses a const's folded value in runtime arithmetic", (): void => {
      assertRunsTo(
        `
        const MAX: i32 = 100;
        fn main() { print(MAX + 1); }
      `,
        ["101"],
      );
    });

    it("chains a const reference to another const correctly at runtime", (): void => {
      assertRunsTo(
        `
        const A: i32 = 2;
        const B: i32 = A * 3;
        fn main() { print(B); }
      `,
        ["6"],
      );
    });

    it("initializes a static lazily, exactly once, on first access", (): void => {
      assertRunsTo(
        `
        fn make() -> i32 {
          print("init");
          42
        }
        static X: i32 = make();
        fn main() {
          print(X);
          print(X);
        }
      `,
        ["init", "42", "42"],
      );
    });

    it("runs a static's initializer on first access, not eagerly at module load", (): void => {
      assertRunsTo(
        `
        fn make() -> i32 {
          print("init");
          42
        }
        static X: i32 = make();
        fn main() {
          print("before");
          print(X);
        }
      `,
        ["before", "init", "42"],
      );
    });

    it("initializes a unit-typed static exactly once, not on every access", (): void => {
      // Regression: a unit-returning function's trailing expression never
      // gets an explicit `return` (see jsim.ts's jsimTailStatements), so
      // `make()` here returns JS `undefined` - a lazy-init built on `??=`
      // treats `undefined` as "not yet initialized" and re-runs the
      // initializer on every single access instead of caching it once.
      assertRunsTo(
        `
        fn make() -> () {
          print("init");
        }
        static X: () = make();
        fn main() {
          X;
          X;
          print("done");
        }
      `,
        ["init", "done"],
      );
    });

    it("resolves a static referencing a const in its initializer", (): void => {
      assertRunsTo(
        `
        const BASE: i32 = 10;
        static COUNT: i32 = BASE + 1;
        fn main() { print(COUNT); }
      `,
        ["11"],
      );
    });

    it("executes an array whose [T; N] length is const-resolved", (): void => {
      assertRunsTo(
        `
        const N: usize = 3;
        fn main() {
          let arr: [i32; N] = [1, 2, 3];
          print(arr[0]);
          print(arr[1]);
          print(arr[2]);
        }
      `,
        ["1", "2", "3"],
      );
    });

    it("executes a repeat-form array whose count is const-resolved", (): void => {
      assertRunsTo(
        `
        const N: usize = 3;
        fn main() {
          let arr = [7; N];
          print(arr[0]);
          print(arr[2]);
        }
      `,
        ["7", "7"],
      );
    });
  });
});
