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
});
