import { describe, expect, it } from "vitest";

describe("future semantics activation stubs", (): void => {
  it.skip("executes user-defined return-value function calls once supported", (): void => {
    // Activate when user-defined function call execution semantics are enabled end-to-end.
    // Target shape:
    // fn add(a: i32, b: i32) -> i32 { a + b }
    // fn main() { let x = add(2, 3); print(x); }
    expect(true).toBe(true);
  });

  it.skip("supports nested user-defined call chains once supported", (): void => {
    // Activate when nested user-defined call lowering/evaluation is available.
    // Target shape:
    // fn inc(x: i32) -> i32 { x + 1 }
    // fn main() { let y = inc(inc(1)); print(y); }
    expect(true).toBe(true);
  });
});
