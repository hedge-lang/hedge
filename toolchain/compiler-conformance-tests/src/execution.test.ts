import { describe, it, expect } from "vitest";
import {
  executeHedgeCode,
  compileHedgeCode,
  hasCompileErrors,
  assertRunsTo,
  assertCompilesClean,
  assertRejectsWithMessage,
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
      // -8 in binary: 1111…1000; >> 1 = 1111…1100 = -4
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

    it("let write rebinding updates the value", (): void => {
      assertRunsTo(`fn main() { let write x = 1; x = 2; print(x); }`, ["2"]);
    });

    it("let bind modifier compiles and executes", (): void => {
      assertRunsTo(`fn main() { let bind x = 5; print(x); }`, ["5"]);
    });

    it("type annotation on let binding compiles correctly", (): void => {
      assertRunsTo(`fn main() { let x: i32 = 5; print(x); }`, ["5"]);
    });

    it("compound assignment += updates a let write binding", (): void => {
      assertRunsTo(`fn main() { let write x = 1; x += 5; print(x); }`, ["6"]);
    });

    it("compound assignment -= updates a let write binding", (): void => {
      assertRunsTo(`fn main() { let write x = 10; x -= 3; print(x); }`, ["7"]);
    });

    it("multiple assignments to let write binding update sequentially", (): void => {
      assertRunsTo(`fn main() { let write x = 1; x = 2; x = 3; print(x); }`, [
        "3",
      ]);
    });

    it.fails("inner scope shadow does not affect outer binding", (): void => {
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

    it.fails("variable shadowing emits correct output", (): void => {
      // compiler bug: JSIM lowers both bindings to `const`, which is illegal in JS block scope
      assertRunsTo(`fn main() { let x = 1; let x = 2; print(x); }`, ["2"]);
    });
  });

  describe("literal types", (): void => {
    it("float literal prints correctly", (): void => {
      assertRunsTo(`fn main() { let x = 3.14; print(x); }`, ["3.14"]);
    });

    it("char literal prints as its character", (): void => {
      assertRunsTo(`fn main() { let c = 'A'; print(c); }`, ["A"]);
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

    it("i32 addition wraps on overflow (two's complement)", (): void => {
      assertRunsTo(`fn main() { print(2147483647 + 1); }`, ["-2147483648"]);
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
  });
});
