import { compile } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

const DIAGNOSTIC_CODE_PATTERN = /^HEDGE-[A-Z][A-Z0-9-]*-\d{3,}$/u;

function extractDiagnosticCode(diagnostic: unknown): string | null {
  if (typeof diagnostic !== "object" || diagnostic === null) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(diagnostic, "code")) {
    return null;
  }
  const value = (diagnostic as Record<string, unknown>)["code"];
  return typeof value === "string" ? value : null;
}

describe("diagnostic code ID conformance", (): void => {
  it("defines a stable diagnostic code schema pattern", (): void => {
    expect("HEDGE-PARSE-001").toMatch(DIAGNOSTIC_CODE_PATTERN);
    expect("HEDGE-BORROW-CHECK-012").toMatch(DIAGNOSTIC_CODE_PATTERN);
    expect("PARSE-001").not.toMatch(DIAGNOSTIC_CODE_PATTERN);
  });

  it.fails(
    "emitted diagnostics expose a code field with schema-valid IDs",
    (): void => {
      const result = compile(`fn main() { print(missing_name); }`);
      const first = result.diagnostics[0];
      expect(first).toBeDefined();
      const code = extractDiagnosticCode(first);
      expect(code).not.toBeNull();
      if (code === null) {
        return;
      }
      expect(code).toMatch(DIAGNOSTIC_CODE_PATTERN);
    },
  );

  it.fails(
    "all diagnostics in the core error corpus include schema-valid code ids",
    (): void => {
      const corpus = [
        `fn main(`,
        `fn main() { print(missing_name); }`,
        `fn main() { let x = "a"; let r = &x; }`,
      ];
      for (const source of corpus) {
        const result = compile(source);
        expect(result.diagnostics.length).toBeGreaterThan(0);
        for (const diagnostic of result.diagnostics) {
          const code = extractDiagnosticCode(diagnostic);
          expect(code).not.toBeNull();
          if (code === null) {
            return;
          }
          expect(code).toMatch(DIAGNOSTIC_CODE_PATTERN);
        }
      }
    },
  );
});
