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
        kind: "SemComparisonNotSupported",
        relation: "ordering",
      }),
    ).toBe("type does not support ordering comparison");
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
