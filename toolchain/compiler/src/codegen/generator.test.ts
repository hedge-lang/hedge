import { describe, expect, it } from "vitest";

import { tokenize } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { generate } from "./generator.js";
import type { Code } from "./output.js";

function gen(source: string): Code {
  return generate(parse(tokenize(source)));
}

describe("generator", (): void => {
  it("generates nothing for an empty program", (): void => {
    expect(gen("")).toEqual({ javascript: "", typedef: "" });
  });

  it("lowers a read-only let to const and `let write` to let", (): void => {
    expect(gen('let greeting = "hi";').javascript).toBe(
      'const greeting = "hi";',
    );
    expect(gen("let write n = 1;").javascript).toBe("let n = 1;");
  });

  it("emits a bare (non-main) function with no entry call", (): void => {
    expect(gen("fn helper() {}").javascript).toBe("function helper() {}");
  });

  it("generates the tracer bullet as runnable JavaScript", (): void => {
    const code = gen(`
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);
    expect(code.typedef).toBe("");
    expect(code.javascript).toBe(
      [
        "#!/usr/bin/env node",
        "",
        "function main() {",
        '  const greeting = "Hello, world!";',
        "  print(greeting);",
        "}",
        "",
        "main();",
      ].join("\n"),
    );
  });

  it("generates libraries without the shebang", () => {
    const code = gen(`
      fn lib() { 0 }
    `);
    expect(code.javascript).toBe(["function lib() {", "  0;", "}"].join("\n"));
  });

  it("generates code with comments", () => {
    const code = gen(`
      //! This is a doc-comment for the main module.

      fn lib() {
        //! This is a doc-comment for the lib function.
      }

      /// This is a doc-comment for the main function.
      fn main() {
        /// This is a doc-comment for the greeting variable.
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);

    expect(code.javascript).toBe(
      [
        "#!/usr/bin/env node",
        "",
        "/**",
        " * @module",
        " * This is a doc-comment for the main module.",
        " */",
        "",
        "/**",
        " * This is a doc-comment for the lib function.",
        " */",
        "function lib() {",
        "}",
        "",
        "/**",
        " * This is a doc-comment for the main function.",
        " */",
        "function main() {",
        '  const greeting = "Hello, world!";',
        "  print(greeting);",
        "}",
        "",
        "main();",
      ].join("\n"),
    );
  });
});
