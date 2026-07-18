import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import { isSome } from "../option.js";
import { analyzeSource } from "../testing/analyze-source.js";
import type { OwnershipCheckResult } from "./move-check.js";
import { analyzeOwnership } from "./move-check.js";

function check(source: string): OwnershipCheckResult {
  const { tokens, program } = analyzeSource(source);
  return analyzeOwnership(program, tokens);
}

const BOXED = "struct Boxed { value: i32 }\n";

describe("move-check", (): void => {
  it("A well-formed program mixing lets, moves, copies, if, and structs has zero diagnostics", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = 1;
        let y = x;
        let a = Boxed { value: 1 };
        let mut cond = true;
        if cond {
          print(a.value);
        } else {
          print(0);
        }
        print(x);
        print(y);
        print(a.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("using an uninitialized binding produces an uninitialized error", (): void => {
    const { diagnostics } = check(`
      fn main() {
        let mut x: i32; // This has no initializer, so it's uninitialized.
        print(x);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("uninitialized");
  });

  it("assigning before use clears the uninitialized state", (): void => {
    const { diagnostics } = check(`
      fn main() {
        let mut x: i32;
        x = 1;
        print(x);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("reassignment after a move resets the binding to owned", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut x = Boxed { value: 1 };
        if true {
          let y = x; // value gets moved here
          print(y.value);
          x = Boxed { value: 2 };
        }
        print(x.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("copy types remain usable after assignment", (): void => {
    const { diagnostics } = check(`
      fn main() {
        let x = 1;
        let y = x; // value is copied here
        print(x);
        print(y);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("move in one branch invalidates use after merge, naming the move", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x; // value is moved here
          print(y.value);
        } else {
          print(0);
        }
        print(x.value); // using moved value here is an error
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("moved");
    expect(diagnostics[0].message).toContain("x");
  });

  it("resolves a struct that is moved on only one branch and never used again via static duplication, without using a runtime flag", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x; // moved on this path only
          print(y.value);
        } else {
          print(0);
        }
        // x is never read again: on the else path it is still Owned, but
        // that's known statically here, not at runtime -- the drop attributes
        // to the else branch instead of needing a flag (see branchDrops).
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    const allDrops = [...main.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).not.toContain("x");
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
    expect(main.branchDrops.map((d) => d.declaration.name)).toEqual(["x"]);
    expect(main.branchDrops.map((d) => d.branch)).toEqual(["else"]);
  });

  it("resolves a struct moved on only the else branch by attributing the drop to then, the symmetric case", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          print(0);
        } else {
          let y = x; // moved on this path only
          print(y.value);
        }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    expect(main.branchDrops.map((d) => d.declaration.name)).toEqual(["x"]);
    expect(main.branchDrops.map((d) => d.branch)).toEqual(["then"]);
  });

  it("a value fully moved on every branch merges to an unconditional Unbound, not an ambiguous state", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        } else {
          let z = x;
          print(z.value);
        }
        print(x.value);
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("moved");
    expect(diagnostics[0].message).not.toContain("possibly");
  });

  it("a value moved on every branch and never used again needs no drop of any kind, static or flagged", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        } else {
          let z = x;
          print(z.value);
        }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    const allDrops = [...main.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).not.toContain("x");
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
    expect(main.branchDrops).toEqual([]);
  });

  it("a struct possibly-uninitialized at scope close (no else branch initializes it) is rejected", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let mut x: Boxed;
        if cond {
          x = Boxed { value: 1 };
        }
        // There is a branch (cond == false) where x is never initialized
        // at all, so the compiler can't be sure it exists by the time the
        // scope closes. That's the actual reason this is rejected — not a
        // drop-flag question, since there's nothing to drop until x is
        // known to have been constructed in the first place.
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("x");
  });

  it("a struct initialized on only one branch is rejected on next use", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let mut x: Boxed;
        if cond {
          x = Boxed { value: 1 };
        }
        print(x.value);
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("x");
  });

  it("drop annotation: an owned struct with no move is present at its scope's exit", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let a = Boxed { value: 1 };
        print(a.value);
      }`,
    );
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    const allDrops = [...main.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).toEqual(["a"]);
  });

  it("two struct bindings in the same scope are dropped in reverse declaration order", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let a = Boxed { value: 1 };
        let b = Boxed { value: 2 };
        print(a.value);
        print(b.value);
      }`,
    );
    const main = result.functions.get("main");
    assert(main !== undefined);
    const allDrops = [...main.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).toEqual(["b", "a"]);
  });

  it("every drops key corresponds to a real scope-exit block in the paired graph", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let a = Boxed { value: 1 };
        if true {
          let b = Boxed { value: 2 };
          print(b.value);
        } else {
          print(0);
        }
        let c = Boxed { value: 3 };
        print(a.value);
        print(c.value);
      }`,
    );
    const main = result.functions.get("main");
    assert(main !== undefined);
    expect(main.drops.size).toBeGreaterThan(0);
    const scopeExitTokenIds = main.graph.blocks.flatMap((b) =>
      isSome(b.scopeExit) ? [b.scopeExit.value.scopeTokenId] : [],
    );
    for (const scopeTokenId of main.drops.keys()) {
      expect(scopeExitTokenIds).toContain(scopeTokenId);
    }
    // The outer scope's drops (a and c, split across the pre-if and join
    // blocks by the fork) land together on the join block's scopeExit key.
    const outerDrops = [...main.drops.entries()]
      .filter(([, decls]) => decls.some((d) => d.name === "a"))
      .flatMap(([, decls]) => decls);
    expect(outerDrops.map((d) => d.name)).toEqual(["c", "a"]);
  });

  it("a moved value is not annotated for drop", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let a = Boxed { value: 1 };
        let b = a;
        print(b.value);
      }`,
    );
    const main = result.functions.get("main");
    assert(main !== undefined);
    const allDrops = [...main.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).toEqual(["b"]);
  });

  it("a struct returned via the trailing expression is moved out, not dropped", (): void => {
    const result = check(
      `${BOXED}
      fn f() -> Boxed {
        let x = Boxed { value: 1 };
        x
      }
      fn main() {
        let y = f();
        print(y.value);
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const f = result.functions.get("f");
    assert(f !== undefined);
    const allDrops = [...f.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).not.toContain("x");
  });

  it("an owned struct parameter that is never moved is dropped at function exit", (): void => {
    const result = check(
      `${BOXED}
      fn f(p: Boxed) {
        print(p.value);
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const f = result.functions.get("f");
    assert(f !== undefined);
    const allDrops = [...f.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).toContain("p");
  });

  it("a struct parameter is dropped after the function body's own locals, in reverse order", (): void => {
    const result = check(
      `${BOXED}
      fn f(p: Boxed) {
        let a = Boxed { value: 2 };
        print(p.value);
        print(a.value);
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const f = result.functions.get("f");
    assert(f !== undefined);
    const allDrops = [...f.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).toEqual(["a", "p"]);
  });

  it("a parameter returned via the trailing expression is moved out, not dropped", (): void => {
    const result = check(
      `${BOXED}
      fn identity(x: Boxed) -> Boxed {
        x
      }
      fn main() {
        let y = identity(Boxed { value: 1 });
        print(y.value);
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const identity = result.functions.get("identity");
    assert(identity !== undefined);
    const allDrops = [...identity.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).not.toContain("x");
  });

  it("a moved-away struct parameter is excluded from the drop list", (): void => {
    const result = check(
      `${BOXED}
      fn take(v: Boxed) { print(v.value); }
      fn f(p: Boxed) {
        take(p);
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const f = result.functions.get("f");
    assert(f !== undefined);
    const allDrops = [...f.drops.values()].flat();
    expect(allDrops.map((d) => d.name)).not.toContain("p");
  });

  it("does not track a wildcard parameter for drops", (): void => {
    const result = check(
      `${BOXED}
      fn f(_: Boxed) {}`,
    );
    expect(result.diagnostics).toEqual([]);
    const f = result.functions.get("f");
    assert(f !== undefined);
    const allDrops = [...f.drops.values()].flat();
    expect(allDrops).toEqual([]);
  });

  it("does not cascade: one move followed by three reads reports exactly one diagnostic", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = Boxed { value: 1 };
        let y = x; // moved here
        print(x.value);
        print(x.value);
        print(x.value);
        print(y.value);
      }`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("cross-function isolation: unrelated same-named bindings in two functions do not false-positive", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn f() {
        let x = Boxed { value: 1 };
        let y = x;
        print(y.value);
      }
      fn main() {
        let x = Boxed { value: 2 };
        print(x.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("shadowing: moving an inner shadowed struct does not affect the outer primitive binding", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = 1;
        {
          let x = Boxed { value: 2 };
          let moved = x;
          print(moved.value);
        }
        print(x);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("passing an owned value by value into a call consumes it", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn take(v: Boxed) { print(v.value); }
      fn main() {
        let x = Boxed { value: 1 };
        take(x); // moved here
        print(x.value);
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("moved");
  });

  it.fails(
    "rejects passing a dereferenced non-Copy value by value out of a reference",
    (): void => {
      const { diagnostics } = check(
        `${BOXED}
        fn take(v: Boxed) { print(v.value); }
        fn main() {
          let x = Boxed { value: 1 };
          let r = &x;
          take(*r);
        }`,
      );
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("cannot move");
    },
  );

  it("moving the same owned value twice is rejected", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = Boxed { value: 1 };
        let y = x; // move occurs here
        let z = x; // attempted move here
        print(y.value);
        print(z.value); // attempted move here
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("moved");
  });

  it("reading a nested struct field does not attempt partial-move tracking", (): void => {
    const { diagnostics } = check(
      `struct Inner { value: i32 }
      struct Outer { inner: Inner }
      fn main() {
        let o = Outer { inner: Inner { value: 1 } };
        print(o.inner.value);
        print(o.inner.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });
});
