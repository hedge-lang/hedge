import { describe, expect, it } from "vitest";

import { tokenize } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { isErr } from "../result.js";
import type { AnalysisResult } from "./analyzer.js";
import { analyze } from "./analyzer.js";

function diagnose(source: string): AnalysisResult {
  const result = parse(tokenize(source).tokens);
  if (isErr(result)) {
    throw result.error;
  }
  return analyze(result.value);
}

describe("semantic analysis", (): void => {
  it("accepts the tracer bullet with no diagnostics", (): void => {
    const result = diagnose(`
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an undefined name", (): void => {
    const result = diagnose("fn main() { print(missing); }");
    expect(result.diagnostics).toHaveLength(1);
    const first = result.diagnostics[0];
    expect(first?.severity).toBe("error");
    expect(first?.message).toContain("missing");
  });

  it("resolves a let binding within its block", (): void => {
    const result = diagnose('fn main() { let x = "a"; print(x); }');
    expect(result.diagnostics).toEqual([]);
  });

  it("does not resolve a name used before its let binding", (): void => {
    const result = diagnose('fn main() { print(x); let x = "a"; }');
    expect(result.diagnostics).toHaveLength(1);
    const first = result.diagnostics[0];
    expect(first?.message).toContain("x");
  });
});
