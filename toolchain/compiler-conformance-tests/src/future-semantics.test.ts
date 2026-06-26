import { describe, it } from "vitest";
import { assertRunsTo } from "./test-harness.js";

describe("future semantics activation stubs", (): void => {
  it.fails("executes user-defined return-value function calls once supported", (): void => {
    assertRunsTo(
      `fn add(a: i32, b: i32) -> i32 { a + b }
       fn main() { let x = add(2, 3); print(x); }`,
      ["5"],
    );
  });

  it.fails("supports nested user-defined call chains once supported", (): void => {
    assertRunsTo(
      `fn inc(x: i32) -> i32 { x + 1 }
       fn main() { let y = inc(inc(1)); print(y); }`,
      ["3"],
    );
  });
});
