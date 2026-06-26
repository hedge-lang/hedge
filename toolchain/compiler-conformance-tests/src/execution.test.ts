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
      expect(result?.stdout[0]).toBe("3");
    });

    it("respects operator precedence", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 1 + 2 * 3;
          print(x);
        }
      `);
      expect(result?.stdout[0]).toBe("7");
    });

    it("handles subtraction", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 10 - 3;
          print(x);
        }
      `);
      expect(result?.stdout[0]).toBe("7");
    });

    it("handles multiplication", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 4 * 5;
          print(x);
        }
      `);
      expect(result?.stdout[0]).toBe("20");
    });

    it("handles division", (): void => {
      const result = executeHedgeCode(`
        fn main() {
          let x = 20 / 4;
          print(x);
        }
      `);
      expect(result?.stdout[0]).toBe("5");
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
      expect(result?.stdout).toEqual(["two"]);
    });
  });

  describe("function calls", (): void => {
    it("currently rejects calling user-defined functions in Slice 1", (): void => {
      const result = compileHedgeCode(`
        fn add(a: i32, b: i32) {
          print(a + b);
        }
        fn main() {
          add(2, 3);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("currently rejects nested calls to user-defined functions in Slice 1", (): void => {
      const result = compileHedgeCode(`
        fn double(x: i32) {
          print(x * 2);
        }
        fn main() {
          double(3);
          double(6);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
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
      expect(result?.stdout).toEqual(["yes"]);
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
      expect(result?.stdout[0]).toBe("8");
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
