import { describe, it, expect } from "vitest";
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
          type: null,
          initializer: {
            kind: "Some",
            value: {
              kind: "StringLiteral",
              value: "string literal",
            },
          },
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
          returnType: { kind: "None" },
          whereClause: { kind: "None" },
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
                type: null,
                initializer: {
                  kind: "Some",
                  value: {
                    kind: "StringLiteral",
                    value: "Hello, world!",
                  },
                },
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
            trailingExpression: { kind: "None" },
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
          expression: { kind: "PathExpression", path: { absolute: false, segments: ["foo"] } },
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
    expect(() => parse(tokenize("foo::;"))).toThrow('Expected identifier after "::"');
  });
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
                    arguments: {
                      kind: "Some",
                      value: [
                        {
                          literal: {
                            kind: "Some",
                            value: { value: "Counter" },
                          },
                        },
                      ],
                    },
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
