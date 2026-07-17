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

  it("overlapping mutable and mutable borrows are rejected", (): void => {
    assertRejectsWithMessage(
      `
      fn main() {
        let mut x = "a";
        let r1 = &mut x;
        let r2 = &mut x;
        print(r1);
        print(r2);
      }
    `,
      "Conflicting",
    );
  });

  it("a mutable borrow of a binding not declared mut is rejected", (): void => {
    assertRejectsWithMessage(
      `
      fn main() {
        let x = "a";
        let r = &mut x;
        print(r);
      }
    `,
      "not declared mut",
    );
  });

  it("rejects ambiguous two-parameter elision", (): void => {
    assertRejectsWithMessage(
      `
      fn pick(a: &str, b: &str) -> &str { a }
      fn main() { print(pick("a", "b")); }
    `,
      "missing lifetime specifier",
    );
  });

  it("fills an elided return type from the sole reference parameter", (): void => {
    assertRunsTo(
      `
      fn first(s: &str) -> &str { s }
      fn main() { print(first("hello")); }
    `,
      ["hello"],
    );
  });

  it("resolves what elision alone cannot, given explicit lifetime annotations", (): void => {
    assertRunsTo(
      `
      fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a }
      fn main() { print(longest("first", "second")); }
    `,
      ["first"],
    );
  });

  it("parses a struct's own lifetime parameter and stores it on its reference field", (): void => {
    assertRunsTo(
      `
      struct Cursor<'a> { source: &'a str, pos: usize }
      fn make(s: &str) -> Cursor { Cursor { source: s, pos: 0 } }
      fn main() {
        let c = make("text");
        print(c.source);
      }
    `,
      ["text"],
    );
  });

  it.fails(
    "assigns the receiver's lifetime to the returned reference for self-receiver elision",
    (): void => {
      // Blocked by #51 (impl blocks / methods aren't parseable yet); this
      // documents elision rule 3's eventual behavior once methods land.
      assertRunsTo(
        `
      struct Token { text: str }
      impl Token {
        fn peek(&self) -> &str { self.text }
      }
      fn main() {
        let t = Token { text: "hi" };
        print(t.peek());
      }
    `,
        ["hi"],
      );
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
