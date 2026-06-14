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
            kind: "StringLiteral",
            value: "string literal",
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
          returnType: null,
          whereClause: null,
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
                  kind: "StringLiteral",
                  value: "Hello, world!",
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
            trailingExpression: null,
          },
        },
      ],
    });
  });
});

describe("attributes", (): void => {
  it("parses a marker attribute on a function (no argument list)", (): void => {
    const tokens = tokenize("#[test] fn f() {}");
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [
            {
              kind: "Attribute",
              name: { absolute: false, segments: ["test"] },
              arguments: { kind: "None" },
            },
          ],
        },
      ],
    });
  });

  it("parses path arguments with a trailing comma", (): void => {
    const tokens = tokenize("#[derive(Clone, Debug,)] fn f() {}");
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [
            {
              kind: "Attribute",
              name: { segments: ["derive"] },
              arguments: {
                kind: "Some",
                value: [
                  { kind: "Path", path: { segments: ["Clone"] } },
                  { kind: "Path", path: { segments: ["Debug"] } },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("distinguishes an empty argument list from none", (): void => {
    const tokens = tokenize("#[derive()] fn f() {}");
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [{ arguments: { kind: "Some", value: [] } }],
        },
      ],
    });
  });

  it("parses a key-value argument", (): void => {
    const tokens = tokenize('#[cfg(target = "wasm")] fn f() {}');
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [
            {
              name: { segments: ["cfg"] },
              arguments: {
                kind: "Some",
                value: [
                  {
                    kind: "KeyValue",
                    path: { segments: ["target"] },
                    literal: { kind: "StringLiteral", value: "wasm" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("lowers a doc comment into a doc attribute", (): void => {
    const tokens = tokenize("/// Greeting\nfn f() {}");
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          attributes: [
            {
              name: { segments: ["doc"] },
              arguments: {
                kind: "Some",
                value: [
                  {
                    kind: "Literal",
                    literal: { kind: "StringLiteral", value: "Greeting" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("attaches an attribute to a top-level let statement", (): void => {
    const tokens = tokenize("#[attr] let x = 1;");
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          attributes: [{ name: { segments: ["attr"] } }],
        },
      ],
    });
  });

  it("attaches an attribute to a let statement inside a block", (): void => {
    const tokens = tokenize("fn f() { #[attr] let x = 1; }");
    const ast = parse(tokens);
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "LetStatement",
                attributes: [{ name: { segments: ["attr"] } }],
              },
            ],
          },
        },
      ],
    });
  });

  it("rejects an attribute with no path", (): void => {
    expect(() => parse(tokenize("#[] fn f() {}"))).toThrow(SyntaxError);
  });

  it("rejects an attribute on a bare expression", (): void => {
    expect(() => parse(tokenize("#[attr] foo();"))).toThrow(SyntaxError);
  });
});
