import { describe, it, expect } from "vitest";
import { isSome, none } from "../option.js";
import { type Program } from "../parser/ast.js";
import { toJsim } from "./jsim.js";
import { tokenize } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
function parseOrThrow(source: string): Program {
  const { program, diagnostics } = parse(tokenize(source).tokens);
  if (isSome(program)) {
    return program.value;
  }
  throw new Error(diagnostics[0]?.message ?? "Parse failed");
}

describe("toJsim", () => {
  it("parses functions to the JSIM Function representation", () => {
    const program = toJsim(
      parseOrThrow(`
                fn test_fn() {
                    // Empty on purpose
                }
            `),
    );
    expect(program).toMatchObject({
      kind: "Program",
      items: [
        {
          kind: "FunctionDecl",
          name: "test_fn",
          params: [],
          returnType: none(),
          body: [],
        },
      ],
    });
  });

  it("maps function params with known primitive types to FunctionParam nodes", () => {
    const program = toJsim(parseOrThrow("fn f(x: i32, b: bool) {}"));
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: { kind: "PrimitiveType", value: "number" },
            },
            {
              kind: "FunctionParam",
              name: "b",
              type: { kind: "PrimitiveType", value: "boolean" },
            },
          ],
        },
      ],
    });
  });

  it("maps a function return type to a JSIM PrimitiveType", () => {
    const program = toJsim(parseOrThrow("fn f() -> bool {}"));
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          returnType: { value: { kind: "PrimitiveType", value: "boolean" } },
        },
      ],
    });
  });

  it("maps an i64 param to bigint", () => {
    const program = toJsim(parseOrThrow("fn f(x: i64) {}"));
    expect(program).toMatchObject({
      items: [
        {
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: { kind: "PrimitiveType", value: "bigint" },
            },
          ],
        },
      ],
    });
  });

  it("maps a unit return type to none()", () => {
    const program = toJsim(parseOrThrow("fn f() -> () {}"));
    expect(program).toMatchObject({
      items: [{ kind: "FunctionDecl", returnType: none() }],
    });
  });

  it("struct declaration produces no JSIM items", () => {
    const program = toJsim(parseOrThrow("struct Foo;"));
    expect(program.items).toEqual([]);
  });
});
