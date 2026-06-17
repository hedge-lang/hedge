import { describe, expect, it } from "vitest";

import { toJsim } from "../jsim/jsim.js";
import { tokenize } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { isErr } from "../result.js";
import { generate } from "./generator.js";
import type { Code } from "./output.js";

function gen(source: string): Code {
  const result = parse(tokenize(source));
  if (isErr(result)) { throw result.error; }
  return generate(toJsim(result.value));
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

  it("exports a pub fn in JS and declares it in the .d.ts", () => {
    const code = gen("pub fn lib() {}");
    expect(code.javascript).toBe("export function lib() {}");
    expect(code.typedef).toBe("export declare function lib(): void;");
  });

  it("marks pub(package) fn as @internal in the .d.ts", () => {
    const code = gen("pub(package) fn lib() {}");
    expect(code.javascript).toBe("export function lib() {}");
    expect(code.typedef).toBe(
      [
        "/**",
        " * @internal",
        " */",
        "export declare function lib(): void;",
      ].join("\n"),
    );
  });

  it("includes the function doc comment in the .d.ts declaration", () => {
    const code = gen("/// A library function.\npub fn lib() {}");
    expect(code.typedef).toBe(
      [
        "/**",
        " * A library function.",
        " */",
        "export declare function lib(): void;",
      ].join("\n"),
    );
  });

  it("includes the module doc comment in the .d.ts when exports exist", () => {
    const code = gen("//! My module.\npub fn lib() {}");
    expect(code.typedef).toBe(
      [
        "/**",
        " * @module",
        " * My module.",
        " */",
        "",
        "export declare function lib(): void;",
      ].join("\n"),
    );
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
        "  /**",
        "   * This is a doc-comment for the greeting variable.",
        "   */",
        '  const greeting = "Hello, world!";',
        "  print(greeting);",
        "}",
        "",
        "main();",
      ].join("\n"),
    );
  });
});
