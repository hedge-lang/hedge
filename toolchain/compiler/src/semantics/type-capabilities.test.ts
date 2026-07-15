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

  it("ReferenceType is Copy regardless of its referent - copying a reference never duplicates or moves the pointee", (): void => {
    const sharedStr: Semantics.Type = {
      kind: "ReferenceType",
      tokenId: 0,
      mutable: false,
      referent: { kind: "PrimitiveStringType" },
    };
    const mutStruct: Semantics.Type = {
      kind: "ReferenceType",
      tokenId: 0,
      mutable: true,
      referent: { kind: "StructType", name: "Boxed" },
    };
    expect(hasCapability(sharedStr, "copy")).toBe(true);
    expect(hasCapability(mutStruct, "copy")).toBe(true);
  });
});
