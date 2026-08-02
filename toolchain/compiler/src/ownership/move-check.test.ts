import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import { isSome, some } from "../option.js";
import { analyzeSource } from "../testing/analyze-source.js";
import type { OwnershipCheckResult } from "./move-check.js";
import { analyzeOwnership, conditionalDropFlagWarning } from "./move-check.js";

function check(
  source: string,
  options?: { readonly warnDropFlags?: boolean },
): OwnershipCheckResult {
  const { tokens, program } = analyzeSource(source);
  return analyzeOwnership(program, tokens, options);
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

  it("a move inside a match arm's body invalidates a later use of the moved value, naming it", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = Boxed { value: 1 };
        match true {
          _ => {
            let y = x; // value is moved here
            print(y.value);
          }
        }
        print(x.value); // using moved value here is an error
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("moved");
    expect(diagnostics[0].message).toContain("x");
  });

  it("move in one match arm does not invalidate an independent use of the same value in another arm", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut cond = 1;
        let x = Boxed { value: 1 };
        match cond {
          1 => {
            let y = x; // value is moved here, on this arm only
            print(y.value);
          }
          _ => {
            print(x.value); // a different, mutually exclusive arm - not moved here
          }
        }
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("move in one match arm invalidates use after merge, naming the move", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut cond = 1;
        let x = Boxed { value: 1 };
        match cond {
          1 => {
            let y = x; // value is moved here
            print(y.value);
          }
          _ => {
            print(0);
          }
        }
        print(x.value); // using moved value here is an error
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("moved");
    expect(diagnostics[0].message).toContain("x");
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

  it("a value moved partway down an else-if chain resolves to two independent static drop sites, not a flag", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut n = 1;
        let x = Boxed { value: 1 };
        if n == 1 {
          print(0);
        } else if n == 2 {
          let y = x; // moved only in this arm
          print(y.value);
        } else {
          print(2);
        }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
    const xDrops = main.branchDrops.filter((d) => d.declaration.name === "x");
    expect(xDrops).toHaveLength(2);
    // Attributed independently to the outer `if n == 1` (then) and the
    // innermost fallthrough `else` -- the two concrete paths where x is
    // still owned. Only one of the two ever runs, so there is no
    // double-drop risk despite two static sites.
    expect(xDrops.map((d) => d.branch).sort()).toEqual(["else", "then"]);
    expect(new Set(xDrops.map((d) => d.ifTokenId)).size).toBe(2);
  });

  it("two independent bindings each conditionally moved in separate if/else pairs get independent attribution", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut cond1 = true;
        let mut cond2 = true;
        let x = Boxed { value: 1 };
        let w = Boxed { value: 2 };
        if cond1 {
          let y = x; // moved only here
          print(y.value);
        } else {
          print(0);
        }
        if cond2 {
          print(1);
        } else {
          let z = w; // moved only here
          print(z.value);
        }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
    const xDrop = main.branchDrops.find((d) => d.declaration.name === "x");
    const wDrop = main.branchDrops.find((d) => d.declaration.name === "w");
    assert(xDrop !== undefined, "Expected a branch drop for x");
    assert(wDrop !== undefined, "Expected a branch drop for w");
    expect(xDrop.branch).toBe("else");
    expect(wDrop.branch).toBe("then");
    expect(xDrop.ifTokenId).not.toBe(wDrop.ifTokenId);
  });

  it("a conditional move inside a nested block within a branch still resolves at the enclosing if's merge", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          {
            let y = x; // moved inside a nested block within the then branch
            print(y.value);
          }
          let done = true;
          print(0);
        } else {
          print(1);
        }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
    const xDrop = main.branchDrops.find((d) => d.declaration.name === "x");
    assert(xDrop !== undefined, "Expected a branch drop for x");
    expect(xDrop.branch).toBe("else");
  });

  it("a Copy-typed value duplicated on only one branch never triggers conditional-move attribution", (): void => {
    const result = check(`
      fn main() {
        let mut cond = true;
        let n = 1;
        if cond {
          let m = n; // copied, not moved -- n stays Owned regardless of branch
          print(m);
        } else {
          print(0);
        }
        print(n); // still usable: n was never conditionally moved
      }
    `);
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    expect(main.branchDrops).toEqual([]);
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
  });

  it("a struct moved on the then branch with no source else at all attributes the drop to else anyway", (): void => {
    const result = check(
      `${BOXED}
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        }
        print(1);
      }`,
    );
    expect(result.diagnostics).toEqual([]);
    const main = result.functions.get("main");
    assert(main !== undefined, "Expected main's ownership result");
    expect([...main.conditionalDrops.values()].flat()).toEqual([]);
    const xDrop = main.branchDrops.find((d) => d.declaration.name === "x");
    assert(xDrop !== undefined, "Expected a branch drop for x");
    expect(xDrop.branch).toBe("else");
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

  it("tags a use-after-move diagnostic with the HEDGE-BORROW-CHECK-003 code and names the move site as a related span", (): void => {
    const source = `${BOXED}
      fn main() {
        let x = Boxed { value: 1 };
        let y = x; // moved here
        print(x.value);
      }`;
    const { diagnostics } = check(source);
    expect(diagnostics).toHaveLength(1);
    const diagnostic = diagnostics[0];
    assert(diagnostic !== undefined, "Expected a diagnostic");
    expect(diagnostic.code).toEqual(some("HEDGE-BORROW-CHECK-003"));
    expect(diagnostic.relatedSpans).toHaveLength(1);
    const moveOffset = source.indexOf("x;", source.indexOf("let y ="));
    const relatedSpan = diagnostic.relatedSpans[0];
    assert(relatedSpan !== undefined, "Expected related span");
    expect(relatedSpan.span.start).toBe(moveOffset);
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

  it("borrowing a non-Copy struct binding with &mut is a use, not a move", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut x = Boxed { value: 1 };
        let r = &mut x;
        print(r);
        print(x.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("borrowing a non-Copy struct binding with & is a use, not a move", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = Boxed { value: 1 };
        let r = &x;
        print(r);
        print(x.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects passing a dereferenced non-Copy value by value out of a reference", (): void => {
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
  });

  it("rejects moving a non-Copy value out through a &mut reference too, not just &", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn take(v: Boxed) { print(v.value); }
      fn main() {
        let mut x = Boxed { value: 1 };
        let r = &mut x;
        take(*r);
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("cannot move");
  });

  it("does not reject reading a field through a dereferenced non-Copy value", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let x = Boxed { value: 1 };
        let r = &x;
        print((*r).value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("does not reject writing the whole referent through a &mut dereference", (): void => {
    const { diagnostics } = check(
      `${BOXED}
      fn main() {
        let mut x = Boxed { value: 1 };
        let r = &mut x;
        *r = Boxed { value: 2 };
        print(x.value);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

  it("does not reject passing a dereferenced Copy value by value out of a reference", (): void => {
    const { diagnostics } = check(
      `fn take(v: i32) { print(v); }
      fn main() {
        let x = 1;
        let r = &x;
        take(*r);
      }`,
    );
    expect(diagnostics).toEqual([]);
  });

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

  describe("--warn-drop-flags", (): void => {
    it("names the binding in the warning message", (): void => {
      expect(conditionalDropFlagWarning("x")).toContain("x");
      expect(conditionalDropFlagWarning("x")).toContain("drop flag");
    });

    it("emits no warnings for a statically-resolved conditional move, since it never reaches the flag path", (): void => {
      const result = check(
        `${BOXED}
        fn main() {
          let mut cond = true;
          let x = Boxed { value: 1 };
          if cond {
            let y = x;
            print(y.value);
          } else {
            print(0);
          }
        }`,
        { warnDropFlags: true },
      );
      expect(
        result.diagnostics.filter((d) => d.severity === "warning"),
      ).toEqual([]);
    });

    it("emits no warnings by default (option omitted) for the same program", (): void => {
      const result = check(
        `${BOXED}
        fn main() {
          let mut cond = true;
          let x = Boxed { value: 1 };
          if cond {
            let y = x;
            print(y.value);
          } else {
            print(0);
          }
        }`,
      );
      expect(
        result.diagnostics.filter((d) => d.severity === "warning"),
      ).toEqual([]);
    });
  });

  describe("arrays are move-only, even with Copy elements", (): void => {
    it("reads an array through indexing multiple times without treating each read as a move, matching field access's own use-not-move treatment", (): void => {
      const { diagnostics } = check(`
        fn main() {
          let arr: [i32; 3] = [1, 2, 3];
          print(arr[0]);
          print(arr[1]);
          print(arr[2]);
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("rejects using an array after it has been moved into another binding", (): void => {
      const { diagnostics } = check(`
        fn main() {
          let a: [i32; 3] = [1, 2, 3];
          let b = a; // move occurs here
          print(a[0]); // use of moved value
          print(b[0]);
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("moved");
    });

    it("rejects using an array after passing it by value into a function call", (): void => {
      const { diagnostics } = check(`
        fn take(arr: [i32; 3]) { print(arr[0]); }
        fn main() {
          let a: [i32; 3] = [1, 2, 3];
          take(a); // moved here
          print(a[0]);
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("moved");
    });

    it("accepts reassigning an array binding after it was moved away", (): void => {
      const { diagnostics } = check(`
        fn main() {
          let mut a: [i32; 3] = [1, 2, 3];
          let b = a; // move occurs here
          a = [4, 5, 6];
          print(a[0]);
          print(b[0]);
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("rejects using an array of non-Copy struct elements after it has been moved into another binding", (): void => {
      const { diagnostics } = check(`
        struct Boxed { value: i32 }
        fn main() {
          let arr = [Boxed { value: 1 }, Boxed { value: 2 }];
          let moved = arr; // move occurs here
          print(arr[0].value); // use of moved value
          print(moved[0].value);
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("moved");
    });

    it.fails(
      "rejects binding a non-Copy array element to a new variable by value out of an index",
      (): void => {
        // arr[i] is treated as a use of arr (not a move), matching field
        // access - but nothing yet stops the *result* of that index from
        // being bound elsewhere, and a JS object read this way is a true
        // alias, not a copy. Both `x` and `arr` would dispose the same
        // underlying object at scope end. Same class of gap as the
        // dereferenced-non-Copy-value it.fails above, just reached through
        // indexing instead of a reference.
        const { diagnostics } = check(`
          struct Boxed { value: i32 }
          fn main() {
            let arr = [Boxed { value: 1 }, Boxed { value: 2 }];
            let x = arr[0];
            print(x.value);
          }
        `);
        expect(diagnostics).toHaveLength(1);
        assert(diagnostics[0] !== undefined, "Expected a diagnostic");
        expect(diagnostics[0].message).toContain("cannot move");
      },
    );
  });

  describe("destructuring pattern move vs. borrow of the scrutinee", (): void => {
    it("does not move the scrutinee when every let-destructured sub-binding is byRef", (): void => {
      const { diagnostics } = check(`
        struct Point { x: i32, y: i32 }
        fn main() {
          let mut p = Point { x: 1, y: 2 };
          let Point { x: &mut rx, y } = p;
          *rx = 99;
          print(p.y);
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("does not move the scrutinee when every let-destructured sub-binding is a Copy field with no byRef sigil", (): void => {
      const { diagnostics } = check(`
        struct Point { x: i32, y: i32 }
        fn main() {
          let p = Point { x: 1, y: 2 };
          let Point { x, y } = p;
          print(p.x);
          print(x);
          print(y);
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("still moves the scrutinee when a let-destructured sub-binding owns a non-Copy field", (): void => {
      const { diagnostics } = check(`
        struct Boxed { value: i32 }
        struct Pair { a: Boxed, b: i32 }
        fn main() {
          let p = Pair { a: Boxed { value: 1 }, b: 2 };
          let Pair { a, b } = p;
          print(p.b);
          print(a.value);
          print(b);
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("moved");
    });

    it("does not move the scrutinee when every match-arm sub-binding is byRef", (): void => {
      const { diagnostics } = check(`
        struct Point { x: i32, y: i32 }
        fn main() {
          let mut p = Point { x: 1, y: 2 };
          match p { Point { x: &mut rx, y } => { *rx = 99; } }
          print(p.y);
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it("still moves the scrutinee when a match-arm sub-binding owns a non-Copy field", (): void => {
      const { diagnostics } = check(`
        struct Boxed { value: i32 }
        struct Pair { a: Boxed, b: i32 }
        fn main() {
          let p = Pair { a: Boxed { value: 1 }, b: 2 };
          match p { Pair { a, b } => { print(a.value); print(b); } }
          print(p.b);
        }
      `);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("moved");
    });
  });
});
