import { describe, expect, it } from "vitest";
import { HEDGE_PRIMITIVE_TYPES } from "./primitives.js";

describe("HEDGE_PRIMITIVE_TYPES", () => {
  it("does not treat prototype keys as primitive types", () => {
    expect(HEDGE_PRIMITIVE_TYPES["toString"]).toBeUndefined();
    expect(HEDGE_PRIMITIVE_TYPES["constructor"]).toBeUndefined();
    expect(HEDGE_PRIMITIVE_TYPES["__proto__"]).toBeUndefined();
  });

  it("maps known Hedge primitive names correctly", () => {
    expect(HEDGE_PRIMITIVE_TYPES["i32"]).toBe("number");
    expect(HEDGE_PRIMITIVE_TYPES["bool"]).toBe("boolean");
    expect(HEDGE_PRIMITIVE_TYPES["i64"]).toBe("bigint");
    expect(HEDGE_PRIMITIVE_TYPES["str"]).toBe("string");
  });
});
