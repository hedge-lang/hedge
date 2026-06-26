import { compile } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

const DIAGNOSTIC_CODE_PATTERN = /^HEDGE-[A-Z][A-Z0-9-]*-\d{3,}$/u;

describe("diagnostic code ID plan", (): void => {
  it("defines a stable diagnostic code schema pattern", (): void => {
    expect("HEDGE-PARSE-001").toMatch(DIAGNOSTIC_CODE_PATTERN);
    expect("HEDGE-BORROW-CHECK-012").toMatch(DIAGNOSTIC_CODE_PATTERN);
    expect("PARSE-001").not.toMatch(DIAGNOSTIC_CODE_PATTERN);
  });

  it("documents current contract: diagnostics do not expose code IDs yet", (): void => {
    const result = compile(`fn main() { print(missing_name); }`);
    const first = result.diagnostics[0];
    const hasCode =
      typeof first === "object" &&
      Object.prototype.hasOwnProperty.call(first, "code");
    expect(hasCode).toBe(false);
  });

  it.skip("asserts every emitted diagnostic has a schema-valid code id", (): void => {
    // Activate when Diagnostic includes a `code` field.
    // Required assertion shape:
    // - all diagnostics include string `code`
    // - code matches DIAGNOSTIC_CODE_PATTERN
    expect(true).toBe(true);
  });
});
