import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import { tokenize } from "../lexer/lexer.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import { analyze } from "../semantics/analyzer.js";
import type { OwnershipCheckResult } from "./move-check.js";
import { analyzeOwnership } from "./move-check.js";

function check(source: string): OwnershipCheckResult {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  const analysis = analyze(program.value, tokens);
  assert(
    analysis.diagnostics.every((d) => d.severity !== "error"),
    analysis.diagnostics.map((d) => d.message).join("; "),
  );
  return analyzeOwnership(analysis.program, tokens);
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
          let b = a;
          print(b.value);
        } else {
          print(0);
        }
        print(x);
        print(y);
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
