import { describe, it, expect } from "vitest";
import {
  SLICE_NUMBER,
  compileHedgeCode,
  hasCompileErrors,
  getErrorMessages,
} from "./test-harness.js";

/**
 * Test corpus for programs that must be rejected by the compiler.
 * Each test validates that a specific error category is caught.
 */
describe("must-fail corpus — rejection tests", (): void => {
  describe("name resolution errors", (): void => {
    it("rejects undefined variable in expression", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          print(undefined_name);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
      expect(getErrorMessages(result)[0]).toContain("undefined_name");
    });

    it("rejects undefined function call", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          undefined_fn(1, 2);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("rejects use of name after binding", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let x = 1;
          print(y);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });
  });

  describe("borrow checker errors", (): void => {
    it.skipIf(SLICE_NUMBER === 1)(
      "rejects &write of immutable binding",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let x = "a";
          let r = &write x;
          print(r);
        }
      `);
        expect(hasCompileErrors(result)).toBe(true);
        expect(
          getErrorMessages(result).some((m) =>
            m.includes("not declared write"),
          ),
        ).toBe(true);
      },
    );

    it.skipIf(SLICE_NUMBER > 1)(
      "rejects &write of immutable binding in Slice 1",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let x = "a";
          let r = &write x;
          print(r);
        }
      `);
        expect(hasCompileErrors(result)).toBe(true);
        expect(
          getErrorMessages(result).some((m) =>
            m.includes("borrow expressions are not supported in Slice 1"),
          ),
        ).toBe(true);
      },
    );

    it.skipIf(SLICE_NUMBER === 1)(
      "rejects overlapping mutable borrows",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          let r2 = &write x;
          print(r1);
          print(r2);
        }
      `);
        expect(hasCompileErrors(result)).toBe(true);
        expect(getErrorMessages(result)[0]).toContain("Conflicting");
        expect(
          getErrorMessages(result).some((m) => m.includes("Conflicting")),
        ).toBe(true);
      },
    );

    it.skipIf(SLICE_NUMBER > 1)(
      "rejects overlapping mutable borrows in Slice 1",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          let r2 = &write x;
          print(r1);
          print(r2);
        }
      `);
        expect(hasCompileErrors(result)).toBe(true);
        expect(
          getErrorMessages(result).some((m) =>
            m.includes("borrow expressions are not supported in Slice 1"),
          ),
        ).toBe(true);
      },
    );

    it.skipIf(SLICE_NUMBER === 1)(
      "accepts sequential mutable borrows (NLL)",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          print(r1);
          let r2 = &write x;
          print(r2);
        }
      `);
        expect(hasCompileErrors(result)).toBe(false);
      },
    );

    it.skipIf(SLICE_NUMBER > 1)(
      "currently rejects sequential mutable borrows in Slice 1",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          print(r1);
          let r2 = &write x;
          print(r2);
        }
      `);

        expect(hasCompileErrors(result)).toBe(true);
        expect(
          getErrorMessages(result).some((m) =>
            m.includes("borrow expressions are not supported in Slice 1"),
          ),
        ).toBe(true);
      },
    );

    it.skipIf(SLICE_NUMBER === 1)("accepts many shared borrows", (): void => {
      const result = compileHedgeCode(`
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
      expect(hasCompileErrors(result)).toBe(false);
    });

    it.skipIf(SLICE_NUMBER > 1)(
      "currently rejects many shared borrows in Slice 1",
      (): void => {
        const result = compileHedgeCode(`
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
        expect(hasCompileErrors(result)).toBe(true);
        expect(
          getErrorMessages(result).some((m) =>
            m.includes("borrow expressions are not supported in Slice 1"),
          ),
        ).toBe(true);
      },
    );
  });

  describe("borrow checker edge cases", (): void => {
    it("rejects shared borrow while mutable borrow is still live", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let rw = &write x;
          let r = &x;
          print(rw);
          print(r);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
      expect(
        getErrorMessages(result).some((m) => m.includes("Conflicting borrows")),
      ).toBe(true);
    });

    it("rejects mutable borrow while shared borrow is still live", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r = &x;
          let rw = &write x;
          print(r);
          print(rw);
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
      expect(
        getErrorMessages(result).some((m) => m.includes("Conflicting borrows")),
      ).toBe(true);
    });

    it.skipIf(SLICE_NUMBER === 1)(
      "accepts a second mutable borrow when the first borrow has no uses",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          let r2 = &write x;
          print(r2);
        }
      `);
        expect(hasCompileErrors(result)).toBe(false);
      },
    );

    it.skipIf(SLICE_NUMBER > 1)(
      "currently rejects second mutable borrow even without first use in Slice 1",
      (): void => {
        const result = compileHedgeCode(`
        fn main() {
          let write x = "a";
          let r1 = &write x;
          let r2 = &write x;
          print(r2);
        }
      `);
        expect(hasCompileErrors(result)).toBe(true);
        expect(
          getErrorMessages(result).some((m) =>
            m.includes("borrow expressions are not supported in Slice 1"),
          ),
        ).toBe(true);
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

  describe("syntax errors", (): void => {
    it("rejects unclosed function", (): void => {
      const result = compileHedgeCode(`
        fn main(
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("rejects missing semicolon in let", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let x = 1
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("rejects unclosed block", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let x = 1;
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });
  });

  describe.skipIf(SLICE_NUMBER > 1)("type errors (Slice 1 only)", (): void => {
    it("rejects reference expressions (Slice 1)", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let x = "a";
          let r = &x;
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
      expect(
        getErrorMessages(result).some((m) =>
          m.includes("borrow expressions are not supported in Slice 1"),
        ),
      ).toBe(true);
    });
  });

  describe("diagnostic non-cascade", (): void => {
    it("does not emit spurious diagnostics for single missing name", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let x = missing_var + 1;
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
      const errorMessages = getErrorMessages(result);
      expect(errorMessages.length).toBeGreaterThanOrEqual(1);
      // Should not have cascading errors from the failed expression
    });
  });

  describe("slice 1 restrictions", (): void => {
    it("rejects generic types (not in Slice 1)", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          let x: Vec<i32> = Vec::new();
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("rejects match expressions (not in Slice 1)", (): void => {
      const result = compileHedgeCode(`
        fn main() {
          match 5 {
            1 => print("one"),
            _ => print("other"),
          }
        }
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });

    it("rejects enum definitions (not in Slice 1)", (): void => {
      const result = compileHedgeCode(`
        enum Status {
          Ok,
          Err,
        }
        fn main() {}
      `);
      expect(hasCompileErrors(result)).toBe(true);
    });
  });
});
