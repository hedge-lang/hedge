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
describe("must-fail corpus - rejection tests", (): void => {
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

    it("rejects use of name after binding", (): void => {
      assertRejects(`fn main() { let x = 1; print(y); }`);
    });

    it("rejects access to block-scoped variable after block exits", (): void => {
      assertRejectsWithMessage(
        `fn main() { { let inner = 1; } print(inner); }`,
        "inner",
      );
    });
  });

  describe("borrow checker errors", (): void => {
    it("rejects &mut of immutable binding", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = "a"; let r = &mut x; print(r); }`,
        "not declared mut",
      );
    });

    it("rejects overlapping mutable borrows", (): void => {
      assertRejectsWithMessage(
        `fn main() {
          let mut x = "a";
          let r1 = &mut x;
          let r2 = &mut x;
          print(r1);
          print(r2);
        }`,
        "Conflicting",
      );
    });

    it("accepts sequential mutable borrows (NLL)", (): void => {
      assertCompilesClean(`
        fn main() {
          let mut x = "a";
          let r1 = &mut x;
          print(r1);
          let r2 = &mut x;
          print(r2);
        }
      `);
    });

    it("accepts many shared borrows", (): void => {
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
          let mut x = "a";
          let rw = &mut x;
          let r = &x;
          print(rw);
          print(r);
        }`,
        "Conflicting borrows",
      );
    });

    describe("ownership move errors", (): void => {
      it("rejects reading moved struct value", (): void => {
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

      it("rejects double move of the same owned binding", (): void => {
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
          let mut x = "a";
          let r = &x;
          let rw = &mut x;
          print(r);
          print(rw);
        }`,
        "Conflicting borrows",
      );
    });

    it("accepts a second mutable borrow when the first borrow has no uses", (): void => {
      assertCompilesClean(`
        fn main() {
          let mut x = "a";
          let r1 = &mut x;
          let r2 = &mut x;
          print(r2);
        }
      `);
    });
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
      assertRejectsWithMessage(`fn main() { let x = 1;`, "end of input");
    });
  });

  describe("type errors", (): void => {
    it("rejects comparisons with right-side boolean", (): void => {
      assertRejectsWithMessage(`fn main() { let x = 1 < (2 < 3); }`, "type");
    });

    it("rejects comparisons with left-side boolean", (): void => {
      assertRejectsWithMessage(`fn main() { let x = (1 < 2) < 3; }`, "type");
    });

    it("rejects direct assignment to immutable let binding", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = 1; x = 2; print(x); }`,
        "immutable",
      );
    });

    it("rejects compound assignment to immutable let binding", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = 1; x += 1; print(x); }`,
        "immutable",
      );
    });

    it("rejects integer as boolean condition in if", (): void => {
      assertRejectsWithMessage(`fn main() { if 1 { print("yes"); } }`, "bool");
    });

    it("rejects string as boolean condition in if", (): void => {
      assertRejectsWithMessage(
        `fn main() { if "yes" { print("yes"); } }`,
        "bool",
      );
    });

    it("rejects arithmetic on boolean operands", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = true + 1; print(x); }`,
        "numeric",
      );
    });

    it("rejects arithmetic on a genuinely unit-typed operand", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = print("hi") + 1; }`,
        "numeric",
      );
    });

    it("rejects a non-unit return type with no trailing expression", (): void => {
      assertRejectsWithMessage(`fn f() -> i32 {} fn main() {}`, "return");
    });

    it("rejects equality comparison between mismatched types", (): void => {
      assertRejectsWithMessage(`fn main() { print(1 == "1"); }`, "type");
    });

    it("rejects equality comparison between a genuinely unit-typed operand and a mismatched type", (): void => {
      assertRejectsWithMessage(
        `fn noop() {} fn main() { print(noop() == 5); }`,
        "type",
      );
    });

    it("rejects let binding type annotation mismatch: integer vs bool annotation", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x: bool = 5; print(x); }`,
        "type",
      );
    });

    it("rejects float assigned to i32-annotated binding", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x: i32 = 3.14; print(x); }`,
        "type",
      );
    });

    it("rejects function return type mismatch", (): void => {
      assertRejectsWithMessage(
        `fn bad() -> i32 { "x" } fn main() { print(bad()); }`,
        "i32",
      );
    });

    it("rejects struct field value type mismatch (bool vs i32)", (): void => {
      assertRejectsWithMessage(
        `struct P { x: i32 } fn main() { let p = P { x: true }; print(p.x); }`,
        "type",
      );
    });
  });

  describe("string type restrictions", (): void => {
    it("rejects string operand in arithmetic expression", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = "hello" + 1; print(x); }`,
        "type",
      );
    });

    it("rejects string-to-string addition", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = "hello" + " world"; print(x); }`,
        "type",
      );
    });

    it("rejects string in cross-type equality comparison", (): void => {
      assertRejectsWithMessage(`fn main() { print("hello" == 1); }`, "type");
    });
  });

  describe("struct validation errors", (): void => {
    it("rejects struct literal with missing required field", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32, y: i32 } fn main() { let f = Foo { x: 1 }; print(f.x); }`,
        "field",
      );
    });

    it("rejects struct literal with unknown field", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32 } fn main() { let f = Foo { x: 1, z: 2 }; print(f.x); }`,
        "field",
      );
    });

    it("rejects access to undefined struct field", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32 } fn main() { let f = Foo { x: 1 }; print(f.z); }`,
        "field",
      );
    });

    it("rejects field access on non-struct type", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x = 5; print(x.value); }`,
        "field",
      );
    });

    it("does not cascade errors from unresolved struct name", (): void => {
      assertNoCascade(
        `struct Foo { x: i32 } fn main() { let f = Bogus { x: 1 }; print(f.x); }`,
      );
    });

    it("rejects field access on resolved primitive field type", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32 } fn main() { let f = Foo { x: 1 }; print(f.x.y); }`,
        "field",
      );
    });

    it("rejects struct literal with simultaneous unknown and missing fields", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32, y: i32 } fn main() { let f = Foo { x: 1, z: 2 }; }`,
        "field",
      );
    });

    it("rejects fields in unit struct literal", (): void => {
      assertRejectsWithMessage(
        `struct Foo; fn main() { let f = Foo { x: 1 }; }`,
        "field",
      );
    });

    it("rejects field access using another struct's field name", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32 } struct Bar { y: i32 } fn main() { let f = Foo { x: 1 }; print(f.y); }`,
        "field",
      );
    });

    it("rejects duplicate field in struct literal", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32 } fn main() { let f = Foo { x: 1, x: 2 }; }`,
        "field",
      );
    });

    it("rejects duplicate struct declaration", (): void => {
      assertRejectsWithMessage(
        `struct Foo { x: i32 } struct Foo { y: i32 } fn main() { }`,
        "defined more than once",
      );
    });
  });

  describe("diagnostic non-cascade", (): void => {
    it("does not emit spurious diagnostics for single missing name", (): void => {
      assertNoCascade(`fn main() { let x = missing_var + 1; }`);
    });

    it("does not cascade a return-type-mismatch diagnostic for an unresolved trailing name", (): void => {
      assertNoCascade(`fn bad() -> i32 { unknown_name }`);
    });

    it("does not cascade a field-type-mismatch diagnostic for an unresolved field value", (): void => {
      assertNoCascade(
        `struct P { x: i32 } fn main() { let p = P { x: unknown_name }; }`,
      );
    });
  });

  describe("slice 1 restrictions", (): void => {
    it("rejects generic types (not in Slice 1)", (): void => {
      assertRejectsWithMessage(
        `fn main() { let x: Vec<i32> = Vec::new(); }`,
        "not supported in Slice 1",
      );
    });

    it("rejects non-primitive parameter type in function signature (Slice 1)", (): void => {
      assertRejectsWithMessage(
        `fn foo(x: MyStruct) {} fn main() {}`,
        "not supported",
      );
    });
  });
});
