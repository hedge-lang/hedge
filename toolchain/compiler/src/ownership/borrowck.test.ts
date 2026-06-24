import { describe, expect, it } from "vitest";

import type { Diagnostic } from "../diagnostics.js";
import { tokenize } from "../lexer/lexer.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import { checkBorrows } from "./borrowck.js";
import { assert } from "../assert.js";

function check(source: string): readonly Diagnostic[] {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return checkBorrows(program.value, tokens);
}

describe("borrow checker", (): void => {
  it("accepts a single live mutable borrow", (): void => {
    const diagnostics = check(
      'fn main() { let write x = "a"; let r = &write x; print(r); }',
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
      'fn main() { let write x = "a"; let r1 = &write x; let r2 = &write x; print(r1); print(r2); }',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Conflicting borrows");
  });

  it("accepts sequential mutable borrows (non-lexical, last-use)", (): void => {
    const diagnostics = check(
      'fn main() { let write x = "a"; let r1 = &write x; print(r1); let r2 = &write x; print(r2); }',
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects &write of a binding not declared write", (): void => {
    const diagnostics = check(
      'fn main() { let x = "a"; let r = &write x; print(r); }',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("not declared write");
  });
});
