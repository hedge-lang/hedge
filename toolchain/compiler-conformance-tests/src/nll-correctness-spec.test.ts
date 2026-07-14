import { describe, it } from "vitest";

import {
  assertCompilesClean,
  assertRejectsWithMessage,
  assertRunsTo,
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

  it.fails(
    "rejects passing a dereferenced non-Copy value by value out of a reference",
    (): void => {
      assertRejectsWithMessage(
        `
      struct Resource { id: i32 }
      fn consume(r: Resource) { print(r.id); }
      fn main() {
        let x = Resource { id: 1 };
        let r = &x;
        consume(*r);
      }
    `,
        "cannot move",
      );
    },
  );

  it.fails(
    "mutating a primitive through &mut is observable by the original binding after the borrow ends",
    (): void => {
      assertRunsTo(
        `
      fn main() {
        let mut x = 1;
        let r = &mut x;
        *r = *r + 1;
        print(x);
      }
    `,
        ["2"],
      );
    },
  );

  it.fails(
    "replacing a whole struct through &mut is observable by the original binding after the borrow ends",
    (): void => {
      assertRunsTo(
        `
      struct Foo { value: i32 }
      fn main() {
        let mut obj = Foo { value: 1 };
        let obj_ref = &mut obj;
        *obj_ref = Foo { value: 2 };
        print(obj.value);
      }
    `,
        ["2"],
      );
    },
  );
});
