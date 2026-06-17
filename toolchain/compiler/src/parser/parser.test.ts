import { describe, it, expect } from "vitest";
import { isNone, none, some } from "../option.js";
import { compile } from "../driver.js";
import { parse } from "./parser.js";
import { isErr } from "../result.js";
import { tokenize } from "../lexer/lexer.js";
import type { Program } from "./ast.js";

function parseProgram(source: string): Program {
  const { tokens } = tokenize(source);
  const result = parse(tokens);
  if (isErr(result)) {
    throw new Error(result.error.message, { cause: result.error });
  }
  return result.value;
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
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Expected identifier after "::"');
    }
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
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("Slice 2");
    }
  });
});

describe("type annotation error diagnostics", (): void => {
  it("produces an error diagnostic for a reference type", (): void => {
    const source = "let x: &i32;";
    const amp = tokenize(source).tokens.find((t) => t.kind === "amp");
    if (!amp) {
      expect(amp).toBeDefined(); // fail the test if the amp token isn't found
      return;
    }
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(amp.span));
    expect(isNone(result.code)).toBe(true);
  });

  it("produces an error diagnostic for an exclusive reference type", (): void => {
    const source = "let x: &write i32;";
    const amp = tokenize(source).tokens.find((t) => t.kind === "amp");
    if (!amp) {
      expect(amp).toBeDefined(); // fail the test if the amp token isn't found
      return;
    }
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Slice 2");
    expect(result.diagnostics[0]?.span).toEqual(some(amp.span));
  });

  it("produces an error diagnostic for a slice type", (): void => {
    const source = "let xs: [i32];";
    const lbracket = tokenize(source).tokens.find((t) => t.kind === "lbracket");
    if (!lbracket) {
      expect(lbracket).toBeDefined(); // fail the test if the lbracket token isn't found
      return;
    }
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.span).toEqual(some(lbracket.span));
  });

  it("produces an error diagnostic for the never type", (): void => {
    const source = "fn f() -> ! {}";
    const bang = tokenize(source).tokens.find((t) => t.kind === "bang");
    if (!bang) {
      expect(bang).toBeDefined(); // fail the test if the bang token isn't found
      return;
    }
    const result = compile(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.span).toEqual(some(bang.span));
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

describe("attribute parsing guardrails", (): void => {
  it("returns an error for an attribute arg that is neither string nor path", (): void => {
    const result = parse(tokenize("#[attr(42)] fn f() {}").tokens);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("Expected attribute argument");
    }
  });

  it("returns an error when an attribute argument list is not closed", (): void => {
    const result = parse(tokenize("#[attr(").tokens);
    expect(isErr(result)).toBe(true);
  });

  it("returns an error when `]` is missing after attribute arguments", (): void => {
    const result = parse(tokenize("#[attr(x) fn f() {}").tokens);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("rbracket");
    }
  });
});

describe("tuple type guardrail", (): void => {
  it("returns an error for a parenthesized non-unit type", (): void => {
    const result = parse(tokenize("let x: (i32);").tokens);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("tuple types are not supported");
    }
  });

  it("still parses the unit type `()` successfully", (): void => {
    const ast = parseProgram("let x: ();");
    expect(ast).toMatchObject({
      items: [{ kind: "LetStatement", type: some({ kind: "UnitType" }) }],
    });
  });
});
