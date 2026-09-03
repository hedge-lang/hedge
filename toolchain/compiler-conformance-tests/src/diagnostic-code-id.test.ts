import type { Diagnostic } from "@hedge-lang/compiler";
import { compile, messageOf } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

const DIAGNOSTIC_CODE_PATTERN = /^HEDGE-[A-Z][A-Z0-9-]*-\d{3,}$/u;

function extractDiagnosticCode(
  diagnostic: Diagnostic | undefined,
): string | null {
  return diagnostic === undefined ? null : diagnostic.code;
}

describe("diagnostic code ID conformance", (): void => {
  it("defines a stable diagnostic code schema pattern", (): void => {
    expect("HEDGE-PARSE-001").toMatch(DIAGNOSTIC_CODE_PATTERN);
    expect("HEDGE-BORROW-CHECK-012").toMatch(DIAGNOSTIC_CODE_PATTERN);
    expect("PARSE-001").not.toMatch(DIAGNOSTIC_CODE_PATTERN);
  });

  it("exposes a schema-valid code on an emitted diagnostic", (): void => {
    const result = compile(`fn main() { print(missing_name); }`);
    const first = result.diagnostics[0];
    expect(first).toBeDefined();
    const code = extractDiagnosticCode(first);
    expect(code).not.toBeNull();
    if (code === null) {
      return;
    }
    expect(code).toMatch(DIAGNOSTIC_CODE_PATTERN);
  });

  it("codes every diagnostic in the core error corpus with a schema-valid id", (): void => {
    const corpus = [
      `fn main() { let s = "unterminated; }`,
      `fn main(`,
      `fn main() { print(missing_name); }`,
      `fn main() { let x: i32 = "a"; print(x); }`,
      `fn main() { let x = "a"; let r = &mut x; print(r); }`,
      `enum E { A, B }
         fn main() { let e = E::A; match e { E::A => 1 }; }`,
    ];
    for (const source of corpus) {
      const result = compile(source);
      expect(
        result.diagnostics.length,
        `expected at least one diagnostic for: ${source}`,
      ).toBeGreaterThan(0);
      for (const diagnostic of result.diagnostics) {
        const code = extractDiagnosticCode(diagnostic);
        expect(
          code,
          `uncoded diagnostic: ${messageOf(diagnostic)}`,
        ).not.toBeNull();
        if (code === null) {
          return;
        }
        expect(code).toMatch(DIAGNOSTIC_CODE_PATTERN);
      }
    }
  });

  it("every borrow and lifetime error category in the corpus carries a schema-valid, stable code", (): void => {
    const corpus: Record<string, string> = {
      "HEDGE-BORROW-CHECK-001":
        'fn main() { let mut x = "a"; let r1 = &mut x; let r2 = &mut x; print(r1); print(r2); }',
      "HEDGE-BORROW-CHECK-002":
        'fn main() { let x = "a"; let r = &mut x; print(r); }',
      "HEDGE-BORROW-CHECK-003": `struct Boxed { value: i32 }
        fn main() { let x = Boxed { value: 1 }; let y = x; print(x.value); }`,
      "HEDGE-LIFETIME-001": "fn longest(a: &str, b: &str) -> &str { a }",
      "HEDGE-LIFETIME-002": "fn confusing(y: &i32) -> &i32 { let x = 5; &x }",
    };
    for (const [expectedCode, source] of Object.entries(corpus)) {
      const result = compile(source);
      const codes = result.diagnostics.map(extractDiagnosticCode);
      expect(
        codes,
        `expected ${expectedCode} among diagnostics for: ${source}`,
      ).toContain(expectedCode);
      for (const code of codes) {
        expect(code).not.toBeNull();
        if (code !== null) {
          expect(code).toMatch(DIAGNOSTIC_CODE_PATTERN);
        }
      }
    }
  });
});
