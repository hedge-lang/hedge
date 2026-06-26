import { compile } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

const INTEROP_CODE_PATTERN = /^HEDGE-INTEROP-[A-Z0-9-]+-\d{3,}$/u;

function extractDiagnosticCode(diagnostic: unknown): string | null {
  if (typeof diagnostic !== "object" || diagnostic === null) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(diagnostic, "code")) {
    return null;
  }
  const code = (diagnostic as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : null;
}

describe("JS interop boundary negative suite", (): void => {
  it.fails(
    "rejects non-primitive boundary payloads without explicit unsafe escape hatches",
    (): void => {
      const source = `
      struct Payload { value: i32 }
      extern "js" fn send_payload(payload: Payload) -> ();
      fn main() {
        let payload = Payload { value: 7 };
        send_payload(payload);
      }
    `;
      const result = compile(source);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
      for (const diagnostic of errors) {
        const code = extractDiagnosticCode(diagnostic);
        expect(code).not.toBeNull();
        if (code === null) {
          return;
        }
        expect(code).toMatch(INTEROP_CODE_PATTERN);
      }
      expect(
        errors.some((diagnostic) => {
          const code = extractDiagnosticCode(diagnostic);
          return typeof code === "string" && code.includes("BOUNDARY");
        }),
      ).toBe(true);
    },
  );

  it.fails("rejects invalid unsafe boundary usage patterns", (): void => {
    const source = `
      extern "js" fn eval_i32(input: str) -> i32;
      fn main() {
        let x = unsafe unchecked eval_i32("1 + 2");
        print(x);
      }
    `;
    const result = compile(source);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((diagnostic) => {
        const code = extractDiagnosticCode(diagnostic);
        return (
          typeof code === "string" &&
          code.startsWith("HEDGE-INTEROP-") &&
          code.includes("UNSAFE")
        );
      }),
    ).toBe(true);
  });

  it.fails("permits primitive-only safe JS interop calls", (): void => {
    const source = `
      extern "js" fn emit_i32(value: i32) -> ();
      fn main() {
        emit_i32(1);
      }
    `;
    const result = compile(source);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });
});
