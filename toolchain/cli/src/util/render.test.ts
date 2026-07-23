import { describe, expect, it } from "vitest";

import type { Diagnostic } from "@hedge-lang/compiler";
import { none, some } from "@hedge-lang/compiler";
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
        code: none(),
        relatedSpans: [],
      },
      {
        severity: "warning",
        message: "careful",
        span: none(),
        code: none(),
        relatedSpans: [],
      },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error: boom\nwarning: careful",
    );
  });

  it("renders a diagnostic's code in brackets when present", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      {
        severity: "error",
        message: "boom",
        span: none(),
        code: some("HEDGE-BORROW-CHECK-001"),
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
        code: none(),
        relatedSpans: [{ span: { start: 7, end: 8 }, label: "first here" }],
      },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error: boom\n  = note: first here at offset 7",
    );
  });
});
