import { describe, expect, it } from "vitest";

import type * as Semantics from "./ast.js";
import { hasCapability } from "./type-capabilities.js";

describe("copy capability", (): void => {
  it("primitives are Copy", (): void => {
    const primitiveTypes: readonly Semantics.Type[] = [
      { kind: "PrimitiveI32Type" },
      { kind: "PrimitiveBooleanType" },
      { kind: "PrimitiveStringType" },
      { kind: "PrimitiveCharType" },
      { kind: "PrimitiveF64Type" },
    ];
    for (const type of primitiveTypes) {
      expect(hasCapability(type, "copy")).toBe(true);
    }
  });

  it("struct types are not Copy", (): void => {
    const type: Semantics.Type = { kind: "StructType", name: "Boxed" };
    expect(hasCapability(type, "copy")).toBe(false);
  });

  it("UnitType is Copy", (): void => {
    const type: Semantics.Type = { kind: "UnitType", tokenId: 0 };
    expect(hasCapability(type, "copy")).toBe(true);
  });
});
