import { describe, expect, it } from "vitest";

import type { Diagnostic } from "@hedge-lang/compiler";
import { errorDiagnostic, none, warningDiagnostic } from "@hedge-lang/compiler";

import { renderDiagnostics } from "./render.js";

describe("renderDiagnostics", (): void => {
  it("renders nothing for no diagnostics", (): void => {
    expect(renderDiagnostics([])).toBe("");
  });

  it("renders one line per diagnostic", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      errorDiagnostic({ kind: "SemNotABorrowablePlace" }, none()),
      warningDiagnostic({ kind: "ParseImmutableBindingNeverUsed" }, none()),
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error[HEDGE-BORROW-CHECK-005]: only a local binding, a parameter, or a field, index, or dereference of one can be borrowed directly\n" +
        "warning[HEDGE-LINT-001]: immutable binding declared without a value can never be used",
    );
  });

  it("renders a diagnostic's code in brackets after its severity", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      errorDiagnostic({ kind: "SemFieldAccessOnNonStruct" }, none()),
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error[HEDGE-TYPE-007]: field access on non-struct type",
    );
  });

  it("renders a related span as a note line naming its label and offset", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      {
        ...errorDiagnostic({ kind: "OwnUseOfMovedValue", name: "x" }, none()),
        relatedSpans: [
          { span: { start: 7, end: 8 }, label: { kind: "LabelMovedHere" } },
        ],
      },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error[HEDGE-BORROW-CHECK-003]: use of moved value `x`\n  = note: moved here at offset 7",
    );
  });
});
