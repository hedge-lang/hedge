import { describe, expect, it } from "vitest";

import type { Diagnostic } from "@hedge-lang/compiler";
import { renderDiagnostics } from "./render.js";

describe("renderDiagnostics", (): void => {
  it("renders nothing for no diagnostics", (): void => {
    expect(renderDiagnostics([])).toBe("");
  });

  it("renders one line per diagnostic", (): void => {
    const diagnostics: readonly Diagnostic[] = [
      { severity: "error", message: "boom", tokenId: 0 },
      { severity: "warning", message: "careful", tokenId: 3 },
    ];
    expect(renderDiagnostics(diagnostics)).toBe(
      "error: boom\nwarning: careful",
    );
  });
});
