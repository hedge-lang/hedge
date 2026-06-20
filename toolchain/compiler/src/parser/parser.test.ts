import { describe, it, expect } from "vitest";
import { isSome, none, some } from "../option.js";
import { compile } from "../driver.js";
import { parse } from "./parser.js";
import { tokenize } from "../lexer/lexer.js";
import { HARD_KEYWORDS } from "../lexer/keywords.js";
import type { Program } from "./ast.js";

function parseProgram(source: string): Program {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  if (isSome(program)) {
    return program.value;
  }
  throw new Error(diagnostics[0]?.message ?? "Parse failed");
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
          bind: false,
          write: false,
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
                bind: false,
                write: false,
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

  // TODO(#16): unit expression `()` is not yet parseable; unblock when #16 lands
  it.todo("parses a unit-typed let with a unit initializer", (): void => {
    const ast = parseProgram("let u: () = ();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({ kind: "UnitType" }),
          initializer: some({ kind: "UnitExpression" }),
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
    expect(amp).toBeDefined();
    if (!amp) return;
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(amp.span));
  });

  it("produces an error diagnostic for an exclusive reference type", (): void => {
    const { tokens } = tokenize("let x: &write i32;");
    const amp = tokens.find((t) => t.kind === "amp");
    expect(amp).toBeDefined();
    if (!amp) return;
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(amp.span));
  });

  it("produces an error diagnostic for a slice type", (): void => {
    const { tokens } = tokenize("let xs: [i32];");
    const lbracket = tokens.find((t) => t.kind === "lbracket");
    expect(lbracket).toBeDefined();
    if (!lbracket) return;
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("[T]");
    expect(result.diagnostics[0]?.span).toEqual(some(lbracket.span));
  });

  it("produces an error diagnostic for the never type", (): void => {
    const { tokens } = tokenize("fn f() -> ! {}");
    const bang = tokens.find((t) => t.kind === "bang");
    expect(bang).toBeDefined();
    if (!bang) return;
    const result = parse(tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("!");
    expect(result.diagnostics[0]?.span).toEqual(some(bang.span));
  });
});

// TODO(#11, #13): Fill in these tests when struct definitions and field syntax are supported
describe.todo("struct field type annotations", (): void => {
  it("parses a primitive type annotation on a struct field", () => {
    const source = "struct Foo { field: u32 }";
    const ast = parseProgram(source);
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
          fields: [
            {
              name: { kind: "Identifier", text: "field" },
              type: {
                kind: "NamedType",
                text: "u32",
              },
            },
          ],
        },
      ],
    });
  });
  it("rejects a tuple type annotation on a struct field", () => {
    const result = compile("struct Foo { field: (i32) }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain(
      "tuple types are not supported",
    );
  });
  it("parses a qualified named type annotation on a struct field", () => {
    const source = "struct Foo { field: std::io::File }";
    const ast = parseProgram(source);
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
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
      ],
    });
  });

  it("parses a unit type annotation on a struct field", () => {
    const source = "struct Foo { field: () }";
    const ast = parseProgram(source);
    expect(ast).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "Struct",
          name: { kind: "Identifier", text: "Foo" },
          fields: [
            {
              name: { kind: "Identifier", text: "field" },
              type: { kind: "UnitType" },
            },
          ],
        },
      ],
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
    expect(result.diagnostics[0]?.message).toContain("Expected attribute argument");
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
        if (isSome(result.program))
          throw new Error(`expected parse("fn ${kw}() {}") to fail`);
        expect(result.diagnostics[0]?.message).toContain(kw);
      },
    );

    it.each(ALL_HARD_KEYWORDS)(
      "rejects hard keyword %s as a let binding name with a diagnostic naming the keyword",
      (kw) => {
        const result = parse(tokenize(`let ${kw} = 1;`).tokens);
        if (isSome(result.program))
          throw new Error(`expected parse("let ${kw} = 1;") to fail`);
        expect(result.diagnostics[0]?.message).toContain(kw);
      },
    );
  });

  describe("reserved keyword diagnostics", (): void => {
    it("rejects mut in let binding position with a hint about write", (): void => {
      const result = parse(tokenize("let mut = 1;").tokens);
      expect(result.program).toEqual(none());
      expect(result.diagnostics[0]?.message).toContain("write");
    });

    it("rejects mut as a function name with a hint about write", (): void => {
      const result = parse(tokenize("fn mut() {}").tokens);
      expect(result.program).toEqual(none());
      expect(result.diagnostics[0]?.message).toContain("write");
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
      if (!isSome(result.program)) {
        throw new Error("expected program");
      }
      const stmt = result.program.value.items[0];
      if (stmt?.kind !== "LetStatement")
        throw new Error("expected LetStatement");
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
      if (!isSome(program))
        throw new Error(diagnostics[0]?.message ?? "Parse failed");
      const stmt = program.value.items[0];
      if (stmt?.kind !== "LetStatement") {
        throw new Error("expected LetStatement");
      }
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
      if (!isSome(program))
        throw new Error(diagnostics[0]?.message ?? "Parse failed");
      const fn_ = program.value.items[0];
      if (fn_?.kind !== "Function") {
        throw new Error("expected Function");
      }
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
      if (!isSome(program))
        throw new Error(diagnostics[0]?.message ?? "Parse failed");
      const expr = program.value.items[0];
      if (expr?.kind !== "ExpressionStatement")
        throw new Error("expected ExpressionStatement");
      const path = expr.expression;
      if (path.kind !== "PathExpression")
        throw new Error("expected PathExpression");
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

  it("parses an exclusive reference &write counter", (): void => {
    const ast = parseProgram("&write counter;");
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

  it("rejects &mut x with the mut→write hint", (): void => {
    const result = parse(tokenize("&mut x;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("write");
  });
});

describe("let binding modifiers", (): void => {
  it("parses let bind x = 1", (): void => {
    const ast = parseProgram("let bind x = 1;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", bind: true, write: false }],
    });
  });

  it("parses let write x = 1", (): void => {
    const ast = parseProgram("let write x = 1;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", bind: false, write: true }],
    });
  });

  it("parses let bind write x = 1", (): void => {
    const ast = parseProgram("let bind write x = 1;");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", bind: true, write: true }],
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

  it("foo::mut gives the mut hint about write/bind, not a generic keyword error", (): void => {
    const result = parse(tokenize("foo::mut;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("write");
    expect(result.diagnostics[0]?.message).toContain("mut");
  });
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
    const result = parse(tokenize("let x: 'a;").tokens);
    expect(result.program).toEqual(none());
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
