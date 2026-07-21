import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import { tokenize } from "../lexer/lexer.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import { analyze } from "../semantics/analyzer.js";
import { checkBorrows } from "./borrowck.js";

/**
 * Unlike `testing/analyze-source.js`'s `analyzeSource`, this does not assert
 * zero analysis errors - `checkBorrows` only needs the `Semantics.Program`'s
 * places to be resolvable, so its own returned diagnostics are meaningful
 * regardless of whatever else `analyze` did or didn't flag on the same
 * fixture.
 */
function check(source: string): readonly Diagnostic[] {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  const analysis = analyze(program.value, tokens);
  return checkBorrows(analysis.program, tokens);
}

describe("borrow checker", (): void => {
  it("accepts a single live mutable borrow", (): void => {
    const diagnostics = check(
      'fn main() { let mut x = "a"; let r = &mut x; print(r); }',
    );
    expect(diagnostics).toEqual([]);
  });

  it("counts a use through a dereference for borrow-exclusivity tracking", (): void => {
    const diagnostics = check(
      'fn main() { let mut x = "a"; let r = &mut x; print(*r); }',
    );
    expect(diagnostics).toEqual([]);
  });

  it("accepts many shared borrows at once", (): void => {
    const diagnostics = check(
      'fn main() { let x = "a"; let r1 = &x; let r2 = &x; print(r1); print(r2); }',
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects two overlapping mutable borrows", (): void => {
    const diagnostics = check(
      'fn main() { let mut x = "a"; let r1 = &mut x; let r2 = &mut x; print(r1); print(r2); }',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects an overlapping mutable and shared borrow of the same base", (): void => {
    const diagnostics = check(
      'fn main() { let mut x = "a"; let rw = &mut x; let r = &x; print(rw); print(r); }',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("names both borrow sites' own offsets in a conflicting-borrows diagnostic", (): void => {
    const diagnostics = check(
      'fn main() { let mut x = "a"; let r1 = &mut x; let r2 = &mut x; print(r1); print(r2); }',
    );
    expect(diagnostics).toHaveLength(1);
    const offsetMentions =
      diagnostics[0]?.message.match(/at offset \d+/g) ?? [];
    expect(offsetMentions).toHaveLength(2);
    expect(offsetMentions[0]).not.toEqual(offsetMentions[1]);
  });

  it("accepts sequential mutable borrows (non-lexical, last-use)", (): void => {
    const diagnostics = check(
      'fn main() { let mut x = "a"; let r1 = &mut x; print(r1); let r2 = &mut x; print(r2); }',
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects &mut of a binding not declared mut", (): void => {
    const diagnostics = check(
      'fn main() { let x = "a"; let r = &mut x; print(r); }',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("not declared mut");
  });

  it("rejects &mut borrow of an immutable function parameter", (): void => {
    const diagnostics = check("fn f(x: string) { let r = &mut x; print(r); }");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("not declared mut");
  });

  it("accepts &mut borrow of a mutable function parameter", (): void => {
    const diagnostics = check(
      "fn f(mut x: string) { let r = &mut x; print(r); }",
    );
    expect(diagnostics).toEqual([]);
  });

  it("does not crash on a wildcard let binding or parameter", (): void => {
    const diagnostics = check(
      'fn f(_: i32, mut x: string) { let _ = "a"; let r = &mut x; print(r); }',
    );
    expect(diagnostics).toEqual([]);
  });

  it("accepts a mutable borrow of a mutable binding declared inside an if branch", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = "a";
        if true {
          let r = &mut x;
          print(r);
        }
        let done = true;
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects a mutable borrow of a non-mut binding declared inside an if branch", (): void => {
    const diagnostics = check(`
      fn main() {
        let x = "a";
        if true {
          let r = &mut x;
          print(r);
        }
        let done = true;
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("not declared mut");
  });

  it("accepts two mutable borrows of the same base declared in sibling branches", (): void => {
    const diagnostics = check(`
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
    expect(diagnostics).toEqual([]);
  });

  it("rejects a borrow taken inside a branch while an outer borrow is still live going into that branch", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = "a";
        let r1 = &mut x;
        if true {
          let r2 = &mut x;
          print(r2);
        }
        print(r1);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("accepts a borrow taken inside a branch after an outer borrow's last use ends before the fork", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = "a";
        let r1 = &mut x;
        print(r1);
        if true {
          let r2 = &mut x;
          print(r2);
        }
        let done = true;
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts a borrow taken in a join block after a borrow live into that block has its own last use earlier in the same join block", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = "a";
        let r1 = &mut x;
        if true {
          print("branch");
        }
        print(r1);
        let r2 = &mut x;
        print(r2);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("resolves a borrow's mut capability against its own scope's declaration, not a same-named binding in a different scope", (): void => {
    const diagnostics = check(`
      fn main() {
        if true {
          let mut x = "a";
          let r = &mut x;
          print(r);
        }
        if true {
          let x = "b";
          let s = &mut x;
          print(s);
        }
        let done = true;
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("not declared mut");
  });
});

describe("place-projection borrows", (): void => {
  it("rejects two overlapping mutable borrows of the same struct field", (): void => {
    const diagnostics = check(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let mut p = Point { x: 0, y: 0 };
        let a = &mut p.x;
        let b = &mut p.x;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("accepts two mutable borrows of distinct struct fields", (): void => {
    const diagnostics = check(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let mut p = Point { x: 0, y: 0 };
        let a = &mut p.x;
        let b = &mut p.y;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts any number of shared borrows of the same struct field", (): void => {
    const diagnostics = check(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let p = Point { x: 0, y: 0 };
        let a = &p.x;
        let b = &p.x;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects a shared borrow of a struct overlapping a mutable borrow of one of its fields", (): void => {
    const diagnostics = check(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let mut p = Point { x: 0, y: 0 };
        let a = &p;
        let b = &mut p.x;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects a mutable borrow of a struct field overlapping a shared borrow of the whole struct, regardless of order", (): void => {
    const diagnostics = check(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let mut p = Point { x: 0, y: 0 };
        let a = &mut p.x;
        let b = &p;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects a mutable borrow of the whole struct overlapping a mutable borrow of one of its fields", (): void => {
    const diagnostics = check(`
      struct Point { x: i32, y: i32 }
      fn main() {
        let mut p = Point { x: 0, y: 0 };
        let a = &mut p;
        let b = &mut p.x;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("accepts two mutable borrows of distinct fields two levels deep in a nested struct chain", (): void => {
    const diagnostics = check(`
      struct Inner { b: i32, c: i32 }
      struct Outer { a: Inner }
      fn main() {
        let mut s = Outer { a: Inner { b: 0, c: 0 } };
        let x = &mut s.a.b;
        let y = &mut s.a.c;
        print(x);
        print(y);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects two overlapping mutable borrows of the same field two levels deep in a nested struct chain", (): void => {
    const diagnostics = check(`
      struct Inner { b: i32 }
      struct Outer { a: Inner }
      fn main() {
        let mut s = Outer { a: Inner { b: 0 } };
        let x = &mut s.a.b;
        let y = &mut s.a.b;
        print(x);
        print(y);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
    expect(diagnostics[0]?.message).toContain("s.a.b");
  });

  it("rejects a mutable borrow of a nested field overlapping a mutable borrow of its own containing field", (): void => {
    const diagnostics = check(`
      struct Inner { b: i32 }
      struct Outer { a: Inner }
      fn main() {
        let mut s = Outer { a: Inner { b: 0 } };
        let x = &mut s.a;
        let y = &mut s.a.b;
        print(x);
        print(y);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects two overlapping mutable borrows of the same place reached through a dereference, naming the full place path", (): void => {
    const diagnostics = check(`
      fn f(r: &mut i32) {
        let a = &mut *r;
        let b = &mut *r;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
    expect(diagnostics[0]?.message).toContain("*r");
  });

  it("rejects a shared borrow overlapping a mutable borrow of the same dereferenced place", (): void => {
    const diagnostics = check(`
      fn f(r: &mut i32) {
        let a = &*r;
        let b = &mut *r;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects overlapping mutable borrows reached by dereferencing two bindings that alias the same reference value", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = 1;
        let r = &mut x;
        let s = r;
        let a = &mut *r;
        let b = &mut *s;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects overlapping mutable borrows reached by dereferencing an alias of a &mut function parameter, not just a local borrow", (): void => {
    const diagnostics = check(`
      fn f(r: &mut i32) {
        let s = r;
        let a = &mut *r;
        let b = &mut *s;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("accepts sequential dereferenced borrows through aliased bindings when one alias's last use precedes the other's borrow", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = 1;
        let r = &mut x;
        let s = r;
        let a = &mut *r;
        print(a);
        let b = &mut *s;
        print(b);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects taking &mut through a dereference of a shared reference, naming the reference that blocks it", (): void => {
    const diagnostics = check(`
      fn f(r: &i32) {
        let a = &mut *r;
        print(a);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("cannot borrow");
    expect(diagnostics[0]?.message).toContain("*r");
    expect(diagnostics[0]?.message).toContain("r");
  });

  it("describes the blocking reference as shared, not as an active borrow, since no borrow bookkeeping is involved in this check", (): void => {
    const diagnostics = check(`
      fn f(r: &i32) {
        let a = &mut *r;
        print(a);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected diagnostic");
    expect(diagnostics[0].message).toContain("shared reference");
    expect(diagnostics[0].message).not.toContain("borrowed as immutable");
  });

  it("accepts taking &mut through a dereference of a mutable reference (a reborrow)", (): void => {
    const diagnostics = check(`
      fn f(r: &mut i32) {
        let a = &mut *r;
        print(a);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects &mut through a shared reference reached deeper in a field chain, not just a bare dereference", (): void => {
    const diagnostics = check(`
      struct Foo { value: i32 }
      fn f(r: &Foo) {
        let a = &mut (*r).value;
        print(a);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("cannot borrow");
  });

  it("accepts a shared borrow of a field reached through a dereference of a shared reference", (): void => {
    const diagnostics = check(`
      struct Foo { value: i32 }
      fn f(r: &Foo) {
        let a = &(*r).value;
        print(a);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("does not require the reference-holding local itself to be declared mut, since write capability comes from the reference's own type", (): void => {
    const diagnostics = check(`
      fn main() {
        let mut x = 1;
        let r = &mut x;
        let a = &mut *r;
        print(a);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects two overlapping mutable borrows of the same dynamic index, since dynamic indices are never provably distinct", (): void => {
    const diagnostics = check(`
      fn f(mut arr: [i32; 3]) {
        let a = &mut arr[0];
        let b = &mut arr[0];
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects two overlapping mutable borrows of statically distinct dynamic indices, since indices are never provably distinct", (): void => {
    const diagnostics = check(`
      fn f(mut arr: [i32; 3]) {
        let a = &mut arr[0];
        let b = &mut arr[1];
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("accepts any number of shared borrows of the same dynamic index", (): void => {
    const diagnostics = check(`
      fn f(mut arr: [i32; 3]) {
        let a = &arr[0];
        let b = &arr[0];
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects overlapping mutable borrows of the same field reached through a dynamic index, since the shared Index prefix always overlaps regardless of further divergence", (): void => {
    const diagnostics = check(`
      struct Elem { field: i32 }
      fn f(mut arr: [Elem; 2]) {
        let a = &mut arr[0].field;
        let b = &mut arr[1].field;
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("rejects overlapping mutable borrows of the same array field reached through a struct, mixing field-then-index projections", (): void => {
    // The opposite mixing order from the test above (Index-then-Field,
    // `arr[0].field`) - this is Field-then-Index (`s.arr[0]`), closing the
    // other direction of AC5's "mixed field/index projections" coverage.
    const diagnostics = check(`
      struct Holder { arr: [i32; 3] }
      fn f(mut s: Holder) {
        let a = &mut s.arr[0];
        let b = &mut s.arr[0];
        print(a);
        print(b);
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });
});
