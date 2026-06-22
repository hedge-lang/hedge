import { describe, expect, it } from "vitest";

import { toJsim } from "../jsim/jsim.js";
import { tokenize } from "../lexer/lexer.js";
import { isSome, none } from "../option.js";
import { parse } from "../parser/parser.js";
import { generate } from "./generator.js";
import type { Code } from "./output.js";

function gen(source: string): Code {
  const { program, diagnostics } = parse(tokenize(source).tokens);
  if (isSome(program)) {
    return generate(toJsim(program.value));
  }
  throw new Error(diagnostics[0]?.message ?? "Parse failed");
}

function js(code: Code): string | null {
  return isSome(code.javascript) ? code.javascript.value : null;
}

function dts(code: Code): string | null {
  return isSome(code.typedef) ? code.typedef.value : null;
}

describe("generator", (): void => {
  it("generates nothing for an empty program", (): void => {
    expect(gen("")).toEqual({ javascript: none(), typedef: none() });
  });

  it("lowers a read-only let to const and `let write` to let", (): void => {
    expect(js(gen('let greeting = "hi";'))).toBe('const greeting = "hi";\n');
    expect(js(gen("let write n = 1;"))).toBe("let n = 1;\n");
    expect(js(gen("let b_true = true;"))).toBe("const b_true = true;\n");
  });

  it("emits a bare (non-main) function with no entry call", (): void => {
    expect(js(gen("fn helper() {}"))).toBe("function helper() {}\n");
  });

  it("generates the tracer bullet as runnable JavaScript", (): void => {
    const code = gen(`
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);
    expect(code.typedef).toEqual(none());
    expect(js(code)).toBe(
      [
        "#!/usr/bin/env node",
        "",
        "function main() {",
        '  const greeting = "Hello, world!";',
        "  print(greeting);",
        "}",
        "",
        "main();",
        "",
      ].join("\n"),
    );
  });

  it("generates libraries without the shebang", () => {
    const code = gen(`
      fn lib() { 0 }
    `);
    expect(js(code)).toBe(["function lib() {", "  0;", "}", ""].join("\n"));
  });

  it("exports a pub fn in JS and declares it in the .d.ts", () => {
    const code = gen("pub fn lib() {}");
    expect(js(code)).toBe("export function lib() {}\n");
    expect(dts(code)).toBe("export declare function lib(): void;\n");
  });

  it("marks pub(package) fn as @internal in the .d.ts", () => {
    const code = gen("pub(package) fn lib() {}");
    expect(js(code)).toBe("export function lib() {}\n");
    expect(dts(code)).toBe(
      [
        "/**",
        " * @internal",
        " */",
        "export declare function lib(): void;",
        "",
      ].join("\n"),
    );
  });

  it("includes the function doc comment in the .d.ts declaration", () => {
    const code = gen("/// A library function.\npub fn lib() {}");
    expect(js(code)).toBe("export function lib() {}\n");
    expect(dts(code)).toBe(
      [
        "/**",
        " * A library function.",
        " */",
        "export declare function lib(): void;",
        "",
      ].join("\n"),
    );
  });

  it("includes the module doc comment in the .d.ts when exports exist", () => {
    const code = gen("//! My module.\npub fn lib() {}");
    expect(js(code)).toBe("export function lib() {}\n");
    expect(dts(code)).toBe(
      [
        "/**",
        " * @module",
        " * My module.",
        " */",
        "",
        "export declare function lib(): void;",
        "",
      ].join("\n"),
    );
  });

  it("emits function parameters in JS output", (): void => {
    expect(js(gen("fn f(x: i32, y: bool) {}"))).toBe("function f(x, y) {}\n");
  });

  it("emits param types in .d.ts for pub fn", (): void => {
    expect(dts(gen("pub fn add(x: i32, y: i32) -> i32 {}"))).toBe(
      "export declare function add(x: number, y: number): number;\n",
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

    expect(js(code)).toBe(
      [
        "#!/usr/bin/env node",
        "",
        "function lib() {}",
        "",
        "function main() {",
        '  const greeting = "Hello, world!";',
        "  print(greeting);",
        "}",
        "",
        "main();",
        "",
      ].join("\n"),
    );
    expect(dts(code)).toBe(
      [
        "/**",
        " * @module",
        " * This is a doc-comment for the main module.",
        " */",
        "",
      ].join("\n"),
    );
  });
});
