import { compile, isSome, parse, tokenize } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

describe("diagnostic stability", (): void => {
  it("unresolved-name span points at the unresolved identifier text", (): void => {
    const source = `fn main() { print(missing_name); }`;
    const result = compile(source);
    const firstError = result.diagnostics.find((d) => d.severity === "error");
    expect(firstError).toBeDefined();
    expect(firstError?.span.kind).toBe("Some");
    if (firstError?.span.kind === "Some") {
      const text = source.slice(
        firstError.span.value.start,
        firstError.span.value.end,
      );
      expect(text).toBe("missing_name");
    }
  });

  it("single unresolved name does not cascade into many errors", (): void => {
    const result = compile(`fn main() { let x = missing + 1; }`);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain("missing");
  });

  it("parse failure emits at least one error diagnostic and no code", (): void => {
    const result = compile(`fn main(`);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(result.code.kind).toBe("None");
    expect(
      errors.some(
        (e) => e.message.includes("Expected") && e.message.includes("eof"),
      ),
    ).toBe(true);
  });

  it("parser emits warning for uninitialized immutable let", (): void => {
    const { tokens } = tokenize(`let x;`);
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.message).toContain(
      "immutable binding declared without a value",
    );
  });

  it("diagnostic count and primary message are deterministic across runs", (): void => {
    const source = `fn main() { let x = missing + 1; }`;
    const first = compile(source);
    const second = compile(source);
    expect(first.diagnostics.length).toBe(second.diagnostics.length);
    expect(first.diagnostics[0]?.severity).toBe(
      second.diagnostics[0]?.severity,
    );
    expect(first.diagnostics[0]?.message).toBe(second.diagnostics[0]?.message);
  });

  it("single unresolved identifier reused twice remains bounded in diagnostics", (): void => {
    const source = `fn main() { print(missing); print(missing); }`;
    const result = compile(source);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.length).toBeLessThanOrEqual(2);
  });

  it("parse diagnostics remain actionable with expectation hints", (): void => {
    const result = compile(`fn main( {`);
    const firstError = result.diagnostics.find((d) => d.severity === "error");
    expect(firstError).toBeDefined();
    expect(
      firstError?.message.includes("Expected") ||
        firstError?.message.includes("expected"),
    ).toBe(true);
  });
});
