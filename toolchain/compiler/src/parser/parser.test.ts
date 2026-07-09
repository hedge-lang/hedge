import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isNone, isSome, none, some } from "../option.js";
import { parse } from "./parser.js";
import { tokenize } from "../lexer/lexer.js";
import { HARD_KEYWORDS } from "../lexer/keywords.js";
import type { Program } from "./ast.js";

function parseProgram(source: string): Program {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return program.value;
}

describe("parser", (): void => {
  it("parses a string literal", (): void => {
    const ast = parseProgram('"Hello, world!"');
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "StringLiteral",
          value: "Hello, world!",
        },
      ],
    });
  });

  it("parses a simple let binding", (): void => {
    const ast = parseProgram('let x = "string literal";');
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "LetStatement",
          mutable: false,
          pattern: {
            kind: "BindingPattern",
            name: {
              kind: "Identifier",
              text: "x",
            },
          },
          type: none(),
          initializer: some({
            kind: "StringLiteral",
            value: "string literal",
          }),
        },
      ],
    });
  });

  it("parses a simple function call", (): void => {
    const ast = parseProgram('print("Hello, world!");');
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "CallExpression",
            callee: {
              kind: "PathExpression",
              path: {
                absolute: false,
                segments: ["print"],
              },
            },
            arguments: [
              {
                kind: "StringLiteral",
                value: "Hello, world!",
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a simple function declaration", (): void => {
    const ast = parseProgram("fn main() {}");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Function",
          name: {
            kind: "Identifier",
            text: "main",
          },
        },
      ],
    });
  });

  it("parses the tracer bullet", (): void => {
    const ast = parseProgram(`
          fn main() {
            let greeting = "Hello, world!";
            print(greeting);
          }
        `);

    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Function",
          name: {
            kind: "Identifier",
            text: "main",
          },
          generics: [],
          params: [],
          returnType: none(),
          whereClause: none(),
          body: {
            kind: "Block",
            statements: [
              {
                kind: "LetStatement",
                mutable: false,
                pattern: {
                  kind: "BindingPattern",
                  name: {
                    kind: "Identifier",
                    text: "greeting",
                  },
                },
                type: none(),
                initializer: some({
                  kind: "StringLiteral",
                  value: "Hello, world!",
                }),
              },
              {
                kind: "ExpressionStatement",
                expression: {
                  kind: "CallExpression",
                  callee: {
                    kind: "PathExpression",
                    path: {
                      absolute: false,
                      segments: ["print"],
                    },
                  },
                  arguments: [
                    {
                      kind: "PathExpression",
                      path: {
                        absolute: false,
                        segments: ["greeting"],
                      },
                    },
                  ],
                },
              },
            ],
            trailingExpression: none(),
          },
        },
      ],
    });
  });
});

describe("path expressions", (): void => {
  it("parses a single-segment path", (): void => {
    const ast = parseProgram("foo;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "PathExpression",
            path: { absolute: false, segments: ["foo"] },
          },
        },
      ],
    });
  });

  it("parses a multi-segment qualified path", (): void => {
    const ast = parseProgram("std::io::print;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "PathExpression",
            path: { absolute: false, segments: ["std", "io", "print"] },
          },
        },
      ],
    });
  });

  it("parses an absolute path", (): void => {
    const ast = parseProgram("::std::io;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "PathExpression",
            path: { absolute: true, segments: ["std", "io"] },
          },
        },
      ],
    });
  });

  it("parses a qualified path used as a call callee", (): void => {
    const ast = parseProgram('std::io::print("hi");');
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "CallExpression",
            callee: {
              kind: "PathExpression",
              path: { absolute: false, segments: ["std", "io", "print"] },
            },
            arguments: [{ kind: "StringLiteral", value: "hi" }],
          },
        },
      ],
    });
  });

  it("returns an error for a trailing path separator", (): void => {
    const result = parse(tokenize("foo::;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      'Expected identifier after "::"',
    );
  });

  it("returns an error for an empty path (bare leading `::`)", (): void => {
    const { program, diagnostics } = parse(tokenize("::;").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Expected an identifier");
  });
});

describe("self/super/Self path segment diagnostics", (): void => {
  function assertSlice7Error(input: string, kw: string): void {
    const { tokens } = tokenize(input);
    const keyword = tokens.find((t) => t.kind === "keyword" && t.text === kw);
    assert(keyword !== undefined, `Expected to find a ${kw} keyword token`);
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("Slice 7");
    expect(diagnostics[0].span).toEqual(some(keyword.span));
  }

  it("produces a Slice 7 diagnostic for `super` as a segment after `::`", (): void => {
    assertSlice7Error("::super;", "super");
  });

  it("produces a Slice 7 diagnostic for `self` as a non-first segment", (): void => {
    assertSlice7Error("foo::self;", "self");
  });

  it("produces a Slice 7 diagnostic for `self` as a non-first segment in type position", (): void => {
    assertSlice7Error("let x: std::self::Foo;", "self");
  });

  it("produces a Slice 7 diagnostic for `self` before a turbofish, ahead of any generics guardrail", (): void => {
    assertSlice7Error("self::<T>;", "self");
  });

  it.each(["self", "super", "Self"])(
    "produces a Slice 7 diagnostic for bare `%s` in expression position",
    (text): void => {
      assertSlice7Error(`${text};`, text);
    },
  );

  it("produces a Slice 7 diagnostic for bare `self` in type position", (): void => {
    assertSlice7Error("let x: self::Foo;", "self");
  });

  it("produces a Slice 7 diagnostic for bare `Self` in type position", (): void => {
    assertSlice7Error("let x: Self;", "Self");
  });

  it("produces a Slice 7 diagnostic for bare `self` in struct-construction position", (): void => {
    assertSlice7Error("self::Foo {}", "self");
  });
});

describe("type annotations", (): void => {
  it("parses a named type annotation on a let binding", (): void => {
    const ast = parseProgram("let x: i32 = 0;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({
            kind: "NamedType",
            path: { absolute: false, segments: ["i32"] },
          }),
        },
      ],
    });
  });

  it("parses a named type with no initializer", (): void => {
    const ast = parseProgram("let p: Point;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({
            kind: "NamedType",
            path: { absolute: false, segments: ["Point"] },
          }),
          initializer: none(),
        },
      ],
    });
  });

  it("parses a qualified named type", (): void => {
    const ast = parseProgram("let f: std::io::File;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({
            kind: "NamedType",
            path: { absolute: false, segments: ["std", "io", "File"] },
          }),
        },
      ],
    });
  });

  it("parses a unit type annotation on a let binding", (): void => {
    const ast = parseProgram("let u: ();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({ kind: "UnitType" }),
          initializer: none(),
        },
      ],
    });
  });

  it.todo("let x: i32 = y = 5 is a parse success and a type error");

  it("parses a unit-typed let with a unit initializer", (): void => {
    const ast = parseProgram("let u: () = ();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({ kind: "UnitType" }),
          initializer: some({ kind: "TupleExpression", elements: [] }),
        },
      ],
    });
  });

  it("parses a return type on a function", (): void => {
    const ast = parseProgram("fn add() -> i32 {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          returnType: some({
            kind: "NamedType",
            path: { absolute: false, segments: ["i32"] },
          }),
        },
      ],
    });
  });

  it("parses a unit return type on a function", (): void => {
    const ast = parseProgram("fn nothing() -> () {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          returnType: some({ kind: "UnitType" }),
        },
      ],
    });
  });

  it("records no return type when the arrow is absent", (): void => {
    const ast = parseProgram("fn f() {}");
    expect(ast).toMatchObject({
      items: [{ kind: "Function", returnType: none() }],
    });
  });

  it("returns an error for an unsupported type syntax", (): void => {
    const result = parse(tokenize("let x: &i32;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
  });
});

describe("type annotation error diagnostics", (): void => {
  it("produces an error diagnostic for a reference type", (): void => {
    const { tokens } = tokenize("let x: &i32;");
    const amp = tokens.find((t) => t.kind === "amp");
    assert(amp !== undefined, "Expected to find an amp token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(amp.span));
  });

  it("produces an error diagnostic for an exclusive reference type", (): void => {
    const { tokens } = tokenize("let x: &mut i32;");
    const amp = tokens.find((t) => t.kind === "amp");
    assert(amp !== undefined, "Expected to find an amp token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(amp.span));
  });

  it("produces an error diagnostic for a slice type", (): void => {
    const { tokens } = tokenize("let xs: [i32];");
    const lbracket = tokens.find((t) => t.kind === "lbracket");
    assert(lbracket !== undefined, "Expected to find a lbracket token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("[T]");
    expect(result.diagnostics[0]?.span).toEqual(some(lbracket.span));
  });

  it("produces an error diagnostic for the never type", (): void => {
    const { tokens } = tokenize("fn f() -> ! {}");
    const bang = tokens.find((t) => t.kind === "bang");
    assert(bang !== undefined, "Expected to find a bang token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("!");
    expect(result.diagnostics[0]?.span).toEqual(some(bang.span));
  });

  it("produces the existing reference-type diagnostic for a lifetime-annotated reference param", (): void => {
    const { tokens } = tokenize("fn f(x: &'a i32) {}");
    const amp = tokens.find((t) => t.kind === "amp");
    assert(amp !== undefined, "Expected to find an amp token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("reference");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].span).toEqual(some(amp.span));
  });

  it("produces the existing reference-type diagnostic for a lifetime-annotated reference return type", (): void => {
    const { tokens } = tokenize("fn f() -> &'a i32 {}");
    const amp = tokens.find((t) => t.kind === "amp");
    assert(amp !== undefined, "Expected to find an amp token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("reference");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].span).toEqual(some(amp.span));
  });

  it("produces the existing reference-type diagnostic for a lifetime-annotated exclusive reference param", (): void => {
    const { tokens } = tokenize("fn f(x: &'a mut i32) {}");
    const amp = tokens.find((t) => t.kind === "amp");
    assert(amp !== undefined, "Expected to find an amp token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("reference");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].span).toEqual(some(amp.span));
  });
});

describe("generics guardrail — type position", (): void => {
  it("produces an error diagnostic for a generic type on a let binding", (): void => {
    const { tokens } = tokenize("let x: Vec<T>;");
    const lt = tokens.find((t) => t.kind === "lt");
    assert(lt !== undefined, "Expected to find a lt token");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("generic");
    expect(diagnostics[0].span).toEqual(some(lt.span));
  });

  it("produces an error diagnostic for a generic return type", (): void => {
    const { tokens } = tokenize("fn f() -> Vec<T> {}");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("generic");
  });

  it("produces an error diagnostic for a generic struct field type", (): void => {
    const { tokens } = tokenize("struct S { x: Vec<T> }");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("generic");
  });

  it("produces an error diagnostic for a nested generic type", (): void => {
    const { tokens } = tokenize("let x: Vec<Vec<T>>;");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("generic");
    expect(diagnostics).toHaveLength(1);
  });

  it("produces an error diagnostic for a turbofish-shaped generic type (Vec::<T>)", (): void => {
    // parsePathSegments stops before consuming `::<` (leaving `::` unconsumed
    // for the caller), so this guardrail must check for `path_sep` followed
    // by `lt`, not just a bare `lt`, or this form falls through to a
    // confusing unrelated "expected ';'" error instead.
    const { tokens } = tokenize("let x: Vec::<T>;");
    const pathSep = tokens.find((t) => t.kind === "path_sep");
    assert(pathSep !== undefined, "Expected to find a path_sep token");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("generic");
    expect(diagnostics[0].span).toEqual(some(pathSep.span));
  });

  it("produces an error diagnostic for a bare < with no preceding type name", (): void => {
    const { tokens } = tokenize("let x: <T>;");
    const lt = tokens.find((t) => t.kind === "lt");
    assert(lt !== undefined, "Expected to find a lt token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("generic");
    expect(diagnostics[0].span).toEqual(some(lt.span));
  });
});

describe("lifetime guardrail — generic type argument position", (): void => {
  it("produces a lifetime-specific diagnostic for Vec<'a>", (): void => {
    const { tokens } = tokenize("let x: Vec<'a>;");
    const lt = tokens.find((t) => t.kind === "lt");
    assert(lt !== undefined, "Expected to find a lt token");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].span).toEqual(some(lt.span));
  });

  it("produces a lifetime-specific diagnostic for Vec<'a, T>", (): void => {
    const { tokens } = tokenize("let x: Vec<'a, T>;");
    const lt = tokens.find((t) => t.kind === "lt");
    assert(lt !== undefined, "Expected to find a lt token");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].span).toEqual(some(lt.span));
  });

  it("produces a lifetime-specific diagnostic for a turbofish-shaped Vec::<'a>", (): void => {
    const { tokens } = tokenize("let x: Vec::<'a>;");
    const pathSep = tokens.find((t) => t.kind === "path_sep");
    assert(pathSep !== undefined, "Expected to find a path_sep token");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].span).toEqual(some(pathSep.span));
  });

  it("still produces the generic-Slice-4 diagnostic for Vec<T> (regression)", (): void => {
    const { tokens } = tokenize("let x: Vec<T>;");
    const { diagnostics, program } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 4");
    expect(diagnostics[0].message).not.toContain("lifetime");
  });
});

describe("struct declarations", (): void => {
  it("parses a unit struct", (): void => {
    const ast = parseProgram("struct Foo;");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
          body: { kind: "Unit" },
        },
      ],
    });
  });

  it("parses an empty named-field struct body", (): void => {
    const ast = parseProgram("struct Foo {}");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
          body: { kind: "NamedFields", fields: [] },
        },
      ],
    });
  });

  it("parses an empty tuple struct body", (): void => {
    const ast = parseProgram("struct Foo();");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
          body: { kind: "TupleFields", fields: [] },
        },
      ],
    });
  });

  it("parses a struct with two named fields", (): void => {
    const ast = parseProgram("struct Point { x: i32, y: i32 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Point" },
          body: {
            kind: "NamedFields",
            fields: [
              {
                kind: "StructField",
                name: { kind: "Identifier", text: "x" },
                type: {
                  kind: "NamedType",
                  path: { absolute: false, segments: ["i32"] },
                },
              },
              {
                kind: "StructField",
                name: { kind: "Identifier", text: "y" },
                type: {
                  kind: "NamedType",
                  path: { absolute: false, segments: ["i32"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("accepts a trailing comma in the named-field list", (): void => {
    const ast = parseProgram("struct Foo { x: i32, }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          body: {
            kind: "NamedFields",
            fields: [{ name: { text: "x" } }],
          },
        },
      ],
    });
  });

  it("parses a tuple struct with fields", (): void => {
    const ast = parseProgram("struct Pair(i32, u64);");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Pair" },
          body: {
            kind: "TupleFields",
            fields: [
              {
                kind: "TupleField",
                type: { kind: "NamedType", path: { segments: ["i32"] } },
              },
              {
                kind: "TupleField",
                type: { kind: "NamedType", path: { segments: ["u64"] } },
              },
            ],
          },
        },
      ],
    });
  });

  it("accepts a trailing comma in the tuple-field list", (): void => {
    const ast = parseProgram("struct Foo(i32,);");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          body: {
            kind: "TupleFields",
            fields: [
              { type: { kind: "NamedType", path: { segments: ["i32"] } } },
            ],
          },
        },
      ],
    });
  });

  it("parses pub visibility on a struct", (): void => {
    const ast = parseProgram("pub struct Foo {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          visibility: some({ kind: "Visibility", scope: none() }),
          body: { kind: "NamedFields", fields: [] },
        },
      ],
    });
  });

  it("parses pub(package) visibility on a struct", (): void => {
    const ast = parseProgram("pub(package) struct Foo {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          visibility: some({ kind: "Visibility", scope: some("package") }),
        },
      ],
    });
  });

  it("parses pub visibility on a named field", (): void => {
    const ast = parseProgram("struct Foo { pub x: i32 }");
    expect(ast).toMatchObject({
      items: [
        {
          body: {
            kind: "NamedFields",
            fields: [
              {
                visibility: some({ kind: "Visibility", scope: none() }),
                name: { kind: "Identifier", text: "x" },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses pub(package) visibility on a named field", (): void => {
    const ast = parseProgram("struct Foo { pub(package) x: i32 }");
    expect(ast).toMatchObject({
      items: [
        {
          body: {
            kind: "NamedFields",
            fields: [
              {
                visibility: some({
                  kind: "Visibility",
                  scope: some("package"),
                }),
                name: { kind: "Identifier", text: "x" },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses pub visibility on a tuple field", (): void => {
    const ast = parseProgram("struct Foo(pub i32);");
    expect(ast).toMatchObject({
      items: [
        {
          body: {
            kind: "TupleFields",
            fields: [
              {
                kind: "TupleField",
                visibility: some({ kind: "Visibility", scope: none() }),
                type: { kind: "NamedType" },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a primitive named type on a struct field", (): void => {
    const ast = parseProgram("struct Foo { field: u32 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
          body: {
            kind: "NamedFields",
            fields: [
              {
                name: { kind: "Identifier", text: "field" },
                type: {
                  kind: "NamedType",
                  path: { absolute: false, segments: ["u32"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a qualified named type on a struct field", (): void => {
    const ast = parseProgram("struct Foo { field: std::io::File }");
    expect(ast).toMatchObject({
      items: [
        {
          body: {
            kind: "NamedFields",
            fields: [
              {
                name: { kind: "Identifier", text: "field" },
                type: {
                  kind: "NamedType",
                  path: { absolute: false, segments: ["std", "io", "File"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a unit type annotation on a struct field", (): void => {
    const ast = parseProgram("struct Foo { field: () }");
    expect(ast).toMatchObject({
      items: [
        {
          body: {
            kind: "NamedFields",
            fields: [
              {
                name: { kind: "Identifier", text: "field" },
                type: { kind: "UnitType" },
              },
            ],
          },
        },
      ],
    });
  });

  it("rejects a tuple type annotation on a struct field", (): void => {
    const { tokens } = tokenize("struct Foo { field: (i32) }");
    const result = parse(tokens);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain(
      "tuple types are not supported",
    );
  });

  it("tokenId on a pub named field points to the field name, not pub", (): void => {
    const { tokens } = tokenize("struct Foo { pub x: i32 }");
    const { program } = parse(tokens);
    assert(isSome(program), "expected program to compile");
    const struct = program.value.items[0];
    assert(
      struct?.kind === "Struct" && struct.body.kind === "NamedFields",
      "expected Struct with NamedFields",
    );
    const field = struct.body.fields[0];
    assert(field !== undefined, "expected field to exist");
    const token = tokens[field.tokenId];
    assert(token !== undefined, "expected token to exist");
    expect(token).toMatchObject({
      kind: "ident",
      text: "x",
    });
  });
});

describe("attributes on let statements", (): void => {
  it("attaches an outer attribute to a top-level let", (): void => {
    const ast = parseProgram("#[attr] let x = 1;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          attributes: [
            {
              kind: "Attribute",
              name: { kind: "Identifier", text: "attr" },
            },
          ],
        },
      ],
    });
  });

  it("attaches a doc comment to a let inside a block", (): void => {
    const ast = parseProgram("fn f() { /// Counter\nlet x = 1; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "LetStatement",
                attributes: [
                  {
                    name: { text: "doc" },
                    arguments: some([
                      {
                        literal: some({ value: "Counter" }),
                      },
                    ]),
                  },
                ],
              },
            ],
          },
        },
      ],
    });
  });
});

describe("attribute int literal arguments", (): void => {
  it("#[align(8)] parses the int arg as an IntLiteral", (): void => {
    const ast = parseProgram("#[align(8)] fn f() {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [
            {
              kind: "Attribute",
              name: { kind: "Identifier", text: "align" },
              arguments: some([
                { literal: some({ kind: "IntLiteral", value: "8", base: 10 }) },
              ]),
            },
          ],
        },
      ],
    });
  });
});

describe("attribute parsing guardrails", (): void => {
  it("returns an error for an attribute arg that is neither string, int, nor path", (): void => {
    const result = parse(tokenize("#[attr(1.5)] fn f() {}").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "Expected attribute argument",
    );
  });

  it("returns an error when an attribute argument list is not closed", (): void => {
    const result = parse(tokenize("#[attr(").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("unterminated");
  });

  it("returns an error when `]` is missing after attribute arguments", (): void => {
    const result = parse(tokenize("#[attr(x) fn f() {}").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("rbracket");
  });
});

describe("tuple type guardrail", (): void => {
  it("returns an error for a parenthesized non-unit type", (): void => {
    const result = parse(tokenize("let x: (i32);").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "tuple types are not supported",
    );
  });

  it("returns a clear error (not 'tuple types') for an unclosed ( in type position", (): void => {
    const result = parse(tokenize("let x: (").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).not.toContain("tuple");
    expect(result.diagnostics[0]?.message).toContain(")");
  });

  it("still parses the unit type `()` successfully", (): void => {
    const ast = parseProgram("let x: ();");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", type: some({ kind: "UnitType" }) }],
    });
  });
});

describe("visibility guardrails", (): void => {
  it("returns an error for pub on a let statement", (): void => {
    const result = parse(tokenize("pub let x = 1;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("let");
  });

  it("rejects pub(self) with a Slice 1 diagnostic", (): void => {
    const result = parse(tokenize("pub(self) struct Foo;").tokens);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("rejects pub(super) with a Slice 1 diagnostic", (): void => {
    const result = parse(tokenize("pub(super) struct Foo;").tokens);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("rejects a visibility qualifier before a bare expression", (): void => {
    const result = parse(tokenize("pub 42;").tokens);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("visibility");
  });
});

describe("identifiers", (): void => {
  describe("keyword-prefix function names are valid identifiers", (): void => {
    it("can define a function named fn_helper", (): void => {
      const ast = parseProgram("fn fn_helper() {}");
      expect(ast).toMatchObject({
        items: [
          { kind: "Function", name: { kind: "Identifier", text: "fn_helper" } },
        ],
      });
    });

    it("can define a function named let_count", (): void => {
      const ast = parseProgram("fn let_count() {}");
      expect(ast).toMatchObject({
        items: [
          { kind: "Function", name: { kind: "Identifier", text: "let_count" } },
        ],
      });
    });
  });

  describe("keyword in identifier position", (): void => {
    it("rejects a hard keyword as a function name", (): void => {
      const result = parse(tokenize("fn fn() {}").tokens);
      expect(result.program).toEqual(none());
      expect(result.diagnostics[0]?.message).toContain("identifier");
    });

    it("rejects a hard keyword as a let binding name", (): void => {
      const result = parse(tokenize("let fn = 1;").tokens);
      expect(result.program).toEqual(none());
      expect(result.diagnostics[0]?.message).toContain("identifier");
    });

    const ALL_HARD_KEYWORDS = Array.from(HARD_KEYWORDS);

    it.each(ALL_HARD_KEYWORDS)(
      "rejects hard keyword %s as a function name with a diagnostic naming the keyword",
      (kw) => {
        const result = parse(tokenize(`fn ${kw}() {}`).tokens);
        assert(
          isNone(result.program),
          `expected parse("fn ${kw}() {}") to fail`,
        );
        expect(result.diagnostics[0]?.message).toContain(kw);
      },
    );

    it.each(ALL_HARD_KEYWORDS)(
      "rejects hard keyword %s as a let binding name with a diagnostic naming the keyword",
      (kw) => {
        const result = parse(tokenize(`let ${kw} = 1;`).tokens);
        assert(
          isNone(result.program),
          `expected parse("let ${kw} = 1;") to fail`,
        );
        expect(result.diagnostics[0]?.message).toContain(kw);
      },
    );
  });

  describe("reserved keyword diagnostics", (): void => {
    it("rejects mut used as a binding name (without pattern)", (): void => {
      const result = parse(tokenize("let mut = 1;").tokens);
      expect(result.program).toEqual(none());
    });

    it("rejects mut as a function name with a diagnostic", (): void => {
      const result = parse(tokenize("fn mut() {}").tokens);
      expect(result.program).toEqual(none());
      expect(result.diagnostics[0]?.message).toContain("mut");
    });

    it.each(["mod", "box", "macro", "yield"])(
      "rejects %s in let binding position with a generic keyword error",
      (kw) => {
        const result = parse(tokenize(`let ${kw} = 1;`).tokens);
        expect(result.program).toEqual(none());
        expect(result.diagnostics[0]?.message).toContain("keyword");
      },
    );
  });

  describe("raw identifiers in parser positions", (): void => {
    it("accepts r#fn as a function name", (): void => {
      const ast = parseProgram("fn r#fn() {}");
      expect(ast).toMatchObject({
        items: [{ kind: "Function", name: { kind: "Identifier", text: "fn" } }],
      });
    });

    it("accepts r#let as a let binding name", (): void => {
      const ast = parseProgram("let r#let = 1;");
      expect(ast).toMatchObject({
        items: [
          {
            kind: "LetStatement",
            pattern: {
              kind: "BindingPattern",
              name: { kind: "Identifier", text: "let" },
            },
          },
        ],
      });
    });

    it("accepts r#true as a let binding name", (): void => {
      const result = parse(tokenize("let r#true = 1;").tokens);
      assert(isSome(result.program), "expected program to compile");
      const stmt = result.program.value.items[0];
      assert(stmt?.kind === "LetStatement", "expected LetStatement");
      expect(stmt.pattern.name.text).toBe("true");
    });

    it("accepts r#match as a path expression", (): void => {
      const ast = parseProgram("r#match;");
      expect(ast).toMatchObject({
        items: [
          {
            kind: "ExpressionStatement",
            expression: {
              kind: "PathExpression",
              path: { absolute: false, segments: ["match"] },
            },
          },
        ],
      });
    });
  });

  describe("span stability across contexts", (): void => {
    it("identifier tokenId in a let binding points to the name token", (): void => {
      const { tokens } = tokenize("let foo = 1;");
      const { program, diagnostics } = parse(tokens);
      assert(
        isSome(program),
        diagnostics[0]?.message ?? "expected program to compile",
      );
      const stmt = program.value.items[0];
      assert(stmt?.kind === "LetStatement", "expected LetStatement");
      const { tokenId } = stmt.pattern.name;
      expect(tokens[tokenId]).toMatchObject({
        kind: "ident",
        text: "foo",
        span: { start: 4, end: 7 },
      });
    });

    it("identifier tokenId in a function declaration points to the name token", (): void => {
      const { tokens } = tokenize("fn foo() {}");
      const { program, diagnostics } = parse(tokens);
      assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
      const fn_ = program.value.items[0];
      assert(fn_?.kind === "Function", "expected Function");
      const { tokenId } = fn_.name;
      expect(tokens[tokenId]).toMatchObject({
        kind: "ident",
        text: "foo",
        span: { start: 3, end: 6 },
      });
    });

    it("identifier tokenId in an expression points to the name token", (): void => {
      const { tokens } = tokenize("foo;");
      const { program, diagnostics } = parse(tokens);
      assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
      const expr = program.value.items[0];
      assert(
        expr?.kind === "ExpressionStatement",
        "expected ExpressionStatement",
      );
      const path = expr.expression;
      assert(path.kind === "PathExpression", "expected PathExpression");
      expect(tokens[path.tokenId]).toMatchObject({
        kind: "ident",
        text: "foo",
        span: { start: 0, end: 3 },
      });
    });
  });
});

describe("reference expressions", (): void => {
  it("parses a shared reference &value", (): void => {
    const ast = parseProgram("&value;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: false,
            operand: {
              kind: "PathExpression",
              path: { segments: ["value"] },
            },
          },
        },
      ],
    });
  });

  it("parses an exclusive reference &mut counter", (): void => {
    const ast = parseProgram("&mut counter;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: true,
            operand: {
              kind: "PathExpression",
              path: { segments: ["counter"] },
            },
          },
        },
      ],
    });
  });

  it("parses &mut x as a mutable reference", (): void => {
    const ast = parseProgram("&mut x;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: true,
            operand: {
              kind: "PathExpression",
              path: { segments: ["x"] },
            },
          },
        },
      ],
    });
  });
});

describe("let binding modifiers", (): void => {
  it("parses let mut x = 1", (): void => {
    const ast = parseProgram("let mut x = 1;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", mutable: true }],
    });
  });

  it("parses let x = 1 as immutable", (): void => {
    const ast = parseProgram("let x = 1;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", mutable: false }],
    });
  });

  it("parses let x; with no type and no initializer", (): void => {
    const ast = parseProgram("let x;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", type: none(), initializer: none() }],
    });
  });
});

describe("trailing expression in block", (): void => {
  it("parses a trailing expression in a block (no semicolon)", (): void => {
    const ast = parseProgram("fn f() { foo }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            kind: "Block",
            statements: [],
            trailingExpression: some({
              kind: "PathExpression",
              path: { segments: ["foo"] },
            }),
          },
        },
      ],
    });
  });

  it("distinguishes a statement from a trailing expression by the presence of a semicolon", (): void => {
    const ast = parseProgram("fn f() { foo; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            kind: "Block",
            statements: [{ kind: "ExpressionStatement" }],
            trailingExpression: none(),
          },
        },
      ],
    });
  });
});

describe("empty statements in blocks", (): void => {
  it("skips a lone semicolon inside a block silently", (): void => {
    const ast = parseProgram("fn f() { ; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            kind: "Block",
            statements: [],
            trailingExpression: none(),
          },
        },
      ],
    });
  });

  it("skips multiple consecutive semicolons", (): void => {
    const ast = parseProgram("fn f() { ; ; ; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: { statements: [], trailingExpression: none() },
        },
      ],
    });
  });

  it("skips empty statements interspersed with real statements", (): void => {
    const ast = parseProgram("fn f() -> i32 { ; let x = 1; ; x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [{ kind: "LetStatement" }],
            trailingExpression: some({ kind: "PathExpression" }),
          },
        },
      ],
    });
  });

  it("skips a lone semicolon before a trailing expression", (): void => {
    const ast = parseProgram("fn f() -> i32 { ; 42 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [],
            trailingExpression: some({ kind: "IntLiteral" }),
          },
        },
      ],
    });
  });

  it("skips an outer attribute followed by a semicolon", (): void => {
    const ast = parseProgram("fn f() { #[attr] ; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: { statements: [], trailingExpression: none() },
        },
      ],
    });
  });
});

describe("item declarations inside blocks", (): void => {
  it("parses a local fn declaration as a block statement", (): void => {
    const ast = parseProgram("fn f() { fn g() -> i32 { 42 } g() }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          name: { text: "f" },
          body: {
            statements: [{ kind: "Function", name: { text: "g" } }],
            trailingExpression: some({ kind: "CallExpression" }),
          },
        },
      ],
    });
  });

  it("parses a local struct declaration as a block statement", (): void => {
    const ast = parseProgram("fn f() { struct P { x: i32 } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [{ kind: "Struct", name: { text: "P" } }],
            trailingExpression: none(),
          },
        },
      ],
    });
  });

  it("parses a pub fn inside a block", (): void => {
    const ast = parseProgram("fn f() { pub fn g() {} }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "Function",
                name: { text: "g" },
                visibility: some({ scope: none() }),
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a nested block as a trailing expression after a local fn", (): void => {
    const ast = parseProgram(
      "fn f() -> i32 { fn double(x: i32) -> i32 { x + x } double(21) }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [{ kind: "Function", name: { text: "double" } }],
            trailingExpression: some({ kind: "CallExpression" }),
          },
        },
      ],
    });
  });
});

describe("missing brace diagnostics", (): void => {
  it("produces a diagnostic when the closing brace is missing", (): void => {
    const result = parse(tokenize("fn f() { let x = 1;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("}");
  });

  it("produces a diagnostic when the opening brace is missing", (): void => {
    const result = parse(tokenize("fn f() let x = 1; }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("lbrace");
  });
});

describe("visibility on function declarations", (): void => {
  it("parses pub fn f() {}", (): void => {
    const ast = parseProgram("pub fn f() {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          visibility: some({ scope: none() }),
          name: { text: "f" },
        },
      ],
    });
  });

  it("parses pub(package) fn f() {}", (): void => {
    const ast = parseProgram("pub(package) fn f() {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          visibility: some({ scope: some("package") }),
          name: { text: "f" },
        },
      ],
    });
  });

  it("rejects pub() fn f() {} as invalid scoped visibility", (): void => {
    const result = parse(tokenize("pub() fn f() {}").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("call expression edge cases", (): void => {
  it("parses chained calls foo()()", (): void => {
    const ast = parseProgram("foo()();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "CallExpression",
            callee: {
              kind: "CallExpression",
              callee: { kind: "PathExpression" },
            },
            arguments: [],
          },
        },
      ],
    });
  });

  it("parses a call with multiple arguments", (): void => {
    const ast = parseProgram("f(a, b, c);");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "CallExpression",
            arguments: [
              { kind: "PathExpression", path: { segments: ["a"] } },
              { kind: "PathExpression", path: { segments: ["b"] } },
              { kind: "PathExpression", path: { segments: ["c"] } },
            ],
          },
        },
      ],
    });
  });

  it("parses a call with a trailing comma foo(a,)", (): void => {
    const ast = parseProgram("foo(a,);");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "CallExpression",
            arguments: [{ kind: "PathExpression" }],
          },
        },
      ],
    });
  });
});

describe("parse errors — missing tokens", (): void => {
  it("errors on a let statement with no semicolon", (): void => {
    const result = parse(tokenize("let x = 1").tokens);
    expect(result.program).toEqual(none());
  });

  it("errors on a let statement with a non-identifier pattern", (): void => {
    const result = parse(tokenize("let 42 = 1;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("identifier");
  });

  it("errors on a function declaration with no body brace", (): void => {
    const result = parse(tokenize("fn f();").tokens);
    expect(result.program).toEqual(none());
  });

  it("errors on an unclosed argument list", (): void => {
    const result = parse(tokenize("foo(a").tokens);
    expect(result.program).toEqual(none());
  });

  it("errors on fn at EOF", (): void => {
    const result = parse(tokenize("fn").tokens);
    expect(result.program).toEqual(none());
  });

  it.todo(
    "let x = y = 5 and let x = (y = 5) produce type errors — assignment returns () and cannot initialize a non-unit binding",
  );
});

describe("empty and minimal programs", (): void => {
  it("parses an empty program", (): void => {
    const ast = parseProgram("");
    expect(ast).toMatchObject({ kind: "Program", items: [] });
  });

  it("parses a program-level inner attribute", (): void => {
    const ast = parseProgram("#![crate_name]");
    expect(ast).toMatchObject({
      kind: "Program",
      attributes: [{ name: { text: "crate_name" } }],
      items: [],
    });
  });
});

describe("multiple attributes", (): void => {
  it("attaches multiple consecutive outer attributes to a function", (): void => {
    const ast = parseProgram("#[a] #[b] fn f() {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [{ name: { text: "a" } }, { name: { text: "b" } }],
        },
      ],
    });
  });
});

describe("unsupported type syntax in additional positions", (): void => {
  it("rejects a pointer type *i32 in type position", (): void => {
    const result = parse(tokenize("let x: *i32;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("star");
  });

  it("rejects a lifetime 'a in type position", (): void => {
    const { tokens } = tokenize("let x: 'a;");
    const lifetime = tokens.find((t) => t.kind === "lifetime");
    assert(lifetime !== undefined, "Expected to find a lifetime token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("lifetime");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(lifetime.span));
  });

  it("rejects a named lifetime 'static in type position", (): void => {
    const result = parse(tokenize("let x: 'static;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("lifetime");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
  });

  it("rejects an anonymous lifetime '_ in type position", (): void => {
    const result = parse(tokenize("let x: '_;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("lifetime");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
  });

  it("does not misparse a char literal as a lifetime in type position (regression)", (): void => {
    const result = parse(tokenize("let x: 'a';").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).not.toContain("lifetime");
  });

  it("rejects a reference return type fn f() -> &i32 {}", (): void => {
    const result = parse(tokenize("fn f() -> &i32 {}").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("reference");
  });
});

describe("literal expressions", (): void => {
  describe("float literals", (): void => {
    it("parses 1.0 as FloatLiteral with no suffix", (): void => {
      const ast = parseProgram("1.0");
      expect(ast).toMatchObject({
        items: [{ kind: "FloatLiteral", value: "1.0", suffix: none() }],
      });
    });

    it("parses 1.5f32 as FloatLiteral with f32 suffix", (): void => {
      const ast = parseProgram("1.5f32");
      expect(ast).toMatchObject({
        items: [{ kind: "FloatLiteral", value: "1.5", suffix: some("f32") }],
      });
    });

    it("parses 1e10 as FloatLiteral with no suffix", (): void => {
      const ast = parseProgram("1e10");
      expect(ast).toMatchObject({
        items: [{ kind: "FloatLiteral", value: "1e10", suffix: none() }],
      });
    });

    it("parses 42f64 (bare integer with float suffix) as FloatLiteral", (): void => {
      const ast = parseProgram("42f64");
      expect(ast).toMatchObject({
        items: [{ kind: "FloatLiteral", value: "42", suffix: some("f64") }],
      });
    });
  });

  describe("bool literals", (): void => {
    it("parses true as BoolLiteral with value true", (): void => {
      const ast = parseProgram("true");
      expect(ast).toMatchObject({
        items: [{ kind: "BoolLiteral", value: true }],
      });
    });

    it("parses false as BoolLiteral with value false", (): void => {
      const ast = parseProgram("false");
      expect(ast).toMatchObject({
        items: [{ kind: "BoolLiteral", value: false }],
      });
    });

    it("bool literal in let binding initializer", (): void => {
      const ast = parseProgram("let flag = true;");
      expect(ast).toMatchObject({
        items: [
          {
            kind: "LetStatement",
            initializer: some({ kind: "BoolLiteral", value: true }),
          },
        ],
      });
    });
  });

  describe("char literals", (): void => {
    it("parses 'a' as CharLiteral with value a", (): void => {
      const ast = parseProgram("'a'");
      expect(ast).toMatchObject({
        items: [{ kind: "CharLiteral", value: "a" }],
      });
    });

    it("resolves \\n escape to newline character", (): void => {
      const ast = parseProgram("'\\n'");
      expect(ast).toMatchObject({
        items: [{ kind: "CharLiteral", value: "\n" }],
      });
    });

    it("resolves \\t escape to tab character", (): void => {
      const ast = parseProgram("'\\t'");
      expect(ast).toMatchObject({
        items: [{ kind: "CharLiteral", value: "\t" }],
      });
    });

    it("resolves \\\\ escape to single backslash", (): void => {
      const ast = parseProgram("'\\\\'");
      expect(ast).toMatchObject({
        items: [{ kind: "CharLiteral", value: "\\" }],
      });
    });

    it("resolves \\x41 hex escape to 'A'", (): void => {
      const ast = parseProgram("'\\x41'");
      expect(ast).toMatchObject({
        items: [{ kind: "CharLiteral", value: "A" }],
      });
    });

    it("resolves \\u{41} unicode escape to 'A'", (): void => {
      const ast = parseProgram("'\\u{41}'");
      expect(ast).toMatchObject({
        items: [{ kind: "CharLiteral", value: "A" }],
      });
    });
  });

  describe("int literals with base and suffix", (): void => {
    it("decimal with u8 suffix", (): void => {
      const ast = parseProgram("42u8");
      expect(ast).toMatchObject({
        items: [
          { kind: "IntLiteral", value: "42", base: 10, suffix: some("u8") },
        ],
      });
    });

    it("decimal with no suffix", (): void => {
      const ast = parseProgram("42");
      expect(ast).toMatchObject({
        items: [{ kind: "IntLiteral", value: "42", base: 10, suffix: none() }],
      });
    });

    it("hex literal stores digits without prefix", (): void => {
      const ast = parseProgram("0xFF");
      expect(ast).toMatchObject({
        items: [{ kind: "IntLiteral", value: "FF", base: 16, suffix: none() }],
      });
    });

    it("octal literal stores digits without prefix", (): void => {
      const ast = parseProgram("0o77");
      expect(ast).toMatchObject({
        items: [{ kind: "IntLiteral", value: "77", base: 8, suffix: none() }],
      });
    });

    it("binary literal stores digits without prefix", (): void => {
      const ast = parseProgram("0b1010");
      expect(ast).toMatchObject({
        items: [{ kind: "IntLiteral", value: "1010", base: 2, suffix: none() }],
      });
    });

    it("hex with suffix", (): void => {
      const ast = parseProgram("0xFFu8");
      expect(ast).toMatchObject({
        items: [
          { kind: "IntLiteral", value: "FF", base: 16, suffix: some("u8") },
        ],
      });
    });
  });
});

describe("keyword edge cases", (): void => {
  it.each(["write", "bind", "package", "unchecked"])(
    "contextual keyword %s is valid as a function name",
    (kw) => {
      const ast = parseProgram(`fn ${kw}() {}`);
      expect(ast).toMatchObject({
        items: [{ kind: "Function", name: { kind: "Identifier", text: kw } }],
      });
    },
  );

  it.each(["write", "bind", "package", "unchecked"])(
    "contextual keyword %s is a valid identifier in expression position",
    (kw) => {
      const result = parse(tokenize(`let x = ${kw};`).tokens);
      expect(result.program).toEqual(some(parseProgram(`let x = ${kw};`)));
    },
  );

  it("accepts r#mut as a function name", (): void => {
    const ast = parseProgram("fn r#mut() {}");
    expect(ast).toMatchObject({
      items: [{ kind: "Function", name: { kind: "Identifier", text: "mut" } }],
    });
  });

  it("foo::fn gives a diagnostic naming fn", (): void => {
    const result = parse(tokenize("foo::fn;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("fn");
  });
});

describe("deref expression guardrail", (): void => {
  it("*x produces a Slice-1 diagnostic, not a generic 'expected expression' error", (): void => {
    const result = parse(tokenize("*x;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
    expect(result.diagnostics[0]?.message).toContain("dereference");
  });

  it("*1 in expression position produces the deref Slice-1 diagnostic", (): void => {
    const result = parse(tokenize("*1;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("let y = *x; produces the deref Slice-1 diagnostic", (): void => {
    const result = parse(tokenize("let y = *x;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
    expect(result.diagnostics[0]?.message).toContain("dereference");
  });

  it("fn f() { *x } produces the deref Slice-1 diagnostic", (): void => {
    const result = parse(tokenize("fn f() { *x }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("Slice 1");
  });

  it("deref diagnostic span covers the * token", (): void => {
    const result = parse(tokenize("*value;").tokens);
    expect(result.diagnostics[0]?.span).toEqual(some({ start: 0, end: 1 }));
  });
});

describe("function parameters", (): void => {
  it("zero parameters produce an empty params list", (): void => {
    const ast = parseProgram("fn f() {}");
    expect(ast).toMatchObject({
      items: [{ kind: "Function", params: [] }],
    });
  });

  it("parses a single typed parameter", (): void => {
    const ast = parseProgram("fn add(x: i32) -> i32 { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          name: { text: "add" },
          params: [
            {
              kind: "Param",
              pattern: {
                kind: "BindingPattern",
                name: { kind: "Identifier", text: "x" },
              },
              type: {
                kind: "NamedType",
                path: { absolute: false, segments: ["i32"] },
              },
            },
          ],
          returnType: some({ kind: "NamedType", path: { segments: ["i32"] } }),
        },
      ],
    });
  });

  it("parses two typed parameters", (): void => {
    const ast = parseProgram("fn add(x: i32, y: i32) -> i32 { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          params: [
            {
              kind: "Param",
              pattern: { name: { text: "x" } },
            },
            {
              kind: "Param",
              pattern: { name: { text: "y" } },
            },
          ],
        },
      ],
    });
  });

  it("accepts a trailing comma in the parameter list", (): void => {
    const ast = parseProgram("fn f(x: i32,) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          params: [{ kind: "Param", pattern: { name: { text: "x" } } }],
        },
      ],
    });
  });

  it("parses a parameter with a qualified type", (): void => {
    const ast = parseProgram("fn f(v: std::Vec) {}");
    expect(ast).toMatchObject({
      items: [
        {
          params: [
            {
              kind: "Param",
              type: {
                kind: "NamedType",
                path: { segments: ["std", "Vec"] },
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a parameter with the unit type", (): void => {
    const ast = parseProgram("fn f(x: ()) {}");
    expect(ast).toMatchObject({
      items: [
        {
          params: [{ kind: "Param", type: { kind: "UnitType" } }],
        },
      ],
    });
  });
});

describe("unsupported item keywords", (): void => {
  it.each(["enum", "export", "extern", "impl", "trait"])(
    "rejects `%s` with a Slice 1 diagnostic",
    (keyword): void => {
      const { tokens } = tokenize(`${keyword} Foo {}`);
      const { diagnostics } = parse(tokens);
      expect(diagnostics[0]?.severity).toBe("error");
      expect(diagnostics[0]?.message).toContain("Slice 1");
      expect(diagnostics[0]?.message).toContain(keyword);
    },
  );

  it("rejects impl<'a> Foo<'a> { ... } the same as a plain impl (lifetime generics don't change anything)", (): void => {
    const { tokens } = tokenize("impl<'a> Foo<'a> { fn m(&'a self) {} }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("impl");
  });
});

describe("item error recovery", (): void => {
  it("reports an error for a parameter missing its type annotation", (): void => {
    const { tokens } = tokenize("fn f(x) {}");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain(":");
  });

  it("reports an error for a parameter missing its name", (): void => {
    const { tokens } = tokenize("fn f(: i32) {}");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("reports an error for a struct missing its name", (): void => {
    const { tokens } = tokenize("struct { x: i32 }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("reports an error for a struct field missing its colon", (): void => {
    const { tokens } = tokenize("struct Foo { x i32 }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain(":");
  });

  it("reports an error for a struct field missing its type", (): void => {
    const { tokens } = tokenize("struct Foo { x: }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("reports an error for a struct field missing its colon and type", (): void => {
    const { tokens } = tokenize("struct Foo { x }");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain(":");
  });

  it("reports an error for a tuple field missing its type", (): void => {
    const { tokens } = tokenize("struct Foo(:);");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.severity).toBe("error");
  });
});

describe("generics guardrail — declaration-name position", (): void => {
  it("fn foo<T>() {} recovers with a Slice-1 diagnostic and empty generics", (): void => {
    const { tokens } = tokenize("fn foo<T>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[0]?.message).toContain("generic");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "foo" }, generics: [], params: [] },
    ]);
  });

  it("fn foo<T, U>(x: T) {} recovers and still parses the parameter list", (): void => {
    const { tokens } = tokenize("fn foo<T, U>(x: T) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        generics: [],
        params: [
          {
            kind: "Param",
            pattern: { name: { text: "x" } },
            type: { kind: "NamedType", path: { segments: ["T"] } },
          },
        ],
      },
    ]);
  });

  it("fn foo<T: Bound>() {} recovers past an inline trait bound", (): void => {
    const { tokens } = tokenize("fn foo<T: Bound>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [], params: [] },
    ]);
  });

  it("fn foo<T: Foo<Bar>>() {} recovers past a nested generic bound (>> token)", (): void => {
    const { tokens } = tokenize("fn foo<T: Foo<Bar>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [], params: [] },
    ]);
  });

  it("fn foo<'a>() {} recovers past a lifetime-looking generic with a lifetime-specific diagnostic", (): void => {
    const { tokens } = tokenize("fn foo<'a>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [] },
    ]);
  });

  it("fn foo<'a, T>(x: T) {} recovers and still parses the parameter list", (): void => {
    const { tokens } = tokenize("fn foo<'a, T>(x: T) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        generics: [],
        params: [
          {
            kind: "Param",
            pattern: { name: { text: "x" } },
            type: { kind: "NamedType", path: { segments: ["T"] } },
          },
        ],
      },
    ]);
  });

  it("fn foo<T, 'a>() {} falls back to the generic Slice-4 diagnostic (lifetime not listed first)", (): void => {
    const { tokens } = tokenize("fn foo<T, 'a>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 4");
    expect(diagnostics[0].message).not.toContain("lifetime");
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [] },
    ]);
  });

  it("struct Cursor<'a> { source: T } recovers with a lifetime-specific diagnostic", (): void => {
    const { tokens } = tokenize("struct Cursor<'a> { source: T }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Cursor" },
        body: {
          kind: "NamedFields",
          fields: [
            {
              kind: "StructField",
              name: { text: "source" },
              type: { kind: "NamedType", path: { segments: ["T"] } },
            },
          ],
        },
      },
    ]);
  });

  it("recovers so a sibling function after a rejected lifetime generic still parses", (): void => {
    const { tokens } = tokenize("fn foo<'a>() {} fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "foo" } },
      { kind: "Function", name: { text: "bar" } },
    ]);
  });

  it("struct Pair<A, B> { ... } recovers and still parses named fields", (): void => {
    const { tokens } = tokenize("struct Pair<A, B> { a: A, b: B }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        body: {
          kind: "NamedFields",
          fields: [
            { kind: "StructField", name: { text: "a" } },
            { kind: "StructField", name: { text: "b" } },
          ],
        },
      },
    ]);
  });

  it("struct Pair<A, B>(A, B); recovers as a tuple struct", (): void => {
    const { tokens } = tokenize("struct Pair<A, B>(A, B);");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Pair" }, body: { kind: "TupleFields" } },
    ]);
  });

  it("struct Pair<A, B>; recovers as a unit struct", (): void => {
    const { tokens } = tokenize("struct Pair<A, B>;");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Pair" }, body: { kind: "Unit" } },
    ]);
  });

  it("recovers so a sibling function after a rejected generic fn still parses", (): void => {
    const { tokens } = tokenize("fn broken<T>() {} fn ok() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "broken" } },
      { kind: "Function", name: { text: "ok" } },
    ]);
  });

  it("recovers so a sibling struct after a rejected generic struct still parses", (): void => {
    const { tokens } = tokenize(
      "struct Broken<T> { x: T } struct Ok { y: i32 }",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Broken" } },
      { kind: "Struct", name: { text: "Ok" } },
    ]);
  });

  it("declaration-name generics diagnostic span covers exactly the < token", (): void => {
    const { tokens } = tokenize("fn foo<T>() {}");
    const lt = tokens.find((t) => t.kind === "lt");
    assert(lt !== undefined, "Expected to find a lt token");
    const { diagnostics } = parse(tokens);
    expect(diagnostics[0]?.span).toEqual(some(lt.span));
  });

  it("fn foo<T() {} bails out at the ( and still recovers without crashing", (): void => {
    const { tokens } = tokenize("fn foo<T() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
  });

  it("fn foo<T (unterminated to EOF) fails fast without hanging", (): void => {
    const { tokens } = tokenize("fn foo<T");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic to come back");
  });

  // biome-ignore lint/security/noSecrets: false positive — generic syntax test string, not a secret
  it("fn foo<T: Foo<Bar<Baz>>>() {} recovers past triple-nested generics", (): void => {
    // biome-ignore lint/security/noSecrets: false positive — generic syntax test string, not a secret
    const { tokens } = tokenize("fn foo<T: Foo<Bar<Baz>>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [], params: [] },
    ]);
  });

  it("documents imprecise-but-safe recovery when a stray extra > merges into a >> token", (): void => {
    // "T>>" lexes the trailing two characters as a single `gt_gt` token
    // (maximal munch), even though only one `>` was semantically needed to
    // close `<T`. `skipBalancedAngleList` can't split a token in half, so it
    // consumes the whole `gt_gt` once depth reaches 0 — silently absorbing
    // the stray `>` rather than reporting it separately. This mirrors the
    // loop-recovery precedent (only the outermost construct gets a
    // diagnostic); it's still safe because the next real token (`(`) is
    // exactly where recovery lands, so nothing desyncs.
    const { tokens } = tokenize("fn foo<T>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [], params: [] },
    ]);
  });

  it("fn foo<>() {} recovers past an empty generic parameter list", (): void => {
    const { tokens } = tokenize("fn foo<>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      { kind: "Function", generics: [], params: [] },
    ]);
  });
});

describe("lifetime + reference type interactions", (): void => {
  // Contrast with "fn foo<'a>() {} recovers..." above (unused lifetime
  // param): the declaration-generics step still recovers and pushes its
  // own diagnostic here, but parsing `&'a i32` as the parameter type then
  // hits the pre-existing, unchanged `&` guardrail in type.ts, which is
  // fail-fast — so the whole file's `program` still ends up `none()`. This
  // is expected, not accidental: the identical composition already happens
  // for `fn foo<T>(x: &T) {}` with no lifetime involved at all, and
  // recovery is documented as the exception, not the template.
  it("fn foo<'a>(x: &'a i32) {} — recovered generics diagnostic followed by fail-fast reference-type diagnostic", (): void => {
    const { tokens } = tokenize("fn foo<'a>(x: &'a i32) {}");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    expect(diagnostics).toHaveLength(2);
    assert(diagnostics[0] !== undefined, "Expected a first diagnostic");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].message).toContain("Slice 2");
    assert(diagnostics[1] !== undefined, "Expected a second diagnostic");
    expect(diagnostics[1].message).toContain("reference");
    expect(diagnostics[1].message).toContain("Slice 2");
  });

  it("struct Ref<'a>(&'a i32); — same interaction via a tuple-struct field", (): void => {
    const { tokens } = tokenize("struct Ref<'a>(&'a i32);");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    expect(diagnostics).toHaveLength(2);
    assert(diagnostics[0] !== undefined, "Expected a first diagnostic");
    expect(diagnostics[0].message).toContain("lifetime");
    assert(diagnostics[1] !== undefined, "Expected a second diagnostic");
    expect(diagnostics[1].message).toContain("reference");
  });
});

describe("lifetime guardrail — nested and reversed-order generics", (): void => {
  it("let x: Vec<Vec<'a>>; diagnoses only the outer generic (inner lifetime never reached)", (): void => {
    const { tokens } = tokenize("let x: Vec<Vec<'a>>;");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("Slice 4");
    expect(diagnostics[0].message).not.toContain("lifetime");
  });

  it("let x: Vec<T, 'a>; falls back to the generic Slice-4 diagnostic (lifetime not listed first)", (): void => {
    const { tokens } = tokenize("let x: Vec<T, 'a>;");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("Slice 4");
    expect(diagnostics[0].message).not.toContain("lifetime");
  });
});

describe("generics guardrail — where clause", (): void => {
  it("fn f() where T: Draw {} recovers with a Slice-1 diagnostic", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[0]?.message).toContain("where");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" }, body: { statements: [] } },
    ]);
  });

  it("fn f<T>() where T: Draw {} emits two diagnostics and still recovers", (): void => {
    const { tokens } = tokenize("fn f<T>() where T: Draw {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[1]?.message).toContain("Slice 1");
  });

  it("fn f() where T: Draw, U: Clone {} recovers past multiple bounds", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw, U: Clone {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toMatch("Slice 1");
    expect(diagnostics[0].message).toMatch("where");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" }, body: { statements: [] } },
    ]);
  });

  it("fn f() where T: Foo<Bar> {} recovers even when a bound itself contains <>", (): void => {
    const { tokens } = tokenize("fn f() where T: Foo<Bar> {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("where");
  });

  it("fn f() where 'a: 'b {} recovers past a lifetime bound (skipToFunctionBody isn't confused by lifetime tokens)", (): void => {
    const { tokens } = tokenize("fn f() where 'a: 'b {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("where");
  });

  it("fn f() where T: Draw (missing body) fails fast without hanging", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic to come back");
  });

  it("recovers so a sibling function after a rejected where clause still parses", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw {} fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("does not steal a sibling function's body when the where clause has no body", (): void => {
    // Regression: without a stop condition on the item's own boundary, the
    // where-clause skip used to scan straight past `fn g()` looking for the
    // first `{` and land on g's body, silently discarding `g` and giving `f`
    // an empty body that was never really there. Missing a body is malformed
    // input either way, so failing fast (not hanging, not corrupting the
    // AST into a single bogus item) is the correct outcome.
    const { tokens } = tokenize("fn f() where T: Draw fn g() {}");
    const { program } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
  });
});

describe("generics guardrail — where clause on struct", (): void => {
  it("struct Pair<T> where T: Bound { x: T } recovers with a Slice-1 diagnostic", (): void => {
    const { tokens } = tokenize("struct Pair<T> where T: Bound { x: T }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[1]?.message).toContain("where");
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        body: {
          kind: "NamedFields",
          fields: [{ kind: "StructField", name: { text: "x" } }],
        },
      },
    ]);
  });

  it("struct Pair<T> where T: Bound; recovers as a unit struct", (): void => {
    // The `;` here is the CORRECT unit-struct terminator, not a malformed-
    // input signal — the struct-specific skip helper must treat `;` as
    // "found the body," unlike the fn-specific one (fn bodies are never `;`).
    const { tokens } = tokenize("struct Pair<T> where T: Bound;");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[1]?.message).toContain("where");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Pair" }, body: { kind: "Unit" } },
    ]);
  });

  it("struct Pair<T> where T: Bound(T); recovers as a tuple struct", (): void => {
    const { tokens } = tokenize("struct Pair<T> where T: Bound(T);");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[1]?.message).toContain("where");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Pair" }, body: { kind: "TupleFields" } },
    ]);
  });

  it("recovers so a sibling struct after a rejected where clause still parses", (): void => {
    const { tokens } = tokenize(
      "struct Pair<T> where T: Bound { x: T } struct Ok { y: i32 }",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(2);
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Pair" } },
      { kind: "Struct", name: { text: "Ok" } },
    ]);
  });

  it("does not steal a sibling struct's body when the where clause has no body", (): void => {
    const { tokens } = tokenize(
      "struct Pair<T> where T: Bound struct Ok { y: i32 }",
    );
    const { program } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
  });
});

describe("no-op let warnings", (): void => {
  it("let x; with no initializer emits a warning diagnostic", (): void => {
    const { program, diagnostics } = parse(tokenize("let x;").tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning" }),
    );
  });

  it("let mut x; with no initializer does not warn", (): void => {
    const { diagnostics } = parse(tokenize("let mut x;").tokens);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings).toHaveLength(0);
  });

  it("let x = 1; with an initializer does not warn", (): void => {
    const { diagnostics } = parse(tokenize("let x = 1;").tokens);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings).toHaveLength(0);
  });

  it("warning span covers the let token", (): void => {
    const { tokens } = tokenize("let x;");
    const { diagnostics } = parse(tokens);
    const warning = diagnostics.find((d) => d.severity === "warning");
    const firstToken = tokens[0];
    assert(firstToken !== undefined, "Expected to get token");
    expect(warning).toMatchObject({
      span: some(firstToken.span),
    });
  });
});

describe("statement-level loop/while/for/label rejection with recovery", (): void => {
  it.each([
    ["loop", "loop {}"],
    ["while", "while true {}"],
    ["for", "for x in v {}"],
  ])(
    "rejects bare `%s` statement and recovers so later items still parse",
    (keyword, construct): void => {
      const { tokens } = tokenize(`fn f() { ${construct} } fn g() {}`);
      const { program, diagnostics } = parse(tokens);
      assert(isSome(program), "Expected a program to come back");
      expect(diagnostics[0]?.severity).toBe("error");
      expect(diagnostics[0]?.message).toContain("Slice 1");
      expect(diagnostics[0]?.message).toContain(keyword);
      expect(program.value.items).toMatchObject([
        { kind: "Function", name: { text: "f" }, body: { statements: [] } },
        { kind: "Function", name: { text: "g" } },
      ]);
    },
  );

  it.each([
    ["loop", "'outer: loop {}"],
    ["while", "'outer: while true {}"],
    ["for", "'outer: for x in v {}"],
  ])(
    "rejects label-prefixed `%s` and recovers so later items still parse",
    (keyword, construct): void => {
      const { tokens } = tokenize(`fn f() { ${construct} } fn g() {}`);
      const { program, diagnostics } = parse(tokens);
      expect(isSome(program)).toBe(true);
      expect(diagnostics).toHaveLength(1);
      assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("Slice 1");
      expect(diagnostics[0].message).toContain(keyword);
      assert(isSome(program), "Expected a program to come back");
      expect(program.value.items).toMatchObject([
        { kind: "Function", name: { text: "f" }, body: { statements: [] } },
        { kind: "Function", name: { text: "g" } },
      ]);
    },
  );

  it("emits one diagnostic per rejected construct when several appear in one function", (): void => {
    const { tokens } = tokenize(
      "fn f() { loop {} while true {} for x in v {} }",
    );
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toHaveLength(3);
    assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[0].message).toContain("loop");
    assert(diagnostics[1] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[1].message).toContain("while");
    assert(diagnostics[2] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[2].message).toContain("for");
  });

  it("recovers across back-to-back rejected loops with no separator", (): void => {
    const { tokens } = tokenize("fn f() { loop {} loop {} }");
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toHaveLength(2);
  });

  it("emits exactly one diagnostic for a loop nested inside a rejected loop", (): void => {
    const { tokens } = tokenize("fn f() { loop { while true {} } }");
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[0].message).toContain("loop");
  });

  it("skips braces inside a string literal in the rejected loop's body", (): void => {
    const { tokens } = tokenize(
      'fn f() { loop { let s = "{ not a brace }"; } } fn g() {}',
    );
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[0].message).toContain("loop");
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("balances real nested braces inside the rejected loop's body", (): void => {
    const { tokens } = tokenize("fn f() { loop { if true { } } } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toHaveLength(1);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("fails gracefully instead of hanging on an unterminated loop body", (): void => {
    const { tokens } = tokenize("fn f() { loop {");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic to come back");
    expect(diagnostics[0].message).toContain("end of input");
  });

  it("consumes a redundant trailing semicolon after a rejected loop", (): void => {
    const { tokens } = tokenize("fn f() { loop {}; } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("rejects `while let` the same as a plain `while` condition", (): void => {
    const { tokens } = tokenize(
      "fn f() { while let Some(x) = opt {} } fn g() {}",
    );
    const { program, diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[0].message).toContain("while");
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("rejects a loop in trailing (no-semicolon) block position the same as mid-block", (): void => {
    const { tokens } = tokenize("fn f() { loop {} }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        body: { statements: [], trailingExpression: none() },
      },
    ]);
  });

  it("diagnostic span covers exactly the loop keyword token", (): void => {
    const { tokens } = tokenize("fn f() { loop {} }");
    const { diagnostics } = parse(tokens);
    const loopToken = tokens.find(
      (t) => t.kind === "keyword" && t.text === "loop",
    );
    assert(loopToken !== undefined, "expected to find the loop token");
    expect(diagnostics[0]?.span).toEqual(some(loopToken.span));
  });

  it("a bare top-level `loop {}` (outside any function) also gets the Slice 1 diagnostic, fail-fast", (): void => {
    const { tokens } = tokenize("loop {}");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("loop");
  });

  it("documents imprecise recovery when a while condition contains a bare brace (already-invalid syntax)", (): void => {
    // `Foo { x: 1 }` bare in condition position isn't valid Hedge grammar
    // (same `allowStruct: false` restriction `if`/`while` already enforce
    // elsewhere), so the recovery skip has no real condition grammar to
    // respect here. It lands on the condition's own `{`, not the loop's
    // intended body — but the construct is still rejected and the parser
    // still recovers rather than hanging or crashing.
    const { tokens } = tokenize("fn f() { while Foo { x: 1 } { } }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("while");
  });

  it("recovers even when a malformed condition has a stray closing bracket", (): void => {
    // A stray `]` with no matching `[` must not drive condDepth negative —
    // otherwise the scan can never recognize the real loop body's `{` as
    // being at top-level depth, and misreports "end of input" instead of
    // recovering.
    const { tokens } = tokenize("fn f() { while x] {} } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("while");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });
});

describe("lifetime vs label disambiguation regression", (): void => {
  it("'a: loop {} produces only the loop diagnostic, not a lifetime diagnostic", (): void => {
    const { tokens } = tokenize("fn f() { 'a: loop { break; } }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("loop");
    expect(diagnostics[0].message).toContain("Slice 6");
    expect(diagnostics[0].message).not.toContain("lifetime");
  });
});

describe("loop/while/for guardrail in nested expression position", (): void => {
  it.each(["loop {}", "while true {}", "for x in v {}"])(
    "`let y = %s;` produces the Slice-1 diagnostic, not a generic 'expected expression' error",
    (construct): void => {
      const { tokens } = tokenize(`let y = ${construct};`);
      const { program, diagnostics } = parse(tokens);
      assert(isNone(program), "Expected program to be nonexistent");
      assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
      expect(diagnostics[0].message).toContain("Slice 1");
    },
  );

  it.each(["loop {}", "while true {}", "for x in v {}"])(
    "`foo(%s);` in call-argument position produces the Slice-1 diagnostic",
    (construct): void => {
      const { tokens } = tokenize(`foo(${construct});`);
      const { program, diagnostics } = parse(tokens);
      assert(isNone(program), "Expected no program to come back");
      assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
      expect(diagnostics[0].message).toContain("Slice 1");
    },
  );

  it.each(["loop {}", "while true {}", "for x in v {}"])(
    "`if %s { }` in if-condition position produces the Slice-1 diagnostic",
    (construct): void => {
      const { tokens } = tokenize(`if ${construct} { }`);
      const { program, diagnostics } = parse(tokens);
      assert(isNone(program), "Expected program to be nonexistent");
      assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
      expect(diagnostics[0].message).toContain("Slice 1");
    },
  );

  it.each(["loop {}", "while true {}", "for x in v {}"])(
    "`1 + %s;` in binary-operand position produces the Slice-1 diagnostic",
    (construct): void => {
      const { tokens } = tokenize(`1 + ${construct};`);
      const { program, diagnostics } = parse(tokens);
      assert(isNone(program), "Expected program to be nonexistent");
      assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
      expect(diagnostics[0].message).toContain("Slice 1");
    },
  );

  it("nested-position diagnostic span covers exactly the loop keyword token", (): void => {
    const { tokens } = tokenize("let y = loop {};");
    const { diagnostics } = parse(tokens);
    const loopToken = tokens.find(
      (t) => t.kind === "keyword" && t.text === "loop",
    );
    assert(loopToken !== undefined, "expected to find the loop token");
    assert(diagnostics[0] !== undefined, "Expected to get diagnostic");
    expect(diagnostics[0].span).toEqual(some(loopToken.span));
  });
});
