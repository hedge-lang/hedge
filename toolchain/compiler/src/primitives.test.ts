import { describe, expect, it } from "vitest";
import { HEDGE_PRIMITIVE_TYPES } from "./primitives.js";

describe("HEDGE_PRIMITIVE_TYPES", () => {
  it("maps known Hedge primitive names correctly", () => {
    expect(HEDGE_PRIMITIVE_TYPES.get("i32")).toBe("number");
    expect(HEDGE_PRIMITIVE_TYPES.get("bool")).toBe("boolean");
    expect(HEDGE_PRIMITIVE_TYPES.get("i64")).toBe("bigint");
    expect(HEDGE_PRIMITIVE_TYPES.get("str")).toBe("string");
  });
});
