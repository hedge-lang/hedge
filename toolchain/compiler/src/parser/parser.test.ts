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
