import { describe, it, expect } from "vitest";
import {
  executeHedgeCode,
  compileHedgeCode,
  hasCompileErrors,
} from "./test-harness.js";

describe("execution tests", (): void => {
  describe("basic output", (): void => {
    it("prints a string literal", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print("Hello");
        }
      `);
      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["Hello"]);
    });

    it("prints a variable", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let msg = "world";
          print(msg);
        }
      `);
      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["world"]);
    });

    it("prints multiple values", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print("first");
          print("second");
          print("third");
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["first", "second", "third"]);
    });
  });

  describe("arithmetic", (): void => {
    it("evaluates 1 + 2 correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 1 + 2;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("3");
    });

    it("respects operator precedence", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 1 + 2 * 3;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("7");
    });

    it("handles subtraction", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 10 - 3;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("7");
    });

    it("handles multiplication", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 4 * 5;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("20");
    });

    it("handles division", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 20 / 4;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("5");
    });

    it("handles modulo", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(10 % 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("1");
    });

    it("handles unary negation", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 5;
          print(-x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("-5");
    });

    it("handles boolean not", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(!true);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("false");
    });

    it("handles negative integer literals", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = -5;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("-5");
    });

    it("division before addition in mixed expression", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(6 / 2 + 1);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("4");
    });

    it("subtraction is left-associative", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(10 - 3 - 2);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("5");
    });

    it("bitwise AND", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(6 & 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("2");
    });

    it("bitwise OR", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(6 | 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("7");
    });

    it("bitwise XOR", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(6 ^ 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("5");
    });

    it("shift left", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(1 << 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("8");
    });

    it("shift right", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(16 >> 2);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("4");
    });
  });

  describe("control flow", (): void => {
    it("executes if-true branch", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          if true {
            print("yes");
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["yes"]);
    });

    it("skips if-false branch", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          if false {
            print("no");
          };
          print("after");
        }
      `);
      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["after"]);
    });

    it("executes if-else correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          if false {
            print("no");
          } else {
            print("yes");
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["yes"]);
    });

    it("chains else-if correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 2;
          if x == 1 {
            print("one");
          } else if x == 2 {
            print("two");
          } else {
            print("other");
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["two"]);
    });

    it("if expression as let initializer", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = if true { 1 } else { 2 };
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("1");
    });
  });

  describe("comparisons", (): void => {
    it("evaluates == correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          if 5 == 5 {
            print("equal");
          } else {
            print("not equal");
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["equal"]);
    });

    it("evaluates < correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          if 3 < 5 {
            print("yes");
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["yes"]);
    });

    it("evaluates > correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          if 10 > 5 {
            print("yes");
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["yes"]);
    });

    it("evaluates != correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(3 != 4);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("true");
    });

    it("evaluates <= correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(3 <= 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("true");
    });

    it("evaluates >= correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(5 >= 3);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("true");
    });

    it("evaluates && correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(true && false);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("false");
    });

    it("evaluates || correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(false || true);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("true");
    });
  });

  describe("blocks and scopes", (): void => {
    it("executes block statements", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 1;
          {
            let y = 2;
            print(x + y);
          }
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("3");
    });

    it("block with trailing expression", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = {
            let a = 5;
            let b = 3;
            a + b
          };
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("8");
    });

    it("let write rebinding updates the value", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let write x = 1;
          x = 2;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("2");
    });

    it("let bind modifier compiles and executes", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let bind x = 5;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("5");
    });

    it("type annotation on let binding compiles correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x: i32 = 5;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("5");
    });

    it("compound assignment += updates a let write binding", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let write x = 1;
          x += 5;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("6");
    });

    it("compound assignment -= updates a let write binding", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let write x = 10;
          x -= 3;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("7");
    });

    it.fails("variable shadowing emits correct output", (): void => {
      // compiler bug: JSIM lowers both bindings to `const`, which is illegal in JS block scope
      const result = executeHedgeCode(`
        fn main() {
          let x = 1;
          let x = 2;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["2"]);
    });
  });

  describe("literal types", (): void => {
    it("float literal prints correctly", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 3.14;
          print(x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("3.14");
    });

    it("char literal prints as its character", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let c = 'A';
          print(c);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("A");
    });
  });

  describe("structs", (): void => {
    it("struct declaration compiles alongside fn main", (): void => {
      const result = executeHedgeCode(`
        struct Foo { x: i32 }
        fn main() {
          print(1);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toEqual(["1"]);
    });

    it("struct literal field access evaluates correctly", (): void => {
      const result = executeHedgeCode(`
        struct Foo { x: i32 }
        fn main() {
          let f = Foo { x: 42 };
          print(f.x);
        }
      `);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout[0]).toBe("42");
    });
  });

  describe("error handling", (): void => {
    it("fails to compile unknown variable", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          print(unknown_var);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("produces no output on compile error", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          print(unknown_var);
        }
      `);
      expect(result).toBeNull();
    });
  });
});
