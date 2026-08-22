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
          pattern: {
            kind: "BindingPattern",
            mutable: false,
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
          signature: {
            name: {
              kind: "Identifier",
              text: "main",
            },
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
          signature: {
            name: {
              kind: "Identifier",
              text: "main",
            },
            generics: [],
            params: [],
            returnType: none(),
            whereClause: none(),
          },
          body: {
            kind: "Block",
            statements: [
              {
                kind: "LetStatement",
                pattern: {
                  kind: "BindingPattern",
                  mutable: false,
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

describe("bodiless function signatures", (): void => {
  it("parses a semicolon-terminated function signature with no body", (): void => {
    const ast = parseProgram("fn f(&self) -> i32;");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "FunctionSignature",
          name: {
            kind: "Identifier",
            text: "f",
          },
        },
      ],
    });
  });

  it("still parses a function with a block body exactly as before", (): void => {
    const ast = parseProgram("fn f(&self) -> i32 { 1 }");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Function",
          signature: {
            name: {
              kind: "Identifier",
              text: "f",
            },
          },
          body: {
            kind: "Block",
            statements: [],
            trailingExpression: some({
              kind: "IntLiteral",
            }),
          },
        },
      ],
    });
  });

  it("parses a bodiless function with no params and no return type", (): void => {
    const ast = parseProgram("fn f();");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "FunctionSignature",
          name: { kind: "Identifier", text: "f" },
          params: [],
          returnType: none(),
        },
      ],
    });
  });

  it("parses a bodiless function with a generic parameter", (): void => {
    const ast = parseProgram("fn f<T>(x: T) -> T;");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "FunctionSignature",
          name: { kind: "Identifier", text: "f" },
          generics: [{ kind: "TypeParam", name: { text: "T" } }],
        },
      ],
    });
  });

  it("parses a bodiless function with a where clause", (): void => {
    const ast = parseProgram("fn f<T>(x: T) -> T where T: Copy;");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "FunctionSignature",
          name: { kind: "Identifier", text: "f" },
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { kind: "NamedType", path: { segments: ["T"] } },
                bounds: [{ path: { segments: ["Copy"] } }],
              },
            ],
          }),
        },
      ],
    });
  });

  it("still fails fast without hanging when a function is truncated at EOF with neither a body brace nor a semicolon", (): void => {
    const { tokens } = tokenize("fn f()");
    const { program, diagnostics } = parse(tokens);
    expect(isNone(program)).toBe(true);
    expect(diagnostics).toHaveLength(1);
  });

  it("treats a stray extra semicolon after a bodiless function as an empty top-level statement, not a cascade", (): void => {
    const { tokens } = tokenize("fn f() -> i32;;");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "FunctionSignature",
        name: { text: "f" },
      },
    ]);
  });

  it("parses a bodied sibling function cleanly right after a bodiless one, with no cascading diagnostic", (): void => {
    const { tokens } = tokenize("fn f() -> i32; fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "FunctionSignature",
        name: { text: "f" },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
        body: {},
      },
    ]);
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

  it("produces a Slice 7 diagnostic for bare `self` in struct-construction position", (): void => {
    assertSlice7Error("self::Foo {}", "self");
  });

  it("produces a Slice 7 diagnostic for bare `super` in type position", (): void => {
    assertSlice7Error("let x: super;", "super");
  });

  it("produces a Slice 7 diagnostic for `self` as the second segment of a `Self`-headed type path", (): void => {
    assertSlice7Error("let x: Self::self;", "self");
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

  it.each(["i32", "bool", "str", "f64"])(
    "parses `%s` as a primitive named type annotation on a let binding",
    (primitive): void => {
      const ast = parseProgram(`let x: ${primitive};`);
      expect(ast).toMatchObject({
        items: [
          {
            kind: "LetStatement",
            type: some({
              kind: "NamedType",
              path: { absolute: false, segments: [primitive] },
            }),
          },
        ],
      });
    },
  );

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
          signature: {
            returnType: some({
              kind: "NamedType",
              path: { absolute: false, segments: ["i32"] },
            }),
          },
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
          signature: {
            returnType: some({ kind: "UnitType" }),
          },
        },
      ],
    });
  });

  it("records no return type when the arrow is absent", (): void => {
    const ast = parseProgram("fn f() {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            returnType: none(),
          },
        },
      ],
    });
  });

  it("returns an error for an unsupported type syntax", (): void => {
    const result = parse(tokenize("let x: [i32];").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("[T]");
  });
});

describe("type annotation error diagnostics", (): void => {
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

  it("parses a lifetime-annotated reference param fn f(x: &'a i32) {}", (): void => {
    const { program, diagnostics } = parse(
      tokenize("fn f(x: &'a i32) {}").tokens,
    );
    expect(diagnostics).toHaveLength(0);
    expect(program).toMatchObject(
      some({
        items: [
          {
            kind: "Function",
            signature: {
              params: [
                {
                  type: {
                    kind: "ReferenceType",
                    mutable: false,
                    lifetime: some({ kind: "Lifetime", name: "a" }),
                    referent: {
                      kind: "NamedType",
                      path: { segments: ["i32"] },
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });

  it("parses a lifetime-annotated reference return type fn f() -> &'a i32 {}", (): void => {
    const { program, diagnostics } = parse(
      tokenize("fn f() -> &'a i32 {}").tokens,
    );
    expect(diagnostics).toHaveLength(0);
    expect(program).toMatchObject(
      some({
        items: [
          {
            kind: "Function",
            signature: {
              returnType: some({
                kind: "ReferenceType",
                mutable: false,
                lifetime: some({ kind: "Lifetime", name: "a" }),
                referent: { kind: "NamedType", path: { segments: ["i32"] } },
              }),
            },
          },
        ],
      }),
    );
  });

  it("parses a lifetime-annotated exclusive reference param fn f(x: &'a mut i32) {}", (): void => {
    const { program, diagnostics } = parse(
      tokenize("fn f(x: &'a mut i32) {}").tokens,
    );
    expect(diagnostics).toHaveLength(0);
    expect(program).toMatchObject(
      some({
        items: [
          {
            kind: "Function",
            signature: {
              params: [
                {
                  type: {
                    kind: "ReferenceType",
                    mutable: true,
                    lifetime: some({ kind: "Lifetime", name: "a" }),
                    referent: {
                      kind: "NamedType",
                      path: { segments: ["i32"] },
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
});

describe("generic type arguments - type position", (): void => {
  it("parses Vec<T> as a named type with one type argument in a function parameter position", (): void => {
    const { tokens } = tokenize("fn foo(x: Vec<T>) {}");
    const { diagnostics, program } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [
            {
              type: {
                kind: "NamedType",
                path: { segments: ["Vec"] },
                typeArguments: [
                  { kind: "NamedType", path: { segments: ["T"] } },
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it("parses Vec<T> as a named type with one type argument on a let binding", (): void => {
    const { tokens } = tokenize("let mut x: Vec<T>;");
    const { diagnostics, program } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "LetStatement",
        type: some({
          kind: "NamedType",
          path: { segments: ["Vec"] },
          typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
        }),
      },
    ]);
  });

  it("parses Vec<T> as a generic return type", (): void => {
    const { tokens } = tokenize("fn f() -> Vec<T> {}");
    const { diagnostics, program } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          returnType: some({
            kind: "NamedType",
            path: { segments: ["Vec"] },
            typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
          }),
        },
      },
    ]);
  });

  it("parses Vec<T> as a generic struct field type", (): void => {
    const { tokens } = tokenize("struct S { x: Vec<T> }");
    const { diagnostics, program } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        body: {
          kind: "NamedFields",
          fields: [
            {
              name: { text: "x" },
              type: {
                kind: "NamedType",
                path: { segments: ["Vec"] },
                typeArguments: [
                  { kind: "NamedType", path: { segments: ["T"] } },
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it("parses Vec<Vec<T>> as a nested generic type, splitting the trailing >>", (): void => {
    const { tokens } = tokenize("let mut x: Vec<Vec<T>>;");
    const { diagnostics, program } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "LetStatement",
        type: some({
          kind: "NamedType",
          path: { segments: ["Vec"] },
          typeArguments: [
            {
              kind: "NamedType",
              path: { segments: ["Vec"] },
              typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
            },
          ],
        }),
      },
    ]);
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

  it("parses a user-declared generic struct nested as a type in a function parameter position (Foo<Foo<T>>)", (): void => {
    const { tokens } = tokenize(
      "struct Foo<T>(T); fn foo<T>(t: Foo<Foo<T>>) {}",
    );
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      { kind: "Struct" },
      {
        kind: "Function",
        signature: {
          params: [
            {
              type: {
                kind: "NamedType",
                path: { segments: ["Foo"] },
                typeArguments: [
                  {
                    kind: "NamedType",
                    path: { segments: ["Foo"] },
                    typeArguments: [
                      { kind: "NamedType", path: { segments: ["T"] } },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ]);
  });
});

describe("lifetime guardrail - generic type argument position", (): void => {
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

  it("no longer produces the generic-Slice-4 diagnostic for Vec<T>, now that type-position generics parse (regression)", (): void => {
    const { tokens } = tokenize("let mut x: Vec<T>;");
    const { diagnostics, program } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    expect(isSome(program)).toBe(true);
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

  it("rejects a struct with no body at all", (): void => {
    const result = parse(tokenize("struct Foo").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toBe(
      'expected struct body (`{`, `(`, or `;`), found "eof"',
    );
  });

  it("rejects a struct whose body starts with an unexpected token", (): void => {
    const result = parse(tokenize("struct Foo = 1;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toBe(
      'expected struct body (`{`, `(`, or `;`), found "eq"',
    );
  });

  it("rejects a tuple struct missing its trailing semicolon", (): void => {
    const result = parse(tokenize("struct Foo(i32)").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toBe(
      'Expected semi, found "eof" at offset 15',
    );
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

describe("enum declarations", (): void => {
  it("parses a unit variant", (): void => {
    const ast = parseProgram("enum Message { Quit }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          name: { kind: "Identifier", text: "Message" },
          variants: [
            {
              kind: "Variant",
              name: { kind: "Identifier", text: "Quit" },
              body: none(),
            },
          ],
        },
      ],
    });
  });

  it("parses a tuple variant", (): void => {
    const ast = parseProgram("enum Message { Move(i32, i32) }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            {
              kind: "Variant",
              name: { kind: "Identifier", text: "Move" },
              body: some({
                kind: "TupleFields",
                fields: [
                  { type: { kind: "NamedType", path: { segments: ["i32"] } } },
                  { type: { kind: "NamedType", path: { segments: ["i32"] } } },
                ],
              }),
            },
          ],
        },
      ],
    });
  });

  it("parses a zero-arg tuple variant distinctly from a bare unit variant", (): void => {
    const ast = parseProgram("enum Message { Move() }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            {
              kind: "Variant",
              name: { kind: "Identifier", text: "Move" },
              body: some({ kind: "TupleFields", fields: [] }),
            },
          ],
        },
      ],
    });
  });

  it("parses a struct variant", (): void => {
    const ast = parseProgram("enum Message { Write { text: str } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            {
              kind: "Variant",
              name: { kind: "Identifier", text: "Write" },
              body: some({
                kind: "NamedFields",
                fields: [
                  {
                    name: { kind: "Identifier", text: "text" },
                    type: { kind: "NamedType", path: { segments: ["str"] } },
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  });

  it("parses an empty struct variant distinctly from a bare unit variant", (): void => {
    const ast = parseProgram("enum Message { Write {} }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            {
              kind: "Variant",
              name: { kind: "Identifier", text: "Write" },
              body: some({ kind: "NamedFields", fields: [] }),
            },
          ],
        },
      ],
    });
  });

  it("parses all three variant shapes combined in one enum, with a trailing comma", (): void => {
    const ast = parseProgram(
      "enum Message { Quit, Move(i32, i32), Write { text: str }, }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            { kind: "Variant", name: { text: "Quit" }, body: none() },
            {
              kind: "Variant",
              name: { text: "Move" },
              body: some({ kind: "TupleFields" }),
            },
            {
              kind: "Variant",
              name: { text: "Write" },
              body: some({ kind: "NamedFields" }),
            },
          ],
        },
      ],
    });
  });

  it("parses an empty enum with zero variants", (): void => {
    const ast = parseProgram("enum Never {}");
    expect(ast).toMatchObject({
      items: [{ kind: "Enum", name: { text: "Never" }, variants: [] }],
    });
  });

  it("parses a self-referential recursive enum with no indirection wrapper", (): void => {
    const ast = parseProgram("enum List { Cons(i32, List), Nil }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            {
              name: { text: "Cons" },
              body: some({
                kind: "TupleFields",
                fields: [
                  { type: { kind: "NamedType", path: { segments: ["i32"] } } },
                  {
                    type: { kind: "NamedType", path: { segments: ["List"] } },
                  },
                ],
              }),
            },
            { name: { text: "Nil" }, body: none() },
          ],
        },
      ],
    });
  });

  it("parses #[non_exhaustive] on the enum itself", (): void => {
    const ast = parseProgram("#[non_exhaustive] enum Message { Quit }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          attributes: [{ kind: "Attribute", name: { text: "non_exhaustive" } }],
        },
      ],
    });
  });

  it("parses an attribute on an individual variant", (): void => {
    const ast = parseProgram("enum Message { #[deprecated] Quit, Move(i32) }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Enum",
          variants: [
            {
              kind: "Variant",
              name: { text: "Quit" },
              attributes: [{ kind: "Attribute", name: { text: "deprecated" } }],
            },
            { kind: "Variant", name: { text: "Move" }, attributes: [] },
          ],
        },
      ],
    });
  });

  it("parses a real lifetime-only generics list, resolving a reference field's explicit lifetime (enum Container<'a> { Ref(&'a i32) })", (): void => {
    const { tokens } = tokenize("enum Container<'a> { Ref(&'a i32) }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Container" },
        generics: [
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "a" } },
        ],
        variants: [
          {
            name: { text: "Ref" },
            body: some({
              kind: "TupleFields",
              fields: [
                {
                  type: {
                    kind: "ReferenceType",
                    mutable: false,
                    lifetime: some({ kind: "Lifetime", name: "a" }),
                  },
                },
              ],
            }),
          },
        ],
      },
    ]);
  });

  it("parses multiple lifetime generics (enum Container<'a, 'b> { Ref(&'a i32, &'b i32) })", (): void => {
    const { tokens } = tokenize(
      "enum Container<'a, 'b> { Ref(&'a i32, &'b i32) }",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        generics: [
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "a" } },
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "b" } },
        ],
        variants: [
          {
            body: some({
              kind: "TupleFields",
              fields: [
                { type: { lifetime: some({ kind: "Lifetime", name: "a" }) } },
                { type: { lifetime: some({ kind: "Lifetime", name: "b" }) } },
              ],
            }),
          },
        ],
      },
    ]);
  });

  it("parses a single generic type parameter with zero diagnostics (enum Foo<T> {})", (): void => {
    const { tokens } = tokenize("enum Foo<T> {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        generics: [{ kind: "TypeParam", name: { text: "T" }, bounds: [] }],
      },
    ]);
  });

  it("parses an inline trait bound on an enum's own generic parameter (enum Container<T: Draw> { Item(T) })", (): void => {
    const { tokens } = tokenize("enum Container<T: Draw> { Item(T) }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Container" },
        generics: [
          {
            kind: "TypeParam",
            name: { text: "T" },
            bounds: [
              {
                kind: "PathTraitBound",
                path: { segments: ["Draw"] },
                typeArguments: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("parses a lifetime param followed by a type param, in that order (enum Foo<'a, T> {})", (): void => {
    const { tokens } = tokenize("enum Foo<'a, T> {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        generics: [
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "a" } },
          { kind: "TypeParam", name: { text: "T" }, bounds: [] },
        ],
      },
    ]);
  });

  it("parses a type param followed by a lifetime param, the reverse order (enum Foo<T, 'a> {})", (): void => {
    const { tokens } = tokenize("enum Foo<T, 'a> {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        generics: [
          { kind: "TypeParam", name: { text: "T" }, bounds: [] },
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "a" } },
        ],
      },
    ]);
  });

  it("parses a where clause with zero diagnostics (enum Foo where T: Draw { Quit })", (): void => {
    const { tokens } = tokenize("enum Foo where T: Draw { Quit }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        whereClause: some({
          kind: "WhereClause",
          predicates: [
            {
              type: { kind: "NamedType", path: { segments: ["T"] } },
              bounds: [
                {
                  kind: "PathTraitBound",
                  path: { segments: ["Draw"] },
                  typeArguments: [],
                },
              ],
            },
          ],
        }),
        variants: [{ name: { text: "Quit" } }],
      },
    ]);
  });

  it("parses a unit-variant construction path (Message::Quit) as a bare path expression", (): void => {
    const ast = parseProgram("enum Message { Quit } fn f() { Message::Quit; }");
    expect(ast).toMatchObject({
      items: [
        { kind: "Enum" },
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "ExpressionStatement",
                expression: {
                  kind: "PathExpression",
                  path: { segments: ["Message", "Quit"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a tuple-variant construction path (Message::Move(1, 2)) as a call over a path expression", (): void => {
    const ast = parseProgram(
      "enum Message { Move(i32, i32) } fn f() { Message::Move(1, 2); }",
    );
    expect(ast).toMatchObject({
      items: [
        { kind: "Enum" },
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "ExpressionStatement",
                expression: {
                  kind: "CallExpression",
                  callee: {
                    kind: "PathExpression",
                    path: { segments: ["Message", "Move"] },
                  },
                  arguments: [
                    { kind: "IntLiteral", value: "1" },
                    { kind: "IntLiteral", value: "2" },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
  });

  it('parses a struct-variant construction path (Message::Write { text: "hi" }) as a struct expression', (): void => {
    const ast = parseProgram(
      'enum Message { Write { text: str } } fn f() { Message::Write { text: "hi" }; }',
    );
    expect(ast).toMatchObject({
      items: [
        { kind: "Enum" },
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "ExpressionStatement",
                expression: {
                  kind: "StructExpression",
                  path: { segments: ["Message", "Write"] },
                  fields: [
                    {
                      name: { text: "text" },
                      value: some({ kind: "StringLiteral", value: "hi" }),
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("a missing closing brace at EOF fails fast with one clear diagnostic, without hanging", (): void => {
    const { tokens } = tokenize("enum Foo { Quit");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("rbrace");
  });

  it("a missing closing brace immediately followed by a sibling declaration recovers: the sibling still parses, with exactly one diagnostic", (): void => {
    const { tokens } = tokenize("enum Foo { Quit fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("rbrace");
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        variants: [{ name: { text: "Quit" } }],
      },
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });

  it("a malformed field inside a struct variant's body recovers at the field-list level, keeping the variant (with the bad field dropped) and its sibling, with exactly one diagnostic (no cascade)", (): void => {
    const { tokens } = tokenize("enum Foo { Bad { x }, Ok }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("':'");
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        variants: [
          {
            name: { text: "Bad" },
            body: some({ kind: "NamedFields", fields: [] }),
          },
          { name: { text: "Ok" }, body: none() },
        ],
      },
    ]);
  });

  it("a malformed variant (not an identifier) recovers at the variant-list level: it is dropped entirely, and its sibling still parses, with exactly one diagnostic (no cascade)", (): void => {
    const { tokens } = tokenize("enum Foo { 1, Ok }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("identifier");
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        name: { text: "Foo" },
        variants: [{ name: { text: "Ok" } }],
      },
    ]);
  });

  it("a missing enum name fails fast (program: none()) - not covered by the fn/struct-only missing-name recovery", (): void => {
    const { tokens } = tokenize("enum { Quit }");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("identifier");
  });

  it("parses a local enum declaration inside a function body", (): void => {
    const ast = parseProgram("fn f() { enum Local { A, B } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "Enum",
                name: { text: "Local" },
                variants: [{ name: { text: "A" } }, { name: { text: "B" } }],
              },
            ],
          },
        },
      ],
    });
  });

  it("constructs a locally-declared enum's variant within the same function body", (): void => {
    const ast = parseProgram("fn f() { enum Local { A } let x = Local::A; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              { kind: "Enum", name: { text: "Local" } },
              {
                kind: "LetStatement",
                initializer: some({
                  kind: "PathExpression",
                  path: { segments: ["Local", "A"] },
                }),
              },
            ],
          },
        },
      ],
    });
  });

  it("a truncated tuple-variant body (missing its own closing paren, then the enum's own closing brace) fails fast with both diagnostics, no hang", (): void => {
    const { tokens } = tokenize("enum Foo { Bad(i32");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toContain("rparen");
    expect(diagnostics[1]?.message).toContain("rbrace");
  });

  it("parses a generic type inside a variant's tuple field (Vec<T>), matching the same behavior on a plain struct field", (): void => {
    const { tokens } = tokenize("enum Foo { Bad(Vec<T>) }");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Enum",
        variants: [
          {
            name: { text: "Bad" },
            body: some({
              kind: "TupleFields",
              fields: [
                {
                  type: {
                    kind: "NamedType",
                    path: { segments: ["Vec"] },
                    typeArguments: [
                      { kind: "NamedType", path: { segments: ["T"] } },
                    ],
                  },
                },
              ],
            }),
          },
        ],
      },
    ]);
  });
});

describe("const declarations", (): void => {
  it("parses a top-level const with a typed literal initializer", (): void => {
    const ast = parseProgram("const N: usize = 3;");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Const",
          name: { kind: "Identifier", text: "N" },
          type: {
            kind: "NamedType",
            path: { absolute: false, segments: ["usize"] },
          },
          value: { kind: "IntLiteral", value: "3" },
        },
      ],
    });
  });

  it("parses a const with a binary-expression initializer", (): void => {
    const ast = parseProgram("const N: i32 = 1 + 2;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Const",
          value: {
            kind: "BinaryExpression",
            operator: "Add",
            left: { kind: "IntLiteral", value: "1" },
            right: { kind: "IntLiteral", value: "2" },
          },
        },
      ],
    });
  });

  it("rejects a const declaration missing its type annotation", (): void => {
    const result = parse(tokenize("const N = 3;").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("colon");
  });

  it("rejects a const declaration missing its initializer", (): void => {
    const result = parse(tokenize("const N: usize;").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("eq");
  });

  it("rejects a const declaration missing its trailing semicolon", (): void => {
    const result = parse(tokenize("const N: usize = 3").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("semi");
  });
});

describe("static declarations", (): void => {
  it("parses a top-level static with a literal initializer", (): void => {
    const ast = parseProgram("static COUNT: i32 = 0;");
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Static",
          name: { kind: "Identifier", text: "COUNT" },
          type: {
            kind: "NamedType",
            path: { absolute: false, segments: ["i32"] },
          },
          value: { kind: "IntLiteral", value: "0" },
        },
      ],
    });
  });

  it("parses a static with a call-expression initializer", (): void => {
    const ast = parseProgram("static TABLE: i32 = build_table();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Static",
          value: { kind: "CallExpression" },
        },
      ],
    });
  });

  it("rejects static mut, since the grammar has no mut slot for static items", (): void => {
    const result = parse(tokenize("static mut COUNT: i32 = 0;").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "expected a diagnostic");
    expect(result.diagnostics[0].message).toContain("mut");
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
          signature: {
            attributes: [
              {
                kind: "Attribute",
                name: { kind: "Identifier", text: "align" },
                arguments: some([
                  {
                    literal: some({ kind: "IntLiteral", value: "8", base: 10 }),
                  },
                ]),
              },
            ],
          },
        },
      ],
    });
  });
});

describe("attribute multiple arguments", (): void => {
  it("parses a comma-separated attribute argument list of mixed kinds", (): void => {
    const ast = parseProgram('#[attr(1, "two", three)] fn f() {}');
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            attributes: [
              {
                kind: "Attribute",
                name: { kind: "Identifier", text: "attr" },
                arguments: some([
                  { literal: some({ kind: "IntLiteral", value: "1" }) },
                  { literal: some({ kind: "StringLiteral", value: "two" }) },
                  { path: some({ segments: ["three"] }) },
                ]),
              },
            ],
          },
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
          {
            kind: "Function",
            signature: {
              name: { kind: "Identifier", text: "fn_helper" },
            },
          },
        ],
      });
    });

    it("can define a function named let_count", (): void => {
      const ast = parseProgram("fn let_count() {}");
      expect(ast).toMatchObject({
        items: [
          {
            kind: "Function",
            signature: {
              name: { kind: "Identifier", text: "let_count" },
            },
          },
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

    // `true`/`false` are excluded here: as of Slice 3, a bare literal is
    // valid pattern syntax (`LiteralPattern`), so `let true = 1;` now parses
    // successfully at the parser level - see the dedicated test below. Every
    // other hard keyword still starts neither an identifier nor a pattern,
    // so still fails to parse.
    const NON_LITERAL_HARD_KEYWORDS = ALL_HARD_KEYWORDS.filter(
      (kw) => kw !== "true" && kw !== "false",
    );

    it.each(NON_LITERAL_HARD_KEYWORDS)(
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

    it.each(["true", "false"])(
      "parses hard keyword %s in let position as a LiteralPattern, not a rejected binding name",
      (kw) => {
        const ast = parseProgram(`let ${kw} = 1;`);
        expect(ast).toMatchObject({
          items: [
            {
              kind: "LetStatement",
              pattern: {
                kind: "LiteralPattern",
                literal: { kind: "BoolLiteral", value: kw === "true" },
              },
            },
          ],
        });
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
        items: [
          {
            kind: "Function",
            signature: {
              name: { kind: "Identifier", text: "fn" },
            },
          },
        ],
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
      const stmt = result.program.value.items.find(
        (s) => s.kind === "LetStatement",
      );
      assert(stmt !== undefined, "expected LetStatement");
      assert(stmt.pattern.kind === "BindingPattern", "expected BindingPattern");
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
      const stmt = program.value.items.find((s) => s.kind === "LetStatement");
      assert(stmt !== undefined, "expected LetStatement");
      assert(stmt.pattern.kind === "BindingPattern", "expected BindingPattern");
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
      const { tokenId } = fn_.signature.name;
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

  it("a & b parses as bit-and (infix), not a reference expression", (): void => {
    const ast = parseProgram("a & b;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "BinaryExpression",
            operator: "BitAnd",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          },
        },
      ],
    });
  });

  it("&a.b borrows a field access - matches the spec's own example", (): void => {
    const ast = parseProgram("&a.b;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: false,
            operand: { kind: "FieldAccessExpression" },
          },
        },
      ],
    });
  });

  it("&foo() borrows a call result", (): void => {
    const ast = parseProgram("&foo();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: false,
            operand: { kind: "CallExpression" },
          },
        },
      ],
    });
  });

  it("&a[0] borrows an index expression", (): void => {
    const ast = parseProgram("&a[0];");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: false,
            operand: { kind: "IndexExpression" },
          },
        },
      ],
    });
  });

  it("a malformed reference operand produces exactly one diagnostic, not a cascade", (): void => {
    const { program, diagnostics } = parse(tokenize("&;").tokens);
    expect(program).toEqual(none());
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(1);
  });
});

describe("dereference expressions", (): void => {
  it("parses *p as a dereference expression", (): void => {
    const ast = parseProgram("*p;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "DereferenceExpression",
            operand: { kind: "PathExpression", path: { segments: ["p"] } },
          },
        },
      ],
    });
  });

  it("parses **p as nested dereference expressions", (): void => {
    const ast = parseProgram("**p;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "DereferenceExpression",
            operand: {
              kind: "DereferenceExpression",
              operand: { kind: "PathExpression", path: { segments: ["p"] } },
            },
          },
        },
      ],
    });
  });

  it("&*p borrows a dereference - reborrow pattern", (): void => {
    const ast = parseProgram("&*p;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: false,
            operand: { kind: "DereferenceExpression" },
          },
        },
      ],
    });
  });

  it("*&x dereferences a reference - round trip", (): void => {
    const ast = parseProgram("*&x;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "DereferenceExpression",
            operand: { kind: "ReferenceExpression", mutable: false },
          },
        },
      ],
    });
  });

  it("&mut *p - exclusive borrow of a dereference", (): void => {
    const ast = parseProgram("&mut *p;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "ReferenceExpression",
            mutable: true,
            operand: { kind: "DereferenceExpression" },
          },
        },
      ],
    });
  });

  it("a malformed dereference operand produces exactly one diagnostic, not a cascade", (): void => {
    const { program, diagnostics } = parse(tokenize("*;").tokens);
    expect(program).toEqual(none());
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(1);
  });
});

describe("let binding modifiers", (): void => {
  it("parses let mut x = 1", (): void => {
    const ast = parseProgram("let mut x = 1;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          pattern: { mutable: true, name: { text: "x" } },
        },
      ],
    });
  });

  it("parses let x = 1 as immutable", (): void => {
    const ast = parseProgram("let x = 1;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          pattern: { mutable: false, name: { text: "x" } },
        },
      ],
    });
  });

  it("parses let x; with no type and no initializer", (): void => {
    const ast = parseProgram("let x;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", type: none(), initializer: none() }],
    });
  });
});

describe("core patterns", (): void => {
  it("parses let _ = 5; as a wildcard pattern", (): void => {
    const ast = parseProgram("let _ = 5;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          pattern: { kind: "WildcardPattern" },
          initializer: some({ kind: "IntLiteral", value: "5" }),
        },
      ],
    });
  });

  it("parses fn f(_: i32) {} with a wildcard parameter", (): void => {
    const ast = parseProgram("fn f(_: i32) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            params: [{ kind: "Param", pattern: { kind: "WildcardPattern" } }],
          },
        },
      ],
    });
  });

  it("rejects mut applied to the wildcard pattern", (): void => {
    const { tokens } = tokenize("let mut _ = 5;");
    const mutToken = tokens.find(
      (t) => t.kind === "keyword" && t.text === "mut",
    );
    assert(mutToken !== undefined, "Expected to find a mut token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("wildcard");
    expect(result.diagnostics[0]?.span).toEqual(some(mutToken.span));
  });

  it("parses a struct pattern in let position as a real StructPattern (semantic rejection is analyzer.ts's job now)", (): void => {
    const ast = parseProgram("let Point { x, y } = p;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          pattern: {
            kind: "StructPattern",
            path: { segments: ["Point"] },
            fields: [
              { kind: "FieldPattern", name: { text: "x" }, pattern: none() },
              { kind: "FieldPattern", name: { text: "y" }, pattern: none() },
            ],
            hasRest: false,
          },
        },
      ],
    });
  });

  it("parses a struct pattern in param position as a real StructPattern (semantic rejection is analyzer.ts's job now)", (): void => {
    const ast = parseProgram("fn f(Point { x, y }: Point) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            params: [
              {
                kind: "Param",
                pattern: {
                  kind: "StructPattern",
                  path: { segments: ["Point"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a `mut` sigil on a struct pattern as a real, mutable StructPattern", (): void => {
    const ast = parseProgram("fn f(mut Point { x, y }: Point) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            params: [
              {
                kind: "Param",
                pattern: {
                  kind: "StructPattern",
                  mutable: true,
                  path: { segments: ["Point"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses a `mut` sigil on a tuple-struct pattern as a real, mutable TupleStructPattern", (): void => {
    const ast = parseProgram("let mut Pair(a, b) = pair;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          pattern: {
            kind: "TupleStructPattern",
            mutable: true,
            path: { segments: ["Pair"] },
          },
        },
      ],
    });
  });

  it("still rejects a `&` sigil on a struct pattern", (): void => {
    // A malformed parameter recovers via the existing per-element comma-list
    // recovery - `sigilOnPathMessage` isn't a registered fail-fast guardrail,
    // so the program still comes back `Some`, just with the
    // diagnostic attached.
    const { program, diagnostics } = parse(
      tokenize("fn f(&Point { x, y }: Point) {}").tokens,
    );
    expect(isSome(program)).toBe(true);
    expect(diagnostics[0]?.message).toContain(
      "cannot be applied to a struct, tuple-struct, or path pattern",
    );
  });

  it("still rejects a `&mut` sigil on a tuple-struct pattern", (): void => {
    const { program, diagnostics } = parse(
      tokenize("let &mut Pair(a, b) = pair;").tokens,
    );
    expect(program).toEqual(none());
    expect(diagnostics[0]?.message).toContain(
      "cannot be applied to a struct, tuple-struct, or path pattern",
    );
  });

  it("still rejects a `mut` sigil on a bare (fieldless) path pattern", (): void => {
    const { program, diagnostics } = parse(
      tokenize("fn f() { match m { mut Message::Quit => 0 } }").tokens,
    );
    expect(program).toEqual(none());
    expect(diagnostics[0]?.message).toContain(
      "`mut` cannot be applied to a fieldless pattern",
    );
  });

  it("parses a struct pattern field with an explicit renamed sub-pattern (`Point { x: a, y: b }`)", (): void => {
    const ast = parseProgram("match p { Point { x: a, y: b } => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "StructPattern",
                path: { segments: ["Point"] },
                fields: [
                  {
                    name: { text: "x" },
                    pattern: some({
                      kind: "BindingPattern",
                      name: { text: "a" },
                    }),
                  },
                  {
                    name: { text: "y" },
                    pattern: some({
                      kind: "BindingPattern",
                      name: { text: "b" },
                    }),
                  },
                ],
                hasRest: false,
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a struct pattern with a `..` rest (`Point { x, .. }`)", (): void => {
    const ast = parseProgram("match p { Point { x, .. } => x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "StructPattern",
                path: { segments: ["Point"] },
                fields: [{ name: { text: "x" }, pattern: none() }],
                hasRest: true,
              },
            },
          ],
        },
      ],
    });
  });

  it("parses an empty struct pattern (`Point {}`)", (): void => {
    const ast = parseProgram("match p { Point {} => 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "StructPattern",
                path: { segments: ["Point"] },
                fields: [],
                hasRest: false,
              },
            },
          ],
        },
      ],
    });
  });

  it("produces a parse error for an unclosed struct pattern (`match p { Point { x, y => a }`)", (): void => {
    const result = parse(tokenize("match p { Point { x, y => a }").tokens);
    expect(result.program).toEqual(none());
  });

  it("parses a struct pattern with a multi-segment path (`Message::Move { x, y }`)", (): void => {
    const ast = parseProgram("match m { Message::Move { x, y } => x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "StructPattern",
                path: { segments: ["Message", "Move"] },
                fields: [
                  { name: { text: "x" }, pattern: none() },
                  { name: { text: "y" }, pattern: none() },
                ],
                hasRest: false,
              },
            },
          ],
        },
      ],
    });
  });

  it("gives the MUT_MESSAGE for fn f(mut: i32) {} (mut used as a param name)", (): void => {
    const result = parse(tokenize("fn f(mut: i32) {}").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "The keyword `mut` is reserved",
    );
  });

  it("still gives the MUT_MESSAGE for let mut = 1; after the pattern refactor", (): void => {
    const { tokens } = tokenize("let mut = 1;");
    const mutToken = tokens.find(
      (t) => t.kind === "keyword" && t.text === "mut",
    );
    assert(mutToken !== undefined, "Expected to find a mut token");
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "The keyword `mut` is reserved",
    );
    expect(result.diagnostics[0]?.span).toEqual(some(mutToken.span));
  });

  it("parses `&y` as a shared-borrow binding pattern", (): void => {
    const ast = parseProgram("match x { &y => y }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "BindingPattern",
                byRef: true,
                mutable: false,
                name: { text: "y" },
              },
            },
          ],
        },
      ],
    });
  });

  it("parses `&mut y` as a mutable-borrow binding pattern", (): void => {
    const ast = parseProgram("match x { &mut y => y }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "BindingPattern",
                byRef: true,
                mutable: true,
                name: { text: "y" },
              },
            },
          ],
        },
      ],
    });
  });

  it("does not set byRef on a plain binding pattern", (): void => {
    const ast = parseProgram("match x { y => y }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [{ pattern: { kind: "BindingPattern", byRef: false } }],
        },
      ],
    });
  });

  it("rejects `&_`, since a byRef sigil cannot apply to the wildcard pattern", (): void => {
    const result = parse(tokenize("match x { &_ => 1 }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("wildcard");
  });

  it("rejects `&mut _`, since a byRef sigil cannot apply to the wildcard pattern", (): void => {
    const result = parse(tokenize("match x { &mut _ => 1 }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("wildcard");
  });

  it("parses `n @ 1..=5` storing both the binding name and the sub-pattern", (): void => {
    const ast = parseProgram("match x { n @ 1..=5 => n }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "BindingPattern",
                name: { text: "n" },
                subpattern: some({
                  kind: "RangePattern",
                  start: { literal: { value: "1" } },
                  end: { literal: { value: "5" } },
                }),
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a sigil combined with an @-binding (`mut n @ 1..=5`)", (): void => {
    const ast = parseProgram("match x { mut n @ 1..=5 => n }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "BindingPattern",
                mutable: true,
                name: { text: "n" },
                subpattern: some({ kind: "RangePattern" }),
              },
            },
          ],
        },
      ],
    });
  });

  it("leaves subpattern as none() for a plain binding with no @", (): void => {
    const ast = parseProgram("match x { n => n }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [{ pattern: { kind: "BindingPattern", subpattern: none() } }],
        },
      ],
    });
  });

  it("binds `|` to the enclosing alternation, not the @-binding's own sub-pattern (`n @ 1 | 2`)", (): void => {
    // The `@` sub-pattern is grammar's `PatternNoAlt`, not the full
    // alternation-capable `Pattern`, so `n @ 1` is one complete alternative
    // on its own; the trailing `| 2` is picked up by the *outer*
    // alternation loop, producing `(n @ 1) | 2`, not `n @ (1 | 2)`.
    // Whether the two alternatives bind consistent names is a semantic
    // concern (spec 0016), not this parser's job.
    const ast = parseProgram("match x { n @ 1 | 2 => n }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "OrPattern",
                alternatives: [
                  {
                    kind: "BindingPattern",
                    name: { text: "n" },
                    subpattern: some({
                      kind: "LiteralPattern",
                      literal: { value: "1" },
                    }),
                  },
                  { kind: "LiteralPattern", literal: { value: "2" } },
                ],
              },
            },
          ],
        },
      ],
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
          signature: {
            name: { text: "f" },
          },
          body: {
            statements: [
              {
                kind: "Function",
                signature: {
                  name: { text: "g" },
                },
              },
            ],
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
                signature: {
                  name: { text: "g" },
                  visibility: some({ scope: none() }),
                },
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
            statements: [
              {
                kind: "Function",
                signature: {
                  name: { text: "double" },
                },
              },
            ],
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
          signature: {
            visibility: some({ scope: none() }),
            name: { text: "f" },
          },
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
          signature: {
            visibility: some({ scope: some("package") }),
            name: { text: "f" },
          },
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

describe("parse errors - missing tokens", (): void => {
  it("errors on a let statement with no semicolon", (): void => {
    const result = parse(tokenize("let x = 1").tokens);
    expect(result.program).toEqual(none());
  });

  it("parses a let statement with a bare int literal as a LiteralPattern, not a rejected non-identifier pattern", (): void => {
    const ast = parseProgram("let 42 = 1;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          pattern: {
            kind: "LiteralPattern",
            literal: { kind: "IntLiteral", value: "42" },
          },
        },
      ],
    });
  });

  it("errors on a let statement with a pattern-starting token that is neither an identifier nor a literal", (): void => {
    const result = parse(tokenize("let + = 1;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("identifier");
  });

  it("errors on a function declaration truncated at EOF with neither a body brace nor a semicolon", (): void => {
    const result = parse(tokenize("fn f()").tokens);
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
    "let x = y = 5 and let x = (y = 5) produce type errors - assignment returns () and cannot initialize a non-unit binding",
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
          signature: {
            attributes: [{ name: { text: "a" } }, { name: { text: "b" } }],
          },
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

  it("parses a reference return type fn f() -> &'a i32 {} (explicit lifetime avoids the zero-reference-parameter elision-ambiguity case, which is exercised separately)", (): void => {
    const ast = parseProgram("fn f() -> &'a i32 {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            returnType: some({
              kind: "ReferenceType",
              mutable: false,
              lifetime: some({ kind: "Lifetime", name: "a" }),
              referent: { kind: "NamedType", path: { segments: ["i32"] } },
            }),
          },
        },
      ],
    });
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
        items: [
          {
            kind: "Function",
            signature: {
              name: { kind: "Identifier", text: kw },
            },
          },
        ],
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
      items: [
        {
          kind: "Function",
          signature: {
            name: { kind: "Identifier", text: "mut" },
          },
        },
      ],
    });
  });

  it("foo::fn gives a diagnostic naming fn", (): void => {
    const result = parse(tokenize("foo::fn;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("fn");
  });
});

describe("dereference parses in previously-guardrailed positions", (): void => {
  it("*1 parses (deref of an int literal, no longer a Slice-1 rejection)", (): void => {
    const ast = parseProgram("*1;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ExpressionStatement",
          expression: {
            kind: "DereferenceExpression",
            operand: { kind: "IntLiteral", value: "1" },
          },
        },
      ],
    });
  });

  it("let y = *x; parses as a let binding with a dereference initializer", (): void => {
    const ast = parseProgram("let y = *x;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          initializer: some({
            kind: "DereferenceExpression",
            operand: { kind: "PathExpression", path: { segments: ["x"] } },
          }),
        },
      ],
    });
  });

  it("fn f() { *x } parses a dereference as a block's trailing expression", (): void => {
    const ast = parseProgram("fn f() { *x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            kind: "Block",
            trailingExpression: some({ kind: "DereferenceExpression" }),
          },
        },
      ],
    });
  });
});

describe("function parameters", (): void => {
  it("zero parameters produce an empty params list", (): void => {
    const ast = parseProgram("fn f() {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            params: [],
          },
        },
      ],
    });
  });

  it("parses a single typed parameter", (): void => {
    const ast = parseProgram("fn add(x: i32) -> i32 { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
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
            returnType: some({
              kind: "NamedType",
              path: { segments: ["i32"] },
            }),
          },
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
          signature: {
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
          signature: {
            params: [{ kind: "Param", pattern: { name: { text: "x" } } }],
          },
        },
      ],
    });
  });

  it("parses a parameter with a qualified type", (): void => {
    const ast = parseProgram("fn f(v: std::Vec) {}");
    expect(ast).toMatchObject({
      items: [
        {
          signature: {
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
        },
      ],
    });
  });

  it("parses a parameter with the unit type", (): void => {
    const ast = parseProgram("fn f(x: ()) {}");
    expect(ast).toMatchObject({
      items: [
        {
          signature: {
            params: [{ kind: "Param", type: { kind: "UnitType" } }],
          },
        },
      ],
    });
  });
});

describe("method receivers", (): void => {
  function parseCleanly(source: string): Program {
    const { tokens } = tokenize(source);
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toEqual([]);
    assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
    return program.value;
  }

  it("parses a by-value self receiver", (): void => {
    const ast = parseCleanly("fn draw(self) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: some({ kind: "Receiver", byRef: false, mutable: false }),
            params: [],
          },
        },
      ],
    });
  });

  it("parses a mutable by-value self receiver", (): void => {
    const ast = parseCleanly("fn draw(mut self) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: some({ kind: "Receiver", byRef: false, mutable: true }),
            params: [],
          },
        },
      ],
    });
  });

  it("parses a shared-borrow self receiver", (): void => {
    const ast = parseCleanly("fn draw(&self) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: some({ kind: "Receiver", byRef: true, mutable: false }),
            params: [],
          },
        },
      ],
    });
  });

  it("parses a mutable-borrow self receiver", (): void => {
    const ast = parseCleanly("fn draw(&mut self) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: some({ kind: "Receiver", byRef: true, mutable: true }),
            params: [],
          },
        },
      ],
    });
  });

  it("parses a receiver followed by ordinary trailing parameters", (): void => {
    const ast = parseCleanly("fn draw(&mut self, dx: i32, dy: i32) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: some({ kind: "Receiver", byRef: true, mutable: true }),
            params: [
              { kind: "Param", pattern: { name: { text: "dx" } } },
              { kind: "Param", pattern: { name: { text: "dy" } } },
            ],
          },
        },
      ],
    });
  });

  it("accepts a trailing comma after a solo receiver", (): void => {
    const ast = parseCleanly("fn draw(self,) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: some({ kind: "Receiver", byRef: false, mutable: false }),
            params: [],
          },
        },
      ],
    });
  });

  it("records no receiver on an ordinary free function's parameter list", (): void => {
    const ast = parseCleanly("fn add(x: i32, y: i32) -> i32 { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: none(),
            params: [
              { kind: "Param", pattern: { name: { text: "x" } } },
              { kind: "Param", pattern: { name: { text: "y" } } },
            ],
          },
        },
      ],
    });
  });

  it("does not misdetect a plain mut-prefixed parameter as a receiver", (): void => {
    const ast = parseCleanly("fn f(mut x: i32) -> i32 { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            receiver: none(),
            params: [{ kind: "Param", pattern: { name: { text: "x" } } }],
          },
        },
      ],
    });
  });

  it("rejects a self receiver appearing after another parameter instead of first", (): void => {
    const { tokens } = tokenize("fn f(x: i32, self) {}");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain(
      'Expected an identifier, found keyword "self"',
    );
  });

  it("rejects a &mut self receiver appearing after another parameter instead of first", (): void => {
    const { tokens } = tokenize("fn f(x: i32, &mut self) {}");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
  });

  it("rejects a first-position receiver not followed by a comma or closing paren", (): void => {
    const { tokens } = tokenize("fn f(self x: i32) {}");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("receiver");
  });
});

describe("Self as a type", (): void => {
  function parseCleanly(source: string): Program {
    const { tokens } = tokenize(source);
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toEqual([]);
    assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
    return program.value;
  }

  it("parses a bare `Self` as a function return type", (): void => {
    const ast = parseCleanly("fn f() -> Self {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            returnType: some({
              kind: "NamedType",
              path: { absolute: false, segments: ["Self"] },
            }),
          },
        },
      ],
    });
  });

  it("parses a bare `Self` as a function parameter type", (): void => {
    const ast = parseCleanly("fn f(x: Self) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            params: [
              {
                kind: "Param",
                type: {
                  kind: "NamedType",
                  path: { absolute: false, segments: ["Self"] },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses `Self` in a `let` type annotation", (): void => {
    const ast = parseCleanly("let mut x: Self;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({
            kind: "NamedType",
            path: { absolute: false, segments: ["Self"] },
          }),
        },
      ],
    });
  });

  it("parses an absolute-path `::Self` the same as bare `Self`", (): void => {
    const ast = parseCleanly("let mut x: ::Self;");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({
            kind: "NamedType",
            path: { absolute: true, segments: ["Self"] },
          }),
        },
      ],
    });
  });

  it("parses `Self::Item` as a function return type", (): void => {
    const ast = parseCleanly("fn f() -> Self::Item {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            returnType: some({
              kind: "NamedType",
              path: { absolute: false, segments: ["Self", "Item"] },
            }),
          },
        },
      ],
    });
  });

  it("parses `&Self` as a function parameter type", (): void => {
    const ast = parseCleanly("fn f(x: &Self) {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            params: [
              {
                kind: "Param",
                type: {
                  kind: "ReferenceType",
                  mutable: false,
                  referent: {
                    kind: "NamedType",
                    path: { absolute: false, segments: ["Self"] },
                  },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("parses `&mut Self` as a function return type", (): void => {
    const ast = parseCleanly("fn f(x: &Self) -> &mut Self {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          signature: {
            returnType: some({
              kind: "ReferenceType",
              mutable: true,
              referent: {
                kind: "NamedType",
                path: { absolute: false, segments: ["Self"] },
              },
            }),
          },
        },
      ],
    });
  });
});

describe("unsupported item keywords", (): void => {
  it.each(["export", "extern"])(
    "rejects `%s` with a Slice 1 diagnostic",
    (keyword): void => {
      const { tokens } = tokenize(`${keyword} Foo {}`);
      const { diagnostics } = parse(tokens);
      expect(diagnostics[0]?.severity).toBe("error");
      expect(diagnostics[0]?.message).toContain("Slice 1");
      expect(diagnostics[0]?.message).toContain(keyword);
    },
  );

  it.each(["export", "extern"])(
    "recovers so a sibling function after a rejected `%s` declaration still parses",
    (keyword): void => {
      const { tokens } = tokenize(`${keyword} Foo {} fn bar() {}`);
      const { program, diagnostics } = parse(tokens);
      assert(isSome(program), "Expected a program to come back");
      expect(diagnostics[0]?.severity).toBe("error");
      expect(diagnostics[0]?.message).toContain("Slice 1");
      expect(diagnostics[0]?.message).toContain(keyword);
      expect(program.value.items).toMatchObject([
        {
          kind: "Function",
          signature: {
            name: { text: "bar" },
          },
        },
      ]);
    },
  );

  it("rejects `async fn` with a clear Slice 1/Slice 8 diagnostic and recovers", (): void => {
    const { tokens } = tokenize("async fn foo() {} fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[0]?.message).toContain("Slice 8");
    expect(diagnostics[0]?.message).toContain("async");
    expect(diagnostics[0]?.message).not.toContain("Expected an expression");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });

  it.each(["use", "mod"])(
    "rejects top-level `%s` with a clear Slice 1/Slice 7 diagnostic and recovers",
    (keyword): void => {
      const { tokens } = tokenize(`${keyword} foo; fn bar() {}`);
      const { program, diagnostics } = parse(tokens);
      assert(isSome(program), "Expected a program to come back");
      expect(diagnostics[0]?.severity).toBe("error");
      expect(diagnostics[0]?.message).toContain("Slice 1");
      expect(diagnostics[0]?.message).toContain("Slice 7");
      expect(diagnostics[0]?.message).toContain(keyword);
      expect(diagnostics[0]?.message).not.toContain("Expected an expression");
      expect(program.value.items).toMatchObject([
        {
          kind: "Function",
          signature: {
            name: { text: "bar" },
          },
        },
      ]);
    },
  );

  it("parses a match used as a let initializer (`let y = match x {};`)", (): void => {
    const { tokens } = tokenize("let y = match x {};");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), diagnostics[0]?.message ?? "Expected a program");
    expect(program.value.items).toMatchObject([
      {
        kind: "LetStatement",
        initializer: some({ kind: "MatchExpression", arms: [] }),
      },
    ]);
  });

  it.each(["export", "extern", "async", "use", "mod"])(
    "`%s` with no body at EOF fails fast without hanging",
    (keyword): void => {
      const { tokens } = tokenize(keyword);
      const { program, diagnostics } = parse(tokens);
      assert(isNone(program), "Expected no program to come back");
      assert(diagnostics[0] !== undefined, "Expected a diagnostic");
      expect(diagnostics[0].message).toContain("end of input");
    },
  );

  it("recovers past a redundant trailing semicolon after a rejected `use`, without a secondary parsing error", (): void => {
    const { tokens } = tokenize("use foo;; fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });
});

describe("item error recovery", (): void => {
  it("reports an error for a parameter missing its type annotation, and still recovers the function", (): void => {
    const { tokens } = tokenize("fn f(x) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain(":");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
          params: [],
        },
      },
    ]);
  });

  it("reports an error for a parameter missing its name, and still recovers the function", (): void => {
    const { tokens } = tokenize("fn f(: i32) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("identifier");
    expect(diagnostics[0].message).toContain("colon");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
          params: [],
        },
      },
    ]);
  });

  it("drops a malformed leading parameter but keeps a valid trailing one", (): void => {
    const { tokens } = tokenize("fn f(x, y: i32) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [{ kind: "Param", pattern: { name: { text: "y" } } }],
        },
      },
    ]);
  });

  it("drops a malformed middle parameter but keeps valid params on both sides", (): void => {
    const { tokens } = tokenize("fn f(a: i32, x, b: bool) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [
            { pattern: { name: { text: "a" } } },
            { pattern: { name: { text: "b" } } },
          ],
        },
      },
    ]);
  });

  it("drops a malformed trailing parameter but keeps a valid leading one", (): void => {
    const { tokens } = tokenize("fn f(a: i32, x) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [{ pattern: { name: { text: "a" } } }],
        },
      },
    ]);
  });

  it("reports a diagnostic for every malformed parameter when all are malformed", (): void => {
    const { tokens } = tokenize("fn f(x, y, z) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(3);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [],
        },
      },
    ]);
  });

  it("keeps a parameter with a slice-type guardrail fail-fast (not list-recoverable), with exactly one diagnostic", (): void => {
    const { tokens } = tokenize("fn f(x: [i32]) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    expect(diagnostics).toHaveLength(1);
  });

  it("recovers past a leading stray comma in a parameter list", (): void => {
    const { tokens } = tokenize("fn f(, x: i32) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [{ pattern: { name: { text: "x" } } }],
        },
      },
    ]);
  });

  it("does not cascade a second diagnostic when a malformed parameter's garbage contains a comma inside `<...>`", (): void => {
    // `x<A, B>` isn't valid Slice 1 pattern syntax: `x` parses as a binding
    // pattern, then the missing-colon check fails since the next token is
    // `<`, not `:` - a recoverable, non-guardrail error. If the resync scan
    // doesn't track `<`/`>` depth, it stops at the comma between A and B
    // (the first comma it sees) instead of the list's real separator after
    // `>`, then tries to parse "B>, y: i32" as a bogus second element.
    const { tokens } = tokenize("fn f(x<A, B>, y: i32) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          params: [{ pattern: { name: { text: "y" } } }],
        },
      },
    ]);
  });

  it("fails fast without hanging when a parameter list is truncated before EOF with no further item to resync to", (): void => {
    const { tokens } = tokenize("fn f(x: i32, y");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    expect(diagnostics.some((d) => d.message.includes("eof"))).toBe(true);
  });

  it("recovers so a sibling function after a malformed parameter list still parses", (): void => {
    const { tokens } = tokenize("fn f(x) {} fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
          params: [],
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("reports an error for a struct missing its name, recovering via top-level synchronization (there's no field list to recover within)", (): void => {
    const { tokens } = tokenize("struct { x: i32 } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("preserves `pub` visibility when top-level recovery resumes on a `pub`-prefixed sibling item", (): void => {
    const { tokens } = tokenize("struct { x: i32 } pub fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
          visibility: some({ scope: none() }),
        },
      },
    ]);
  });

  it("recovers a missing name on a `pub`-prefixed item itself, not just on a sibling after it", (): void => {
    const { tokens } = tokenize("pub fn 123() {} fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });

  it("recovers a `pub`-prefixed item whose bad name is itself an item-start keyword, without looping forever", (): void => {
    const { tokens } = tokenize("pub fn enum() {} fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });

  it("recovers past two independently malformed top-level items in sequence", (): void => {
    const { tokens } = tokenize(
      "struct { a: i32 } struct { b: bool } fn g() {}",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(2);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("fails fast without hanging when a malformed top-level item has no further item keyword before EOF", (): void => {
    const { tokens } = tokenize("struct { x: i32 }");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("terminates instead of looping forever when the failed item's own leading token is itself an item-start keyword", (): void => {
    const { tokens } = tokenize("fn 123() {} fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });

  it("reports an error for a struct field missing its colon, and still recovers the struct", (): void => {
    const { tokens } = tokenize("struct Foo { x i32 }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain(":");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Foo" }, body: { fields: [] } },
    ]);
  });

  it("reports an error for a struct field missing its type (a Slice 1 type guardrail, so the whole struct stays fail-fast)", (): void => {
    // Same reasoning as the tuple-field "missing type" case above: every
    // parseType failure carries the Slice-1 guardrail phrasing, so it is
    // never eligible for per-element list recovery.
    const { tokens } = tokenize("struct Foo { x: }");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
  });

  it("reports an error for a struct field missing its colon and type, and still recovers the struct", (): void => {
    const { tokens } = tokenize("struct Foo { x }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain(":");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Foo" }, body: { fields: [] } },
    ]);
  });

  it("drops a malformed leading field but keeps a valid trailing one", (): void => {
    const { tokens } = tokenize("struct Foo { x, y: i32 }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        body: { fields: [{ name: { text: "y" } }] },
      },
    ]);
  });

  it("drops a malformed middle field but keeps valid fields on both sides", (): void => {
    const { tokens } = tokenize("struct Foo { a: i32, x, b: bool }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        body: {
          fields: [{ name: { text: "a" } }, { name: { text: "b" } }],
        },
      },
    ]);
  });

  it("reports a diagnostic for every malformed field when all are malformed", (): void => {
    const { tokens } = tokenize("struct Foo { x, y, z }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(3);
    expect(program.value.items).toMatchObject([
      { kind: "Struct", body: { fields: [] } },
    ]);
  });

  it("keeps a field with a slice-type guardrail fail-fast (not list-recoverable), with exactly one diagnostic", (): void => {
    const { tokens } = tokenize("struct Foo { x: [i32] }");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    expect(diagnostics).toHaveLength(1);
  });

  it("recovers so a sibling function after a malformed struct field list still parses", (): void => {
    const { tokens } = tokenize("struct Foo { x } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      { kind: "Struct", body: { fields: [] } },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("reports an error for a tuple field missing its type (a Slice 1 type guardrail, so the whole struct stays fail-fast)", (): void => {
    // Every parseType failure - even a wholly absent type - carries the
    // "not supported in Slice 1" guardrail phrasing (see type.ts's own doc
    // comment), so it is never eligible for per-element list recovery; see
    // isGuardrailDiagnostic in parse-utils.ts.
    const { tokens } = tokenize("struct Foo(:);");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
  });

  it("drops a malformed leading tuple field (bad attribute arg) but keeps a valid trailing one", (): void => {
    const { tokens } = tokenize("struct Foo(#[attr(1.5)] i32, bool);");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        body: { fields: [{ type: { path: { segments: ["bool"] } } }] },
      },
    ]);
  });

  it("drops a malformed middle tuple field (bad attribute arg) but keeps valid fields on both sides", (): void => {
    const { tokens } = tokenize("struct Foo(i32, #[attr(1.5)] bool, str);");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        body: {
          fields: [
            { type: { path: { segments: ["i32"] } } },
            { type: { path: { segments: ["str"] } } },
          ],
        },
      },
    ]);
  });

  it("reports a diagnostic for every malformed tuple field when all have a bad attribute arg", (): void => {
    const { tokens } = tokenize(
      "struct Foo(#[attr(1.5)] i32, #[attr(2.5)] bool);",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(2);
    expect(program.value.items).toMatchObject([
      { kind: "Struct", body: { fields: [] } },
    ]);
  });

  it("recovers so a sibling function after a malformed tuple field list still parses", (): void => {
    const { tokens } = tokenize("struct Foo(#[attr(1.5)] i32); fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    expect(program.value.items).toMatchObject([
      { kind: "Struct", body: { fields: [] } },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });
});

describe("generic parameters: declaration position", (): void => {
  it("parses a single generic type parameter with zero diagnostics (fn foo<T>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "foo" },
          generics: [{ kind: "TypeParam", name: { text: "T" }, bounds: [] }],
          params: [],
        },
      },
    ]);
  });

  it("parses with one generic parameter T used in params and return type (fn first<T>(x: T) -> T)", (): void => {
    const { tokens } = tokenize("fn first<T>(x: T) -> T { x }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "first" },
          generics: [{ kind: "TypeParam", name: { text: "T" }, bounds: [] }],
          params: [
            {
              kind: "Param",
              pattern: { name: { text: "x" } },
              type: { kind: "NamedType", path: { segments: ["T"] } },
            },
          ],
          returnType: some({ kind: "NamedType", path: { segments: ["T"] } }),
        },
      },
    ]);
  });

  it("parses multiple generic type parameters (fn foo<T, U>(x: T) {})", (): void => {
    const { tokens } = tokenize("fn foo<T, U>(x: T) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            { kind: "TypeParam", name: { text: "T" }, bounds: [] },
            { kind: "TypeParam", name: { text: "U" }, bounds: [] },
          ],
          params: [
            {
              kind: "Param",
              pattern: { name: { text: "x" } },
              type: { kind: "NamedType", path: { segments: ["T"] } },
            },
          ],
        },
      },
    ]);
  });

  it("parses an inline trait bound (fn draw_all<T: Draw>(x: T) {})", (): void => {
    const { tokens } = tokenize("fn draw_all<T: Draw>(x: T) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "draw_all" },
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                {
                  kind: "PathTraitBound",
                  path: { segments: ["Draw"] },
                  typeArguments: [],
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("parses multiple bounds joined by + (fn foo<T: A + B>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T: A + B>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                { kind: "PathTraitBound", path: { segments: ["A"] } },
                { kind: "PathTraitBound", path: { segments: ["B"] } },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("parses three bounds joined by + (fn foo<T: A + B + C>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T: A + B + C>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                { kind: "PathTraitBound", path: { segments: ["A"] } },
                { kind: "PathTraitBound", path: { segments: ["B"] } },
                { kind: "PathTraitBound", path: { segments: ["C"] } },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("parses a lifetime as a bound (fn foo<T: 'a>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T: 'a>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                {
                  kind: "LifetimeTraitBound",
                  lifetime: { kind: "Lifetime", name: "a" },
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("parses a bound with its own type argument (fn foo<T: From<U>>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T: From<U>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                {
                  kind: "PathTraitBound",
                  path: { segments: ["From"] },
                  typeArguments: [
                    { kind: "NamedType", path: { segments: ["U"] } },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("splits the trailing >> between a bound's own close and the outer list's close (fn foo<T: Foo<Bar>>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T: Foo<Bar>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                {
                  kind: "PathTraitBound",
                  path: { segments: ["Foo"] },
                  typeArguments: [
                    { kind: "NamedType", path: { segments: ["Bar"] } },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("splits the trailing >> between an empty bound argument list's own close and the outer list's close (fn foo<T: Foo<>>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T: Foo<>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                {
                  kind: "PathTraitBound",
                  path: { segments: ["Foo"] },
                  typeArguments: [],
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("parses a real lifetime-only generics list with zero diagnostics (fn foo<'a>() {})", (): void => {
    const { tokens } = tokenize("fn foo<'a>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "LifetimeParam",
              lifetime: { kind: "Lifetime", name: "a" },
            },
          ],
        },
      },
    ]);
  });

  it("parses multiple lifetime params with zero diagnostics (fn foo<'a, 'b>() {})", (): void => {
    const { tokens } = tokenize("fn foo<'a, 'b>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "LifetimeParam",
              lifetime: { kind: "Lifetime", name: "a" },
            },
            {
              kind: "LifetimeParam",
              lifetime: { kind: "Lifetime", name: "b" },
            },
          ],
        },
      },
    ]);
  });

  it("parses a lifetime-only list with a trailing comma (fn foo<'a,>() {})", (): void => {
    const { tokens } = tokenize("fn foo<'a,>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "LifetimeParam",
              lifetime: { kind: "Lifetime", name: "a" },
            },
          ],
        },
      },
    ]);
  });

  it("parses a lifetime param followed by a type param (fn foo<'a, T>(x: T) {})", (): void => {
    const { tokens } = tokenize("fn foo<'a, T>(x: T) {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "LifetimeParam",
              lifetime: { kind: "Lifetime", name: "a" },
            },
            { kind: "TypeParam", name: { text: "T" }, bounds: [] },
          ],
          params: [
            {
              kind: "Param",
              pattern: { name: { text: "x" } },
              type: { kind: "NamedType", path: { segments: ["T"] } },
            },
          ],
        },
      },
    ]);
  });

  it("parses a type param followed by a lifetime param, the reverse order (fn foo<T, 'a>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T, 'a>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            { kind: "TypeParam", name: { text: "T" }, bounds: [] },
            {
              kind: "LifetimeParam",
              lifetime: { kind: "Lifetime", name: "a" },
            },
          ],
        },
      },
    ]);
  });

  it("parses a real lifetime-only generics list on a struct, leaving an unrelated field type untouched (struct Cursor<'a> { source: T })", (): void => {
    const { tokens } = tokenize("struct Cursor<'a> { source: T }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Cursor" },
        generics: [
          { kind: "LifetimeParam", lifetime: { kind: "Lifetime", name: "a" } },
        ],
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

  it("still parses a sibling function after a lifetime-only generic fn, with zero diagnostics for either", (): void => {
    const { tokens } = tokenize("fn foo<'a>() {} fn bar() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "foo" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "bar" },
        },
      },
    ]);
  });

  it("parses an inline trait bound on a struct's own generic parameter (struct Wrapper<T: Clone> { x: T })", (): void => {
    const { tokens } = tokenize("struct Wrapper<T: Clone> { x: T }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Wrapper" },
        generics: [
          {
            kind: "TypeParam",
            name: { text: "T" },
            bounds: [
              {
                kind: "PathTraitBound",
                path: { segments: ["Clone"] },
                typeArguments: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("parses multiple generic type parameters (struct Pair<A, B> { a: A, b: B })", (): void => {
    const { tokens } = tokenize("struct Pair<A, B> { a: A, b: B }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        generics: [
          { kind: "TypeParam", name: { text: "A" }, bounds: [] },
          { kind: "TypeParam", name: { text: "B" }, bounds: [] },
        ],
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

  it("parses as a generic tuple struct (struct Pair<A, B>(A, B);)", (): void => {
    const { tokens } = tokenize("struct Pair<A, B>(A, B);");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        generics: [
          { kind: "TypeParam", name: { text: "A" }, bounds: [] },
          { kind: "TypeParam", name: { text: "B" }, bounds: [] },
        ],
        body: { kind: "TupleFields" },
      },
    ]);
  });

  it("parses as a generic unit struct (struct Pair<A, B>;)", (): void => {
    const { tokens } = tokenize("struct Pair<A, B>;");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        generics: [
          { kind: "TypeParam", name: { text: "A" }, bounds: [] },
          { kind: "TypeParam", name: { text: "B" }, bounds: [] },
        ],
        body: { kind: "Unit" },
      },
    ]);
  });

  it("recovers so a sibling function after a malformed generic fn still parses", (): void => {
    const { tokens } = tokenize("fn broken<T: >() {} fn ok() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "broken" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "ok" },
        },
      },
    ]);
  });

  it("recovers so a sibling struct after a malformed generic struct still parses", (): void => {
    const { tokens } = tokenize(
      "struct Broken<T: > { x: T } struct Ok { y: i32 }",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Broken" } },
      { kind: "Struct", name: { text: "Ok" } },
    ]);
  });

  it("reports the > token as the diagnostic span for an empty generic parameter list (fn foo<>() {})", (): void => {
    const { tokens } = tokenize("fn foo<>() {}");
    const gt = tokens.find((t) => t.kind === "gt");
    assert(gt !== undefined, "Expected to find a gt token");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].span).toEqual(some(gt.span));
  });

  it("fn foo<T() {} bails out at the ( and still recovers without crashing", (): void => {
    const { tokens } = tokenize("fn foo<T() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("generic parameter list");
  });

  it("fn foo<T (unterminated to EOF) fails fast without hanging", (): void => {
    const { tokens } = tokenize("fn foo<T");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic to come back");
  });

  // biome-ignore lint/security/noSecrets: false positive - generic syntax test string, not a secret
  it("parses a compound bound argument, splitting the doubly-nested closing >>> across all three levels (fn foo<T: Foo<Bar<Baz>>>() {})", (): void => {
    // biome-ignore lint/security/noSecrets: false positive - generic syntax test string, not a secret
    const { tokens } = tokenize("fn foo<T: Foo<Bar<Baz>>>() {}");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [
                {
                  kind: "PathTraitBound",
                  path: { segments: ["Foo"] },
                  typeArguments: [
                    {
                      kind: "NamedType",
                      path: { segments: ["Bar"] },
                      typeArguments: [
                        { kind: "NamedType", path: { segments: ["Baz"] } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          params: [],
        },
      },
    ]);
  });

  it("recovers past a stray extra > merged into the closing >> token (fn foo<T>>() {})", (): void => {
    const { tokens } = tokenize("fn foo<T>>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("extra");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [{ kind: "TypeParam", name: { text: "T" }, bounds: [] }],
          params: [],
        },
      },
    ]);
  });

  it("rejects an empty generic parameter list as a parse error (fn foo<>() {})", (): void => {
    const { tokens } = tokenize("fn foo<>() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("identifier");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [],
          params: [],
        },
      },
    ]);
  });
});

describe("lifetime + reference type interactions", (): void => {
  it("parses cleanly with both a declared generic and a real param type, zero diagnostics (fn foo<'a>(x: &'a i32) {})", (): void => {
    const { tokens } = tokenize("fn foo<'a>(x: &'a i32) {}");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    expect(program).toMatchObject(
      some({
        items: [
          {
            kind: "Function",
            signature: {
              generics: [
                {
                  kind: "LifetimeParam",
                  lifetime: { kind: "Lifetime", name: "a" },
                },
              ],
              params: [
                {
                  type: {
                    kind: "ReferenceType",
                    mutable: false,
                    lifetime: some({ kind: "Lifetime", name: "a" }),
                    referent: {
                      kind: "NamedType",
                      path: { segments: ["i32"] },
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });

  it("parses cleanly via a tuple-struct field, the same interaction as a named field (struct Ref<'a>(&'a i32);)", (): void => {
    const { tokens } = tokenize("struct Ref<'a>(&'a i32);");
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    expect(program).toMatchObject(
      some({
        items: [
          {
            kind: "Struct",
            generics: [
              {
                kind: "LifetimeParam",
                lifetime: { kind: "Lifetime", name: "a" },
              },
            ],
            body: {
              kind: "TupleFields",
              fields: [
                {
                  type: {
                    kind: "ReferenceType",
                    mutable: false,
                    lifetime: some({ kind: "Lifetime", name: "a" }),
                    referent: {
                      kind: "NamedType",
                      path: { segments: ["i32"] },
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
});

describe("lifetime guardrail - nested and reversed-order generics", (): void => {
  it("let x: Vec<Vec<'a>>; now reaches and diagnoses the inner lifetime, since the outer generic actually recurses into it", (): void => {
    const { tokens } = tokenize("let x: Vec<Vec<'a>>;");
    const innerLt = tokens.filter((t) => t.kind === "lt")[1];
    assert(innerLt !== undefined, "Expected to find the inner lt token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].message).not.toContain("Slice 4");
    expect(diagnostics[0].span).toEqual(some(innerLt.span));
  });

  it("let x: Vec<T, 'a>; now diagnoses the lifetime directly, since a non-first argument is reached too (lifetime not listed first)", (): void => {
    const { tokens } = tokenize("let x: Vec<T, 'a>;");
    const lifetime = tokens.find((t) => t.kind === "lifetime");
    assert(lifetime !== undefined, "Expected to find the lifetime token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].message).not.toContain("Slice 4");
    expect(diagnostics[0].span).toEqual(some(lifetime.span));
  });
});

describe("where clauses: function declarations", (): void => {
  it("parses a where clause with zero diagnostics (fn f() where T: Draw {})", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { kind: "NamedType", path: { segments: ["T"] } },
                bounds: [
                  {
                    kind: "PathTraitBound",
                    path: { segments: ["Draw"] },
                    typeArguments: [],
                  },
                ],
              },
            ],
          }),
        },
        body: { statements: [] },
      },
    ]);
  });

  it("parses both the declared generic and the where clause with zero diagnostics (fn f<T>() where T: Draw {})", (): void => {
    const { tokens } = tokenize("fn f<T>() where T: Draw {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          generics: [{ kind: "TypeParam", name: { text: "T" }, bounds: [] }],
          whereClause: some({
            kind: "WhereClause",
            predicates: [{ type: { path: { segments: ["T"] } } }],
          }),
        },
      },
    ]);
  });

  it("parses multiple where-clause predicates (fn f() where T: Draw, U: Clone {})", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw, U: Clone {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { path: { segments: ["T"] } },
                bounds: [{ path: { segments: ["Draw"] } }],
              },
              {
                type: { path: { segments: ["U"] } },
                bounds: [{ path: { segments: ["Clone"] } }],
              },
            ],
          }),
        },
      },
    ]);
  });

  it("parses a single where-predicate with multiple bounds joined by + (fn f() where T: A + B {})", (): void => {
    const { tokens } = tokenize("fn f() where T: A + B {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { path: { segments: ["T"] } },
                bounds: [
                  { kind: "PathTraitBound", path: { segments: ["A"] } },
                  { kind: "PathTraitBound", path: { segments: ["B"] } },
                ],
              },
            ],
          }),
        },
      },
    ]);
  });

  it("parses a where clause with a trailing comma before the body (fn f() where T: Draw, {})", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw, {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          whereClause: some({
            kind: "WhereClause",
            predicates: [{ type: { path: { segments: ["T"] } } }],
          }),
        },
      },
    ]);
  });

  it("parses a lifetime as a where-clause bound (fn f() where T: 'a {})", (): void => {
    const { tokens } = tokenize("fn f() where T: 'a {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { path: { segments: ["T"] } },
                bounds: [
                  {
                    kind: "LifetimeTraitBound",
                    lifetime: { kind: "Lifetime", name: "a" },
                  },
                ],
              },
            ],
          }),
        },
      },
    ]);
  });

  it("parses a where-clause bound with its own type argument (fn f() where T: Foo<Bar> {})", (): void => {
    const { tokens } = tokenize("fn f() where T: Foo<Bar> {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { path: { segments: ["T"] } },
                bounds: [
                  {
                    kind: "PathTraitBound",
                    path: { segments: ["Foo"] },
                    typeArguments: [
                      { kind: "NamedType", path: { segments: ["Bar"] } },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      },
    ]);
  });

  it("rejects a bare lifetime as a where-predicate subject (fn f() where 'a: 'b {})", (): void => {
    const { tokens } = tokenize("fn f() where 'a: 'b {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
          whereClause: none(),
        },
      },
    ]);
  });

  it("recovers past a stray extra > on a where-clause bound's own closing >> (fn f() where T: Foo<Bar>> {})", (): void => {
    const { tokens } = tokenize("fn f() where T: Foo<Bar>> {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(1);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toContain("extra");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                type: { path: { segments: ["T"] } },
                bounds: [
                  {
                    kind: "PathTraitBound",
                    path: { segments: ["Foo"] },
                    typeArguments: [
                      { kind: "NamedType", path: { segments: ["Bar"] } },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      },
    ]);
  });

  it("fn f() where T: Draw (missing body) fails fast without hanging", (): void => {
    const { tokens } = tokenize("fn f() where T: Draw");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic to come back");
  });

  it("recovers so a sibling function after a malformed where clause still parses", (): void => {
    const { tokens } = tokenize("fn f() where T: {} fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("does not steal a sibling function's body when the malformed where clause has no body", (): void => {
    // Regression: without a stop condition on the item's own boundary, the
    // where-clause skip used to scan straight past `fn g()` looking for the
    // first `{` and land on g's body, silently discarding `g` and giving `f`
    // an empty body that was never really there. Missing a body is malformed
    // input either way, so failing fast (not hanging, not corrupting the
    // AST into a single bogus item) is the correct outcome.
    const { tokens } = tokenize("fn f() where T: fn g() {}");
    const { program } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
  });
});

describe("where clauses: struct declarations", (): void => {
  it("parses a where clause with zero diagnostics (struct Pair<T> where T: Bound { x: T })", (): void => {
    const { tokens } = tokenize("struct Pair<T> where T: Bound { x: T }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        generics: [{ kind: "TypeParam", name: { text: "T" }, bounds: [] }],
        whereClause: some({
          kind: "WhereClause",
          predicates: [
            {
              type: { path: { segments: ["T"] } },
              bounds: [{ path: { segments: ["Bound"] } }],
            },
          ],
        }),
        body: {
          kind: "NamedFields",
          fields: [{ kind: "StructField", name: { text: "x" } }],
        },
      },
    ]);
  });

  it("parses as a unit struct with a where clause (struct Pair<T> where T: Bound;)", (): void => {
    // The `;` here is the CORRECT unit-struct terminator, not a malformed-
    // input signal - the struct-specific skip helper must treat `;` as
    // "found the body," unlike the fn-specific one (fn bodies are never `;`).
    const { tokens } = tokenize("struct Pair<T> where T: Bound;");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        whereClause: some({ kind: "WhereClause" }),
        body: { kind: "Unit" },
      },
    ]);
  });

  it("parses as a tuple struct with a where clause (struct Pair<T> where T: Bound(T);)", (): void => {
    const { tokens } = tokenize("struct Pair<T> where T: Bound(T);");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics).toHaveLength(0);
    expect(program.value.items).toMatchObject([
      {
        kind: "Struct",
        name: { text: "Pair" },
        whereClause: some({ kind: "WhereClause" }),
        body: { kind: "TupleFields" },
      },
    ]);
  });

  it("recovers so a sibling struct after a malformed where clause still parses", (): void => {
    const { tokens } = tokenize(
      "struct Pair<T> where T: { x: T } struct Ok { y: i32 }",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(program.value.items).toMatchObject([
      { kind: "Struct", name: { text: "Pair" } },
      { kind: "Struct", name: { text: "Ok" } },
    ]);
  });

  it("does not steal a sibling struct's body when the malformed where clause has no body", (): void => {
    const { tokens } = tokenize("struct Pair<T> where T: struct Ok { y: i32 }");
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
        {
          kind: "Function",
          signature: {
            name: { text: "f" },
          },
          body: { statements: [] },
        },
        {
          kind: "Function",
          signature: {
            name: { text: "g" },
          },
        },
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
        {
          kind: "Function",
          signature: {
            name: { text: "f" },
          },
          body: { statements: [] },
        },
        {
          kind: "Function",
          signature: {
            name: { text: "g" },
          },
        },
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
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("balances real nested braces inside the rejected loop's body", (): void => {
    const { tokens } = tokenize("fn f() { loop { if true { } } } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    expect(isSome(program)).toBe(true);
    expect(diagnostics).toHaveLength(1);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
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
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
    ]);
  });

  it("parses a tuple-struct pattern in a while-let condition (`while let Some(x) = opt {}`)", (): void => {
    // `while let` is real syntax and, as of Slice 3, so is `Some(x)` as a
    // tuple-struct/enum-variant pattern - this previously failed on the
    // unexpected `(` since only binding/wildcard patterns existed yet.
    const { tokens } = tokenize(
      "fn f() { while let Some(x) = opt {} } fn g() {}",
    );
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toHaveLength(0);
    assert(isSome(program), "Expected a program to come back");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        body: {
          statements: [],
          // Nothing follows the while-let inside `fn f() { ... }`, so it
          // lands as the block's trailing expression, not a statement -
          // same convention as a mid-block match with nothing after it.
          trailingExpression: some({
            kind: "WhileExpression",
            condition: {
              kind: "LetExpression",
              pattern: {
                kind: "TupleStructPattern",
                path: { segments: ["Some"] },
                elements: [{ kind: "BindingPattern", name: { text: "x" } }],
              },
            },
          }),
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
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
    // intended body - but the construct is still rejected and the parser
    // still recovers rather than hanging or crashing.
    const { tokens } = tokenize("fn f() { while Foo { x: 1 } { } }");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("while");
  });

  it("recovers even when a malformed condition has a stray closing bracket", (): void => {
    // A stray `]` with no matching `[` must not drive condDepth negative -
    // otherwise the scan can never recognize the real loop body's `{` as
    // being at top-level depth, and misreports "end of input" instead of
    // recovering.
    const { tokens } = tokenize("fn f() { while x] {} } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("while");
    expect(program.value.items).toMatchObject([
      {
        kind: "Function",
        signature: {
          name: { text: "f" },
        },
      },
      {
        kind: "Function",
        signature: {
          name: { text: "g" },
        },
      },
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

describe("trait declarations", (): void => {
  function parseCleanly(source: string): Program {
    const { tokens } = tokenize(source);
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toEqual([]);
    assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
    return program.value;
  }

  it("parses an empty trait declaration", (): void => {
    const ast = parseCleanly("trait Draw {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          name: { text: "Draw" },
          generics: [],
          supertraits: [],
          items: [],
        },
      ],
    });
  });

  it("parses a trait with a required (bodiless) method", (): void => {
    const ast = parseCleanly("trait Draw { fn draw(&self) -> str; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          name: { text: "Draw" },
          items: [
            {
              kind: "FunctionSignature",
              name: { text: "draw" },
              receiver: some({
                kind: "Receiver",
                byRef: true,
                mutable: false,
              }),
            },
          ],
        },
      ],
    });
  });

  it("parses a trait with a default (bodied) method", (): void => {
    const ast = parseCleanly(
      "trait Iterator { fn count(self) -> usize { 0 } }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          name: { text: "Iterator" },
          items: [
            {
              kind: "Function",
              signature: {
                name: { text: "count" },
                receiver: some({
                  kind: "Receiver",
                  byRef: false,
                  mutable: false,
                }),
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a trait mixing a required method, a default method, and an associated type (the spec's own Iterator example)", (): void => {
    const ast = parseCleanly(
      "trait Iterator { type Item; fn next(&mut self) -> Option<Self::Item>; fn count(self) -> usize { 0 } }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          name: { text: "Iterator" },
          items: [
            { kind: "TypeAlias", name: { text: "Item" }, value: none() },
            { kind: "FunctionSignature", name: { text: "next" } },
            { kind: "Function", signature: { name: { text: "count" } } },
          ],
        },
      ],
    });
  });

  it("parses a single supertrait bound", (): void => {
    const ast = parseCleanly("trait Ord: Eq {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          name: { text: "Ord" },
          supertraits: [{ kind: "PathTraitBound", path: { segments: ["Eq"] } }],
        },
      ],
    });
  });

  it("parses a `+`-chained multi-bound supertrait list", (): void => {
    const ast = parseCleanly("trait Foo: A + B {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          supertraits: [
            { kind: "PathTraitBound", path: { segments: ["A"] } },
            { kind: "PathTraitBound", path: { segments: ["B"] } },
          ],
        },
      ],
    });
  });

  it("parses a generic trait declaration", (): void => {
    const ast = parseCleanly("trait Container<T> { fn get(&self) -> T; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          name: { text: "Container" },
          generics: [{ kind: "TypeParam", name: { text: "T" } }],
        },
      ],
    });
  });

  it("parses an associated type declaration with no definition", (): void => {
    const ast = parseCleanly("trait Iterator { type Item; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          items: [{ kind: "TypeAlias", name: { text: "Item" }, value: none() }],
        },
      ],
    });
  });

  it("parses an associated type definition", (): void => {
    const ast = parseCleanly("trait Foo { type Item = i32; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          items: [
            {
              kind: "TypeAlias",
              name: { text: "Item" },
              value: some({ kind: "NamedType", path: { segments: ["i32"] } }),
            },
          ],
        },
      ],
    });
  });

  it("parses an associated const in a trait body", (): void => {
    const ast = parseCleanly("trait Foo { const N: i32 = 1; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Trait",
          items: [{ kind: "Const", name: { text: "N" } }],
        },
      ],
    });
  });

  it("parses `pub trait`", (): void => {
    const ast = parseCleanly("pub trait Draw {}");
    expect(ast).toMatchObject({
      items: [{ kind: "Trait", visibility: some({ kind: "Visibility" }) }],
    });
  });

  it("rejects a trait item that is not a function, associated type, or const", (): void => {
    const { tokens } = tokenize("trait Foo { struct Bar; }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toBe(
      'expected a function, associated type, or const in trait body, found keyword "struct"',
    );
  });

  it("`trait` with no body at EOF fails fast without hanging", (): void => {
    const { tokens } = tokenize("trait");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toBe(
      'Expected an identifier, found "eof" at offset 5',
    );
  });

  it("skips a redundant trailing semicolon after a trait declaration, with no secondary parsing error", (): void => {
    const ast = parseCleanly("trait Draw {}; fn bar() {}");
    expect(ast).toMatchObject({
      items: [
        { kind: "Trait", name: { text: "Draw" } },
        { kind: "Function", signature: { name: { text: "bar" } } },
      ],
    });
  });

  it("recovers so a sibling trait after a malformed generic trait still parses", (): void => {
    const { tokens } = tokenize("trait Broken<T: > {} trait Ok {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      { kind: "Trait", name: { text: "Broken" } },
      { kind: "Trait", name: { text: "Ok" } },
    ]);
  });

  it("recovers so a sibling trait after a malformed where clause still parses", (): void => {
    const { tokens } = tokenize("trait Foo<T> where T: {} trait Ok {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(program.value.items).toMatchObject([
      { kind: "Trait", name: { text: "Foo" } },
      { kind: "Trait", name: { text: "Ok" } },
    ]);
  });

  it("parses a trait declared block-locally inside a function body", (): void => {
    const ast = parseCleanly("fn f() { trait Local {} }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [{ kind: "Trait", name: { text: "Local" } }],
          },
        },
      ],
    });
  });
});

describe("impl declarations", (): void => {
  function parseCleanly(source: string): Program {
    const { tokens } = tokenize(source);
    const { program, diagnostics } = parse(tokens);
    expect(diagnostics).toEqual([]);
    assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
    return program.value;
  }

  it("parses an empty inherent impl", (): void => {
    const ast = parseCleanly("impl Point {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          generics: [],
          traitRef: none(),
          type: { kind: "NamedType", path: { segments: ["Point"] } },
          items: [],
        },
      ],
    });
  });

  it("parses an inherent impl whose target is a reference type, not just a bare path", (): void => {
    const ast = parseCleanly("impl<'a> &'a Foo {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          traitRef: none(),
          type: {
            kind: "ReferenceType",
            mutable: false,
            referent: { kind: "NamedType", path: { segments: ["Foo"] } },
          },
        },
      ],
    });
  });

  it("parses an inherent impl whose target is an array type", (): void => {
    const ast = parseCleanly("impl [i32; 3] {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          traitRef: none(),
          type: {
            kind: "ArrayType",
            elementType: { kind: "NamedType", path: { segments: ["i32"] } },
          },
        },
      ],
    });
  });

  it("still produces the ordinary Slice 1 tuple-type diagnostic for an unsupported impl target, not a confusing path error", (): void => {
    const { tokens } = tokenize("impl (i32, i32) {}");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].message).toBe(
      "tuple types are not supported in Slice 1",
    );
  });

  it("parses an inherent impl with a method", (): void => {
    const ast = parseCleanly("impl Point { fn area(&self) -> i32 { 0 } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          traitRef: none(),
          type: { kind: "NamedType", path: { segments: ["Point"] } },
          items: [
            {
              kind: "Function",
              signature: { name: { text: "area" } },
            },
          ],
        },
      ],
    });
  });

  it("parses a generic inherent impl (the spec's own Pair<T, T> example)", (): void => {
    const ast = parseCleanly("impl<T> Pair<T, T> {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          generics: [{ kind: "TypeParam", name: { text: "T" } }],
          traitRef: none(),
          type: {
            kind: "NamedType",
            path: { segments: ["Pair"] },
            typeArguments: [
              { kind: "NamedType", path: { segments: ["T"] } },
              { kind: "NamedType", path: { segments: ["T"] } },
            ],
          },
        },
      ],
    });
  });

  it("parses a trait impl", (): void => {
    const ast = parseCleanly(
      'impl Draw for Point { fn draw(&self) -> str { "" } }',
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          traitRef: some({
            kind: "TraitRef",
            path: { segments: ["Draw"] },
          }),
          type: { kind: "NamedType", path: { segments: ["Point"] } },
          items: [{ kind: "Function", signature: { name: { text: "draw" } } }],
        },
      ],
    });
  });

  it("parses a blanket impl (`impl<T: A> B for T`)", (): void => {
    const ast = parseCleanly("impl<T: A> B for T {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          generics: [
            {
              kind: "TypeParam",
              name: { text: "T" },
              bounds: [{ kind: "PathTraitBound", path: { segments: ["A"] } }],
            },
          ],
          traitRef: some({ kind: "TraitRef", path: { segments: ["B"] } }),
          type: { kind: "NamedType", path: { segments: ["T"] } },
        },
      ],
    });
  });

  it("parses a blanket impl with a where clause", (): void => {
    const ast = parseCleanly("impl<T> Foo for T where T: Bar {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          traitRef: some({ kind: "TraitRef", path: { segments: ["Foo"] } }),
          type: { kind: "NamedType", path: { segments: ["T"] } },
          whereClause: some({
            kind: "WhereClause",
            predicates: [
              {
                kind: "WherePredicate",
                bounds: [
                  { kind: "PathTraitBound", path: { segments: ["Bar"] } },
                ],
              },
            ],
          }),
        },
      ],
    });
  });

  it("parses an associated const inside an impl body", (): void => {
    const ast = parseCleanly("impl Foo { const N: i32 = 1; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          items: [{ kind: "Const", name: { text: "N" } }],
        },
      ],
    });
  });

  it("rejects a let statement inside an impl body, since Impl's grammar is Item* (declarations only)", (): void => {
    const { tokens } = tokenize("impl Foo { let x = 1; }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toBe(
      "unexpected item kind 'LetStatement' in impl body",
    );
  });

  it("rejects a bare expression statement inside an impl body", (): void => {
    const { tokens } = tokenize("impl Foo { x; }");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toBe(
      "unexpected item kind 'ExpressionStatement' in impl body",
    );
  });

  it("parses an associated type definition inside a trait impl", (): void => {
    const ast = parseCleanly(
      "impl Iterator for Counter { type Item = i32; fn next(&mut self) -> Option<i32> { None } }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          items: [
            {
              kind: "TypeAlias",
              name: { text: "Item" },
              value: some({ kind: "NamedType", path: { segments: ["i32"] } }),
            },
            { kind: "Function", signature: { name: { text: "next" } } },
          ],
        },
      ],
    });
  });

  it("parses a trait and an impl nested inside an impl body (the general Item* body)", (): void => {
    const ast = parseCleanly(
      "impl Foo { trait Nested {} impl Nested for i32 {} }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Impl",
          items: [
            { kind: "Trait", name: { text: "Nested" } },
            { kind: "Impl", traitRef: some({ kind: "TraitRef" }) },
          ],
        },
      ],
    });
  });

  it("rejects `pub impl`", (): void => {
    const { tokens } = tokenize("pub impl Foo {}");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toBe(
      "visibility qualifiers are not allowed on impl blocks",
    );
  });

  it("rejects `pub type`", (): void => {
    const { tokens } = tokenize("pub type Foo = i32;");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toBe(
      "visibility qualifiers are not allowed on a type alias",
    );
  });

  it("`impl` with no body at EOF fails fast without hanging", (): void => {
    const { tokens } = tokenize("impl");
    const { program, diagnostics } = parse(tokens);
    assert(isNone(program), "Expected no program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("skips a redundant trailing semicolon after an impl declaration, with no secondary parsing error", (): void => {
    const ast = parseCleanly("impl Foo {}; fn bar() {}");
    expect(ast).toMatchObject({
      items: [
        { kind: "Impl" },
        { kind: "Function", signature: { name: { text: "bar" } } },
      ],
    });
  });

  it("recovers so a sibling impl after a malformed generic impl still parses", (): void => {
    const { tokens } = tokenize("impl<T: > Broken {} impl Ok {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(program.value.items).toMatchObject([
      { kind: "Impl", type: { path: { segments: ["Broken"] } } },
      { kind: "Impl", type: { path: { segments: ["Ok"] } } },
    ]);
  });

  it("recovers so a sibling impl after a malformed where clause still parses", (): void => {
    const { tokens } = tokenize("impl<T> Foo<T> where T: {} impl Ok {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    assert(diagnostics[0] !== undefined, "Expected a diagnostic");
    expect(program.value.items).toMatchObject([
      { kind: "Impl", type: { path: { segments: ["Foo"] } } },
      { kind: "Impl", type: { path: { segments: ["Ok"] } } },
    ]);
  });

  it("parses an impl declared block-locally inside a function body", (): void => {
    const ast = parseCleanly("fn f() { impl Local {} }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              { kind: "Impl", type: { path: { segments: ["Local"] } } },
            ],
          },
        },
      ],
    });
  });
});
