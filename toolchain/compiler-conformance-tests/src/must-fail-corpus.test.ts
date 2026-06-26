import { describe, it, expect } from "vitest";
import {
  compileHedgeCode,
  assertRejects,
  assertRejectsWithMessage,
  assertNoCascade,
  assertCompilesClean,
} from "./test-harness.js";

/**
 * Test corpus for programs that must be rejected by the compiler.
 * Each test validates that a specific error category is caught.
 */
describe("must-fail corpus — rejection tests", (): void => {
  describe("name resolution errors", (): void => {
    it("rejects undefined variable in expression", (): void => {
      assertRejectsWithMessage(
        `fn main() { print(undefined_name); }`,
        "undefined_name",
      );
    });

    it("rejects undefined function call", (): void => {
      assertRejects(`fn main() { undefined_fn(1, 2); }`);
    });

    it("rejects call to function name not in scope", (): void => {
      assertRejects(`
        fn add(a: i32, b: i32) { print(a + b); }
        fn main() { add(2, 3); }
      `);
    });

    it("rejects multiple calls to function name not in scope", (): void => {
      assertRejects(`
        fn double(x: i32) { print(x * 2); }
        fn main() { double(3); double(6); }
      `);
    });

    it("rejects use of name after binding", (): void => {
      assertRejects(`fn main() { let x = 1; print(y); }`);
    });

    it.fails(
      "rejects access to block-scoped variable after block exits",
      (): void => {
        assertRejectsWithMessage(
          `fn main() { { let inner = 1; } print(inner); }`,
          "inner",
        );
      },
    );
  });

  describe("borrow checker errors", (): void => {
    it("rejects &write of immutable binding", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = "a"; let r = &write x; print(r); }`,
        "not declared write",
      );
    });

    it("rejects overlapping mutable borrows", (): void => {
      assertRejectsWithMessage(
        `fn main() {
          let write x = "a";
          let r1 = &write x;
          let r2 = &write x;
          print(r1);
          print(r2);
        }`,
        "Conflicting",
      );
    });

    it.fails("accepts sequential mutable borrows (NLL)", (): void => {
      assertCompilesClean(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          print(r1);
          let r2 = &write x;
          print(r2);
        }
      `);
    });

    it.fails("accepts many shared borrows", (): void => {
      assertCompilesClean(`
        fn main() {
          let x = "a";
          let r1 = &x;
          let r2 = &x;
          let r3 = &x;
          print(r1);
          print(r2);
          print(r3);
        }
      `);
    });
  });

  describe("borrow checker edge cases", (): void => {
    it("rejects shared borrow while mutable borrow is still live", (): void => {
      assertRejectsWithMessage(
        `fn main() {
          let write x = "a";
          let rw = &write x;
          let r = &x;
          print(rw);
          print(r);
        }`,
        "Conflicting borrows",
      );
    });

    describe("ownership move errors", (): void => {
      it.fails("rejects reading moved struct value", (): void => {
        assertRejectsWithMessage(
          `
          struct Boxed { value: i32 }
          fn main() {
            let x = Boxed { value: 1 };
            let y = x;
            print(x.value);
            print(y.value);
          }
        `,
          "moved",
        );
      });

      it.fails("rejects double move of the same owned binding", (): void => {
        assertRejectsWithMessage(
          `
          struct Boxed { value: i32 }
          fn main() {
            let x = Boxed { value: 1 };
            let y = x;
            let z = x;
            print(y.value);
            print(z.value);
          }
        `,
          "moved",
        );
      });
    });

    it("rejects mutable borrow while shared borrow is still live", (): void => {
      assertRejectsWithMessage(
        `fn main() {
          let write x = "a";
          let r = &x;
          let rw = &write x;
          print(r);
          print(rw);
        }`,
        "Conflicting borrows",
      );
    });

    it.fails(
      "accepts a second mutable borrow when the first borrow has no uses",
      (): void => {
        assertCompilesClean(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          let r2 = &write x;
          print(r2);
        }
      `);
      },
    );
  });

  describe("diagnostic span precision", (): void => {
    it("points unresolved-name diagnostic span at the missing identifier", (): void => {
      const source = "fn main() { print(missing_name); }";
      const result = compileHedgeCode(source);
      const firstError = result.diagnostics.find((d) => d.severity === "error");
      expect(firstError?.span.kind).toBe("Some");
      if (firstError?.span.kind === "Some") {
        expect(
          source.slice(firstError.span.value.start, firstError.span.value.end),
        ).toBe("missing_name");
      }
    });
  });

  describe("operator restrictions", (): void => {
    it("rejects chained non-associative comparison operators", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = 1 < 2 < 3; }`,
        "cannot chain",
      );
    });
  });

  describe("syntax errors", (): void => {
    it("rejects unclosed function", (): void => {
      assertRejectsWithMessage(`fn main(`, "eof");
    });

    it("rejects missing semicolon in let", (): void => {
      assertRejectsWithMessage(`fn main() { let x = 1 }`, "Expected semi");
    });

    it("rejects unclosed block", (): void => {
      assertRejectsWithMessage(`fn main() { let x = 1;`, "eof");
    });
  });

  describe("type errors", (): void => {
    it.fails("rejects comparisons with right-side boolean", (): void => {
      assertRejectsWithMessage(`fn main() { let x = 1 < (2 < 3); }`, "types");
    });

    it.fails("rejects comparisons with left-side boolean", (): void => {
      assertRejectsWithMessage(`fn main() { let x = (1 < 2) < 3; }`, "types");
    });

    it.fails("rejects direct assignment to immutable let binding", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = 1; x = 2; print(x); }`,
        "immutable",
      );
    });

    it.fails(
      "rejects compound assignment to immutable let binding",
      (): void => {
        assertRejectsWithMessage(
          `fn main() { let x = 1; x += 1; print(x); }`,
          "immutable",
        );
      },
    );

    it.fails("rejects integer as boolean condition in if", (): void => {
      assertRejectsWithMessage(`fn main() { if 1 { print("yes"); } }`, "bool");
    });

    it.fails("rejects string as boolean condition in if", (): void => {
      assertRejectsWithMessage(
        `fn main() { if "yes" { print("yes"); } }`,
        "bool",
      );
    });

    it.fails("rejects arithmetic on boolean operands", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = true + 1; print(x); }`,
        "bool",
      );
    });

    it.fails(
      "rejects equality comparison between mismatched types",
      (): void => {
        assertRejectsWithMessage(`fn main() { print(1 == "1"); }`, "type");
      },
    );
  });

  describe("string type restrictions", (): void => {
    it.fails("rejects string operand in arithmetic expression", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = "hello" + 1; print(x); }`,
        "type",
      );
    });

    it.fails("rejects string-to-string addition", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = "hello" + " world"; print(x); }`,
        "type",
      );
    });

    it.fails("rejects string in cross-type equality comparison", (): void => {
      assertRejectsWithMessage(`fn main() { print("hello" == 1); }`, "type");
    });
  });

  describe("diagnostic non-cascade", (): void => {
    it("does not emit spurious diagnostics for single missing name", (): void => {
      assertNoCascade(`fn main() { let x = missing_var + 1; }`);
    });
  });

  describe("slice 1 restrictions", (): void => {
    it("rejects generic types (not in Slice 1)", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x: Vec<i32> = Vec::new(); }`,
        "Expected semi",
      );
    });

    it("rejects match expressions (not in Slice 1)", (): void => {
      assertRejectsWithMessage(
        `fn main() { match 5 { 1 => print("one"), _ => print("other"), } }`,
        "Expected an expression",
      );
    });

    it("rejects enum definitions (not in Slice 1)", (): void => {
      assertRejectsWithMessage(
        `enum Status { Ok, Err, } fn main() {}`,
        "not supported in Slice 1",
      );
    });

    it("rejects non-primitive parameter type in function signature", (): void => {
      assertRejectsWithMessage(
        `fn foo(x: MyStruct) {} fn main() {}`,
        "not supported in Slice 1 function signatures",
      );
    });
  });
});
