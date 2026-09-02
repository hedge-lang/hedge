import { describe, expect, it } from "vitest";

import { none } from "../option.js";

import { errorDiagnostic, warningDiagnostic } from "./diagnostic.js";
import { codeOf, type DiagnosticKind } from "./kind.js";

describe("codeOf", (): void => {
  it("returns the embedded code for a Raw kind", (): void => {
    const kind: DiagnosticKind = {
      kind: "Raw",
      code: "HEDGE-LEX-001",
      text: "unterminated string literal",
    };

    expect(codeOf(kind)).toBe("HEDGE-LEX-001");
  });
});

describe("diagnostic factories", (): void => {
  it("derives code from kind rather than accepting it as an argument", (): void => {
    const kind: DiagnosticKind = {
      kind: "Raw",
      code: "HEDGE-TYPE-001",
      text: "type mismatch",
    };

    expect(errorDiagnostic(kind, none()).code).toBe(codeOf(kind));
    expect(warningDiagnostic(kind, none()).code).toBe(codeOf(kind));
  });

  it("carries the kind on the built diagnostic in place of a message string", (): void => {
    const kind: DiagnosticKind = {
      kind: "Raw",
      code: "HEDGE-TYPE-001",
      text: "type mismatch",
    };
    const diagnostic = errorDiagnostic(kind, none());

    expect(diagnostic.kind).toBe(kind);
    expect(diagnostic.severity).toBe("error");
  });
});
