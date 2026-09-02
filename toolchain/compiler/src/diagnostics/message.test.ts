import { describe, expect, it } from "vitest";

import { renderDiagnosticMessage, renderRelatedLabel } from "./message.js";

describe("renderDiagnosticMessage", (): void => {
  it("interpolates a payload's scalars into the template", (): void => {
    expect(
      renderDiagnosticMessage({
        kind: "SemNoFieldOnStruct",
        field: "x",
        structName: "Point",
      }),
    ).toBe("no field `x` on struct `Point`");
  });

  it("branches on a payload discriminant", (): void => {
    expect(
      renderDiagnosticMessage({
        kind: "SemArithmeticOperandNotNumeric",
        side: "right",
        found: "str",
      }),
    ).toBe("arithmetic operands must be numeric; right-operand is type `str`");
  });
});

describe("renderRelatedLabel", (): void => {
  it("renders a fixed label", (): void => {
    expect(renderRelatedLabel({ kind: "LabelMovedHere" })).toBe("moved here");
  });

  it("renders a parameterized label", (): void => {
    expect(
      renderRelatedLabel({ kind: "LabelBorrowHere", borrow: "&mut" }),
    ).toBe("&mut borrow here");
  });
});
