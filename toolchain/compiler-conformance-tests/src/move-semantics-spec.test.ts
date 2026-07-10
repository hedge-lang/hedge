import { describe, it } from "vitest";

import {
  assertCompilesClean,
  assertRejectsWithMessage,
  assertRunsTo,
} from "./test-harness.js";

describe("move semantics spec", (): void => {
  it("copy types remain usable after assignment", (): void => {
    assertRunsTo(
      `
      fn main() {
        let x = 1;
        let y = x;
        print(x);
        print(y);
      }
    `,
      ["1", "1"],
    );
  });

  it("moved struct binding is unusable after move", (): void => {
    assertRejectsWithMessage(
      `
      struct Boxed { value: i32 }
      fn main() {
        let x = Boxed { value: 1 };
        let y = x;
        print(x.value);
        print(y.value);
      }
    `,
      "moved",
    );
  });

  it("moving the same owned value twice is rejected", (): void => {
    assertRejectsWithMessage(
      `
      struct Boxed { value: i32 }
      fn main() {
        let x = Boxed { value: 1 };
        let y = x;
        let z = x;
        print(y.value);
        print(z.value);
      }
    `,
      "moved",
    );
  });

  it("move in one branch invalidates use after merge", (): void => {
    assertRejectsWithMessage(
      `
      struct Boxed { value: i32 }
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        } else {
          print(0);
        }
        print(x.value);
      }
    `,
      "moved",
    );
  });

  it("passing owned value by value consumes it", (): void => {
    assertRejectsWithMessage(
      `
      struct Boxed { value: i32 }
      fn take(v: Boxed) { print(v.value); }
      fn main() {
        let x = Boxed { value: 1 };
        take(x);
        print(x.value);
      }
    `,
      "moved",
    );
  });

  it("using an uninitialized binding is rejected", (): void => {
    assertRejectsWithMessage(
      `
      fn main() {
        let mut x: i32;
        print(x);
      }
    `,
      "uninitialized",
    );
  });

  it("loop-carried move requires explicit reinitialization", (): void => {
    assertCompilesClean(`
      struct Boxed { value: i32 }
      fn main() {
        let mut x = Boxed { value: 1 };
        if true {
          let y = x;
          print(y.value);
          x = Boxed { value: 2 };
        }
        print(x.value);
      }
    `);
  });
});
