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
    const paramType = fn.signature.params[0]?.type;
    assert(paramType?.kind === "ReferenceType", "Expected a reference param");
    assert(
      isSome(paramType.lifetime),
      "Expected the param lifetime to be resolved",
    );
    const returnType = isSome(fn.signature.returnType)
      ? fn.signature.returnType.value
      : undefined;
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

  it("tags an ambiguous-return-lifetime diagnostic with the HEDGE-LIFETIME-001 code", (): void => {
    const { tokens } = tokenize("fn longest(a: &str, b: &str) -> &str { a }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-001");
  });

  it("tags a no-elision-rule diagnostic (e.g. a let annotation) with the same HEDGE-LIFETIME-001 code as the ambiguous-return case", (): void => {
    const { tokens } = tokenize("let mut x: &i32;");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].code).toBe("HEDGE-LIFETIME-001");
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
    const returnType = isSome(fn.signature.returnType)
      ? fn.signature.returnType.value
      : undefined;
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
    for (const param of fn.signature.params) {
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
    // the same synthesized name. The return type's lifetime is also
    // explicit (`&'_0 str`), so the ambiguity check never runs here at
    // all - it only applies to an elided return type.
    const { tokens } = tokenize("fn f(a: &'_0 str, b: &str) -> &'_0 str { a }");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const bType = fn.signature.params[1]?.type;
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
    const paramType = fn.signature.params[0]?.type;
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

  it("rejects an elided reference nested inside a generic type argument (Vec<&T>), resolving it to a synthesized placeholder rather than leaving it none()", (): void => {
    const { tokens } = tokenize("fn f(x: Vec<&T>) {}");
    const { program, diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const paramType = fn.signature.params[0]?.type;
    assert(paramType?.kind === "NamedType", "Expected a named param type");
    const nestedRef = paramType.typeArguments[0];
    assert(
      nestedRef?.kind === "ReferenceType",
      "Expected the nested type argument to be a reference type",
    );
    assert(
      isSome(nestedRef.lifetime),
      "Expected the nested reference's lifetime to be resolved, not left none()",
    );
  });

  it("passes a fully explicit reference nested inside a generic type argument through clean, and collects its name to avoid a synthesizer collision (Vec<&'a T>)", (): void => {
    const { tokens } = tokenize("fn f<'a>(x: Vec<&'a T>) {}");
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
  });

  it("rejects an elided reference nested inside an array element type ([&T; 3]), resolving it to a synthesized placeholder rather than leaving it none()", (): void => {
    const { tokens } = tokenize("fn f(x: [&T; 3]) {}");
    const { program, diagnostics } = parse(tokens);
    expect(
      diagnostics.some((d) => d.message.includes("missing lifetime specifier")),
    ).toBe(true);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(fn?.kind === "Function", "Expected a Function item");
    const paramType = fn.signature.params[0]?.type;
    assert(paramType?.kind === "ArrayType", "Expected an array param type");
    const nestedRef = paramType.elementType;
    assert(
      nestedRef.kind === "ReferenceType",
      "Expected the array element type to be a reference type",
    );
    assert(
      isSome(nestedRef.lifetime),
      "Expected the nested reference's lifetime to be resolved, not left none()",
    );
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
        generics: [
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "a" } },
        ],
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

describe("lifetime elision on a bodiless function signature", (): void => {
  it("still applies rule 2 to a bodiless signature's params/return type, with zero diagnostics (fn first(s: &str) -> &str;)", (): void => {
    const { tokens } = tokenize("fn first(s: &str) -> &str;");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const fn = program.value.items[0];
    assert(
      fn?.kind === "FunctionSignature",
      "Expected a FunctionSignature item",
    );
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
    expect(returnType.lifetime.value.name).toBe(paramType.lifetime.value.name);
  });
});

describe("lifetime elision reaches trait/impl bodies", (): void => {
  it("applies rule 1 to a trait method's own reference parameter, with zero diagnostics", (): void => {
    const { tokens } = tokenize("trait T { fn f(x: &i32); }");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const trait = program.value.items[0];
    assert(trait?.kind === "Trait", "Expected a Trait item");
    const method = trait.items[0];
    assert(method?.kind === "FunctionSignature", "Expected a signature item");
    const paramType = method.params[0]?.type;
    assert(paramType?.kind === "ReferenceType", "Expected a reference param");
    expect(isSome(paramType.lifetime)).toBe(true);
  });

  it("rejects an elided reference in a trait's own associated type value, since no elision rule applies there", (): void => {
    const { tokens } = tokenize("trait T { type Item = &i32; }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });

  it("rejects an elided reference on an impl's own target type, since no elision rule applies to an impl target", (): void => {
    const { tokens } = tokenize("impl &Foo {}");
    const { program, diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
    assert(isSome(program), "Expected a program to still come back");
    const impl = program.value.items[0];
    assert(impl?.kind === "Impl", "Expected an Impl item");
    assert(impl.type.kind === "ReferenceType", "Expected a reference target");
    expect(isSome(impl.type.lifetime)).toBe(true);
  });

  it("applies rule 1 to a method inside a trait nested in an impl body", (): void => {
    const { tokens } = tokenize("impl Foo { trait Nested { fn f(x: &i32); } }");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    const impl = program.value.items[0];
    assert(impl?.kind === "Impl", "Expected an Impl item");
    const nestedTrait = impl.items[0];
    assert(nestedTrait?.kind === "Trait", "Expected a nested Trait item");
    const method = nestedTrait.items[0];
    assert(method?.kind === "FunctionSignature", "Expected a signature item");
    const paramType = method.params[0]?.type;
    assert(paramType?.kind === "ReferenceType", "Expected a reference param");
    expect(isSome(paramType.lifetime)).toBe(true);
  });

  it("rejects an elided reference in a top-level (non-trait) type alias's value", (): void => {
    const { tokens } = tokenize("type Foo = &i32;");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("missing lifetime specifier");
  });
});
