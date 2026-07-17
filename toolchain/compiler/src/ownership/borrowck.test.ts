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
 * zero analysis errors: every source here uses `&`/`&mut`, which the
 * analyzer's Slice-1 guardrail (see root CLAUDE.md) unconditionally rejects.
 * `checkBorrows`'s own returned diagnostics are independent of that guardrail
 * error, exactly as they were before this file's checks ran through `analyze`
 * at all - only the guardrail's rejection lifts (issue #25) does this
 * helper's behavior change.
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
});
