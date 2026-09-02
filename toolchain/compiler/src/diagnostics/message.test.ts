import { describe, expect, it } from "vitest";

import { renderDiagnosticMessage, renderRelatedLabel } from "./message.js";

describe("renderDiagnosticMessage", (): void => {
  it("returns the wrapped text verbatim for a Raw kind", (): void => {
    expect(
      renderDiagnosticMessage({
        kind: "Raw",
        code: "HEDGE-LEX-001",
        text: "unterminated string literal",
      }),
    ).toBe("unterminated string literal");
  });
});

describe("renderRelatedLabel", (): void => {
  it("returns the wrapped text verbatim for a RawLabel kind", (): void => {
    expect(renderRelatedLabel({ kind: "RawLabel", text: "moved here" })).toBe(
      "moved here",
    );
  });
});
