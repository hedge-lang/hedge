import { describe, it } from "vitest";

import {
  assertCompilesClean,
  assertRejectsWithMessage,
} from "./test-harness.js";

describe("type system soundness spec", (): void => {
  it("type inference succeeds for simple let bindings", (): void => {
    assertCompilesClean(`
      fn main() {
        let x = 1;
        let y = x + 2;
        print(y);
      }
    `);
  });

  it.fails("mismatched branch result types are rejected", (): void => {
    assertRejectsWithMessage(
      `
      fn main() {
        let x = if true { 1 } else { "no" };
        print(x);
      }
    `,
      "type",
    );
  });

  it.fails(
    "struct field initialization enforces declared field types",
    (): void => {
      assertRejectsWithMessage(
        `
      struct Point { x: i32 }
      fn main() {
        let p = Point { x: "bad" };
        print(p.x);
      }
    `,
        "type",
      );
    },
  );

  it("arithmetic does not silently coerce bool to integer", (): void => {
    assertRejectsWithMessage(
      `
      fn main() {
        let x = true + 1;
        print(x);
      }
    `,
      "type",
    );
  });

  it.fails("function return type mismatch is rejected", (): void => {
    assertRejectsWithMessage(
      `
      fn bad() -> i32 { "x" }
      fn main() { print(bad()); }
    `,
      "type",
    );
  });
});
