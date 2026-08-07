import { describe, expect, it } from "vitest";

import type { Diagnostic } from "@hedge-lang/compiler";
import { none } from "@hedge-lang/compiler";
import { renderDiagnostics } from "./render.js";

describe("renderDiagnostics", (): void => {
  it("renders nothing for no diagnostics", (): void => {
    expect(renderDiagnostics([])).toBe("");
  });

  it("renders one line per diagnostic", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      {
        severity: "error",
        message: "boom",
        span: none(),
        code: "HEDGE-BORROW-CHECK-001",
        relatedSpans: [],
      },
      {
        severity: "warning",
        message: "careful",
        span: none(),
        code: "HEDGE-LINT-001",
        relatedSpans: [],
      },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error[HEDGE-BORROW-CHECK-001]: boom\nwarning[HEDGE-LINT-001]: careful",
    );
  });

  it("renders a diagnostic's code in brackets after its severity", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      {
        severity: "error",
        message: "boom",
        span: none(),
        code: "HEDGE-BORROW-CHECK-001",
        relatedSpans: [],
      },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error[HEDGE-BORROW-CHECK-001]: boom",
    );
  });

  it("renders a related span as a note line naming its label and offset", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      {
        severity: "error",
        message: "boom",
        span: none(),
        code: "HEDGE-BORROW-CHECK-001",
        relatedSpans: [{ span: { start: 7, end: 8 }, label: "first here" }],
      },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error[HEDGE-BORROW-CHECK-001]: boom\n  = note: first here at offset 7",
    );
  });
});
