import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isSome, some } from "../option.js";
import { tokenize } from "../lexer/lexer.js";
import { parse } from "./parser.js";

describe("lifetime elision - rule 2 (single reference parameter)", (): void => {
  it("fn first(s: &str) -> &str fills the elided return from the sole reference parameter, zero diagnostics", (): void => {
    const { tokens } = tokenize("fn first(s: &str) -> &str { s }");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const paramType = fn.params[0]?.type;
    assert(paramType?.kind === "ReferenceType", "Expected a reference param");
    assert(
      isSome(paramType.lifetime),
      "Expected the param lifetime to be resolved",
    );
    const returnType = isSome(fn.returnType) ? fn.returnType.value : undefined;
    assert(
      returnType?.kind === "ReferenceType",
      "Expected a reference return type",
    );
    assert(
      isSome(returnType.lifetime),
      "Expected the return lifetime to be resolved",
    );
    // Rule 2: the return type's lifetime is exactly the parameter's.
    expect(returnType.lifetime.value.name).toBe(paramType.lifetime.value.name);
  });

  it("fn f(x: i32, s: &str) -> &str still applies rule 2 - a non-reference parameter doesn't count", (): void => {
    const { tokens } = tokenize("fn f(x: i32, s: &str) -> &str { s }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });
});

describe("lifetime elision - ambiguity rejection", (): void => {
  it("fn longest(a: &str, b: &str) -> &str is rejected as ambiguous (two reference parameters)", (): void => {
    const { tokens } = tokenize("fn longest(a: &str, b: &str) -> &str { a }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("fn f() -> &str {} is rejected as ambiguous (zero reference parameters - boundary case)", (): void => {
    const { tokens } = tokenize('fn f() -> &str { "x" }');
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("an ambiguous signature still produces a structurally complete program (synthesized placeholder), forcing code:none() via the error diagnostic rather than a missing program", (): void => {
    const { tokens } = tokenize("fn longest(a: &str, b: &str) -> &str { a }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to still come back");
    assert(
      diagnostics.some((d) => d.severity === "error"),
      "Expected an error diagnostic",
    );
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const returnType = isSome(fn.returnType) ? fn.returnType.value : undefined;
    assert(
      returnType?.kind === "ReferenceType",
      "Expected a reference return type",
    );
    expect(isSome(returnType.lifetime)).toBe(true);
  });
});

describe("lifetime elision - fully explicit signatures are untouched", (): void => {
  it("fn longest<'a>(a: &'a str, b: &'a str) -> &'a str compiles with explicit annotations, zero diagnostics", (): void => {
    const { tokens } = tokenize(
      "fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a }",
    );
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    for (const param of fn.params) {
      assert(param.type.kind === "ReferenceType", "Expected a reference param");
      assert(
        isSome(param.type.lifetime),
        "Expected the lifetime to be resolved",
      );
      expect(param.type.lifetime.value.name).toBe("a");
    }
  });
});

describe("lifetime elision - synthesized-name collision avoidance", (): void => {
  it("fn f(a: &_0, b: &str) -> &_0 does not synthesize a colliding _0 for the second, unrelated elided parameter", (): void => {
    // `a`'s lifetime is explicitly named "_0" via a synthesized-looking
    // identifier written by the user; `b` is elided and must not receive
    // the same synthesized name, and the ambiguity check still fires since
    // there are two reference parameters.
    const { tokens } = tokenize("fn f(a: &'_0 str, b: &str) -> &'_0 str { a }");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const bType = fn.params[1]?.type;
    assert(bType?.kind === "ReferenceType", "Expected a reference param");
    assert(isSome(bType.lifetime), "Expected b's lifetime to be resolved");
    expect(bType.lifetime.value.name).not.toBe("_0");
  });
});

describe("lifetime elision - nested declarations", (): void => {
  it("elides a lifetime for a fn declared locally inside another fn's body", (): void => {
    const { tokens } = tokenize(
      "fn outer() { fn first(s: &str) -> &str { s } }",
    );
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });

  it("elides a lifetime for a struct declared locally inside a fn's body, rejecting an elided field", (): void => {
    const { tokens } = tokenize("fn outer() { struct Ref { source: &i32 } }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("rejects an elided lifetime on a let-bound reference type declared inside a fn's body", (): void => {
    const { tokens } = tokenize("fn outer() { let x: &i32; }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("rejects an ambiguous fn declared inside a Block expression used as a let initializer - the same construct is rejected at top level or in statement position", (): void => {
    const { tokens } = tokenize(`
      fn main() {
        let x = {
          fn ambiguous(a: &str, b: &str) -> &str { a }
          ambiguous("x", "y")
        };
      }
    `);
    const { diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
  });

  it("elides a lifetime for a fn declared inside a Block expression used as a let initializer, when it isn't ambiguous", (): void => {
    const { tokens } = tokenize(`
      fn main() {
        let x = {
          fn first(s: &str) -> &str { s }
          first("hi")
        };
      }
    `);
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
  });
});

describe("lifetime elision - nested references", (): void => {
  it("fn f(x: &'a mut &'b i32) -> &'a mut &'b i32 { x } - a fully explicit nested reference passes through clean", (): void => {
    const { tokens } = tokenize(
      "fn f(x: &'a mut &'b i32) -> &'a mut &'b i32 { x }",
    );
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });

  it("fn f(x: &'a mut &i32) -> &'a mut &i32 { x } - an elided nested reference (the inner &i32) is rejected; no rule reaches below the top level", (): void => {
    const { tokens } = tokenize("fn f(x: &'a mut &i32) -> &'a mut &i32 { x }");
    const { diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
  });
});

describe("lifetime elision - no rule outside a function signature", (): void => {
  it("let mut x: &i32; is rejected - no elision rule applies to a let annotation", (): void => {
    const { tokens } = tokenize("let mut x: &i32;");
    const { diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
  });

  it("let mut x: &'a i32; is accepted - an explicit lifetime needs no rule", (): void => {
    const { tokens } = tokenize("let mut x: &'a i32;");
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });

  it("struct Cursor<'a> { source: &'a str, pos: usize } parses clean - AC5 shape", (): void => {
    const { tokens } = tokenize(
      "struct Cursor<'a> { source: &'a str, pos: usize }",
    );
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        generics: [{ kind: "Lifetime", name: "a" }],
        body: {
          fields: [
            {
              name: { text: "source" },
              type: {
                kind: "ReferenceType",
                lifetime: some({ kind: "Lifetime", name: "a" }),
              },
            },
            { name: { text: "pos" } },
          ],
        },
      },
    ]);
  });

  it("struct Cursor { source: &str } is rejected - a struct field never gets elision, even without a generics list", (): void => {
    const { tokens } = tokenize("struct Cursor { source: &str }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });
});
