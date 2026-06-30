import { describe, it } from "vitest";

import {
  assertCompilesClean,
  assertRejectsWithMessage,
} from "./test-harness.js";

describe("NLL and lifetime correctness spec", (): void => {
  it.fails(
    "sequential mutable borrows are accepted after last use",
    (): void => {
      assertCompilesClean(`
      fn main() {
        let mut x = "a";
        let r1 = &mut x;
        print(r1);
        let r2 = &mut x;
        print(r2);
      }
    `);
    },
  );

  it.fails(
    "last-use ends shared borrow before later mutable borrow",
    (): void => {
      assertCompilesClean(`
      fn main() {
        let mut x = "a";
        let r = &x;
        print(r);
        let rw = &mut x;
        print(rw);
      }
    `);
    },
  );

  it.fails("branch-local borrow release allows use after join", (): void => {
    assertCompilesClean(`
      fn main() {
        let mut x = "a";
        if true {
          let r = &mut x;
          print(r);
        } else {
          print("none");
        }
        print(x);
      }
    `);
  });

  it.fails(
    "loop-scoped mutable borrow can be recreated each iteration",
    (): void => {
      assertCompilesClean(`
      fn main() {
        let mut x = "a";
        if true {
          let r1 = &mut x;
          print(r1);
        }
        if true {
          let r2 = &mut x;
          print(r2);
        }
      }
    `);
    },
  );

  it("overlapping mutable and shared borrow is rejected", (): void => {
    assertRejectsWithMessage(
      `
      fn main() {
        let mut x = "a";
        let rw = &mut x;
        let r = &x;
        print(rw);
        print(r);
      }
    `,
      "Conflicting",
    );
  });

  it.fails(
    "lifetime elision for returned reference prefers unambiguous input",
    (): void => {
      assertCompilesClean(`
      fn pick(a: &str, b: &str) -> &str { a }
      fn main() { print(pick("a", "b")); }
    `);
    },
  );
});
