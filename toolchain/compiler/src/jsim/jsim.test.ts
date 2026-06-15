import { describe, it, expect } from "vitest";
import { none } from "../option.js";
import { toJsim } from "./jsim.js";
import { tokenize } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";

describe("toJsim", () => {
  it("parses functions to the JSIM Function representation", () => {
    const program = toJsim(
      parse(
        tokenize(`
                fn test_fn() {
                    // Empty on purpose
                }
            `),
      ),
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
