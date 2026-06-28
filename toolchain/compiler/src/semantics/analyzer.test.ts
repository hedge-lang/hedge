import { describe, expect, it } from "vitest";
import { assert } from "../assert.js";

import { tokenize } from "../lexer/lexer.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import type { AnalysisResult } from "./analyzer.js";
import { analyze } from "./analyzer.js";

function analyzeWithTokens(source: string): {
  result: AnalysisResult;
  tokens: ReturnType<typeof tokenize>["tokens"];
} {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return { result: analyze(program.value, tokens), tokens };
}

function diagnose(source: string): AnalysisResult {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return analyze(program.value, tokens);
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

  it("resolves a function parameter name inside the function body", (): void => {
    const result = diagnose("fn f(x: i32) { print(x); }");
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an error for a name that does not match any parameter", (): void => {
    const result = diagnose("fn f(x: i32) { print(y); }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("y");
  });

  it("struct declaration does not crash the analyzer", (): void => {
    const result = diagnose("struct Foo;");
    expect(result.diagnostics).toEqual([]);
  });

  describe("top-level item restriction", () => {
    it("bare expression at top level is an error", () => {
      const result = diagnose("x + y;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    });

    it("let statement at top level is an error", () => {
      const result = diagnose("let x = 1;");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    });

    it("block at top level is an error", () => {
      const result = diagnose("{ 1; }");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(
        "only function and struct declarations are allowed at the top level",
      );
    });

    it("function declaration at top level is accepted", () => {
      const result = diagnose("fn f() {}");
      expect(result.diagnostics).toEqual([]);
    });

    it("struct declaration at top level is accepted", () => {
      const result = diagnose("struct Foo;");
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("rejects &x with a Slice 1 diagnostic", (): void => {
    const result = diagnose("fn f(x: i32) { &x; }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("rejects an unsupported param type with a Slice 1 diagnostic", (): void => {
    const result = diagnose("fn f(x: UnknownType) {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("rejects a qualified type in a param position with a Slice 1 diagnostic", (): void => {
    const result = diagnose("fn f(x: i32::Foo) {}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("unsupported param type diagnostic span points at the type token", (): void => {
    const source = "fn f(x: UnknownType) {}";
    const { result } = analyzeWithTokens(source);
    expect(result.diagnostics).toHaveLength(1);
    assert(result.diagnostics[0] !== undefined, "Expected diagnostics");
    const span = result.diagnostics[0].span;
    assert(isSome(span), "Expected span");
    expect(span.value.start).toBe(source.indexOf("UnknownType"));
  });

  describe("integer literal range validation", () => {
    describe("negated literal in binary expression", () => {
      it("rejects a negated literal below i8 min in a comparison", () => {
        const result = diagnose("fn f(x: i8) { print(-0x81 == x); }");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("out of range for i8");
      });

      it("accepts a negated literal at exactly i8 min in a comparison", () => {
        const result = diagnose("fn f(x: i8) { print(-0x80 == x); }");
        expect(result.diagnostics).toEqual([]);
      });
    });
  });
});
