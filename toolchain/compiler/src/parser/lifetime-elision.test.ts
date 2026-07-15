import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isSome, some } from "../option.js";
import { tokenize } from "../lexer/lexer.js";
import { parse } from "./parser.js";

describe("lifetime elision - rule 2 (single reference parameter)", (): void => {
  it("fills the elided return type from the sole reference parameter, with zero diagnostics (fn first(s: &str) -> &str)", (): void => {
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

  it("still applies rule 2 when a non-reference parameter is present, since it doesn't count toward the total", (): void => {
    const { tokens } = tokenize("fn f(x: i32, s: &str) -> &str { s }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });
});

describe("lifetime elision - ambiguity rejection", (): void => {
  it("rejects a signature with two reference parameters as ambiguous", (): void => {
    const { tokens } = tokenize("fn longest(a: &str, b: &str) -> &str { a }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("rejects a signature with zero reference parameters as ambiguous (boundary case)", (): void => {
    const { tokens } = tokenize('fn f() -> &str { "x" }');
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("still produces a structurally complete program for an ambiguous signature (synthesized placeholder), forcing code:none() via the error diagnostic rather than a missing program", (): void => {
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
  it("compiles a signature with fully explicit lifetime annotations, with zero diagnostics", (): void => {
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
  it("does not synthesize a colliding name for an elided parameter when the user already wrote an explicit synthesized-looking lifetime", (): void => {
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

  it("does not let a let-statement's synthesized placeholder lifetime collide with the enclosing function's declared generic lifetime", (): void => {
    // `fn f<'_0>()` declares a lifetime literally named "_0". The elided
    // `let x: &i32;` inside its body has no name of its own to seed a
    // synthesizer from, so an unscoped synthesizer would always pick "_0"
    // first - accidentally reusing the enclosing function's own declared
    // lifetime name for an unrelated placeholder.
    const { tokens } = tokenize("fn f<'_0>() { let x: &i32; }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
      "Expected the elided let annotation to still be rejected",
    );
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const letStmt = fn.body.statements[0];
    assert(letStmt?.kind === "LetStatement", "Expected a LetStatement");
    assert(isSome(letStmt.type), "Expected a type annotation");
    const type = letStmt.type.value;
    assert(type.kind === "ReferenceType", "Expected a reference type");
    assert(isSome(type.lifetime), "Expected the lifetime to be resolved");
    expect(type.lifetime.value.name).not.toBe("_0");
  });

  it("does not let a let-statement's synthesized placeholder lifetime collide with a name the enclosing signature just synthesized for itself", (): void => {
    // `fn f(a: &str) -> &str` has no explicit lifetimes at all, so `a`
    // gets synthesized "_0" by rule 2. The elided `let x: &i32;` inside
    // the body must not reuse "_0" for its own (rejected) placeholder,
    // even though nothing was ever *declared* named "_0" - "_0" only
    // exists because it was just synthesized for `a`.
    const { tokens } = tokenize("fn f(a: &str) -> &str { let x: &i32; a }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
      "Expected the elided let annotation to still be rejected",
    );
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const paramType = fn.params[0]?.type;
    assert(paramType?.kind === "ReferenceType", "Expected a reference param");
    assert(
      isSome(paramType.lifetime),
      "Expected the param lifetime to be resolved",
    );
    const letStmt = fn.body.statements[0];
    assert(letStmt?.kind === "LetStatement", "Expected a LetStatement");
    assert(isSome(letStmt.type), "Expected a type annotation");
    const letType = letStmt.type.value;
    assert(letType.kind === "ReferenceType", "Expected a reference type");
    assert(isSome(letType.lifetime), "Expected the lifetime to be resolved");
    expect(letType.lifetime.value.name).not.toBe(paramType.lifetime.value.name);
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

  it("rejects an ambiguous fn declared inside a Block expression used as a let initializer, the same as at top level or in statement position", (): void => {
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
  it("passes a fully explicit nested reference through clean", (): void => {
    const { tokens } = tokenize(
      "fn f(x: &'a mut &'b i32) -> &'a mut &'b i32 { x }",
    );
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });

  it("rejects an elided nested reference, since no elision rule reaches below the top level", (): void => {
    const { tokens } = tokenize("fn f(x: &'a mut &i32) -> &'a mut &i32 { x }");
    const { diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
  });
});

describe("lifetime elision - no rule outside a function signature", (): void => {
  it("rejects an elided reference type on a let annotation, since no elision rule applies there", (): void => {
    const { tokens } = tokenize("let mut x: &i32;");
    const { diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
  });

  it("accepts an explicit lifetime on a let annotation, since it needs no elision rule", (): void => {
    const { tokens } = tokenize("let mut x: &'a i32;");
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });

  it("parses a struct's own lifetime parameter and stores it on its reference field cleanly (AC5 shape)", (): void => {
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

  it("rejects an elided reference type on a struct field, since a field never gets elision even without a generics list", (): void => {
    const { tokens } = tokenize("struct Cursor { source: &str }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });
});
