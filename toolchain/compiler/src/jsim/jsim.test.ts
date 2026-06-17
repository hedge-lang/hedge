import { describe, it, expect } from "vitest";
import { none } from "../option.js";
import { type Program } from "../parser/ast.js";
import { toJsim } from "./jsim.js";
import { tokenize } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { isErr } from "../result.js";

function parseOrThrow(source: string): Program {
  const result = parse(tokenize(source).tokens);
  if (isErr(result)) {
    throw result.error;
  }
  return result.value;
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
});
