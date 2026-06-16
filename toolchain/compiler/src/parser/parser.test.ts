import { describe, it, expect } from "vitest";
import { isNone, none, some } from "../option.js";
import { compile } from "../driver.js";
import { parse } from "./parser.js";
import { tokenize } from "../lexer/lexer.js";

describe("parser", (): void => {
  it("parses a string literal", (): void => {
    const tokens = tokenize('"Hello, world!"');
    const ast = parse(tokens);
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
    const tokens = tokenize('let x = "string literal";');
    const ast = parse(tokens);
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
    const tokens = tokenize('print("Hello, world!");');
    const ast = parse(tokens);
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
    const tokens = tokenize("fn main() {}");
    const ast = parse(tokens);
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
    const tokens = tokenize(`
          fn main() {
            let greeting = "Hello, world!";
            print(greeting);
          }
        `);
    const ast = parse(tokens);

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
    const ast = parse(tokenize("foo;"));
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
    const ast = parse(tokenize("std::io::print;"));
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
    const ast = parse(tokenize("::std::io;"));
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
    const ast = parse(tokenize('std::io::print("hi");'));
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

  it("throws on a trailing path separator", (): void => {
    expect(() => parse(tokenize("foo::;"))).toThrow(
      'Expected identifier after "::"',
    );
  });
});

describe("type annotations", (): void => {
  it("parses a named type annotation on a let binding", (): void => {
    const ast = parse(tokenize("let x: i32 = 0;"));
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
    const ast = parse(tokenize("let p: Point;"));
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
    const ast = parse(tokenize("let f: std::io::File;"));
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
    const ast = parse(tokenize("let u: ();"));
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
    const ast = parse(tokenize("let u: () = ();"));
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
    const ast = parse(tokenize("fn add() -> i32 {}"));
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
    const ast = parse(tokenize("fn nothing() -> () {}"));
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
    const ast = parse(tokenize("fn f() {}"));
    expect(ast).toMatchObject({
      items: [{ kind: "Function", returnType: none() }],
    });
  });

  it("throws on an unsupported type syntax", (): void => {
    expect(() => parse(tokenize("let x: & = 1;"))).toThrow(
      'Unsupported type syntax "amp"',
    );
  });
});

describe("type annotation error diagnostics", (): void => {
  it("produces an error diagnostic for a reference type", (): void => {
    const source = "let x: &i32;";
    const ampIdx = tokenize(source).findIndex((t) => t.kind === "amp");
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.tokenId).toBe(ampIdx);
    expect(isNone(result.code)).toBe(true);
  });

  it("produces an error diagnostic for an exclusive reference type", (): void => {
    const source = "let x: &write i32;";
    const ampIdx = tokenize(source).findIndex((t) => t.kind === "amp");
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.tokenId).toBe(ampIdx);
  });

  it("produces an error diagnostic for a slice type", (): void => {
    const source = "let xs: [i32];";
    const lbracketIdx = tokenize(source).findIndex((t) => t.kind === "lbracket");
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.tokenId).toBe(lbracketIdx);
  });

  it("produces an error diagnostic for the never type", (): void => {
    const source = "fn f() -> ! {}";
    const bangIdx = tokenize(source).findIndex((t) => t.kind === "bang");
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.tokenId).toBe(bangIdx);
  });
});

// Blocked by #11 (struct item parsing)
describe("struct field type annotations", (): void => {
  it.todo("parses a primitive type annotation on a struct field");
  it.todo("parses a qualified named type annotation on a struct field");
  it.todo("parses a unit type annotation on a struct field");
});

describe("attributes on let statements", (): void => {
  it("attaches an outer attribute to a top-level let", (): void => {
    const tokens = tokenize("#[attr] let x = 1;");
    const ast = parse(tokens);
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
    const tokens = tokenize("fn f() { /// Counter\nlet x = 1; }");
    const ast = parse(tokens);
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
