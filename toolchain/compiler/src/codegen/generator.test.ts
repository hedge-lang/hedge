import { describe, expect, it } from "vitest";
import { assert } from "../assert.js";

import { toJsim } from "../jsim/jsim.js";
import { tokenize } from "../lexer/lexer.js";
import { isSome, none } from "../option.js";
import { parse } from "../parser/parser.js";
import { generate } from "./generator.js";
import type { Code } from "./output.js";

function gen(source: string): Code {
  const { program, diagnostics } = parse(tokenize(source).tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return generate(toJsim(program.value));
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

describe("binary expression codegen", () => {
  it.each([
    ["Add", "x + y", "x + y"],
    ["Sub", "x - y", "x - y"],
    ["Mul", "x * y", "x * y"],
    ["Div", "x / y", "x / y"],
    ["Rem", "x % y", "x % y"],
    ["Shl", "x << y", "x << y"],
    ["Shr", "x >> y", "x >> y"],
    ["BitAnd", "x & y", "x & y"],
    ["BitXor", "x ^ y", "x ^ y"],
    ["BitOr", "x | y", "x | y"],
    ["Eq", "x == y", "x === y"],
    ["Ne", "x != y", "x !== y"],
    ["Lt", "x < y", "x < y"],
    ["Gt", "x > y", "x > y"],
    ["Le", "x <= y", "x <= y"],
    ["Ge", "x >= y", "x >= y"],
    ["And", "x && y", "x && y"],
    ["Or", "x || y", "x || y"],
  ])("%s emits correct JS operator", (_, source, expected) => {
    expect(js(gen(source))).toBe(`${expected};\n`);
  });

  it("(x + y) * z — parens preserved because + binds looser than *", () => {
    expect(js(gen("(x + y) * z"))).toBe("(x + y) * z;\n");
  });

  it("x + y * z — no parens needed, * binds tighter", () => {
    expect(js(gen("x + y * z"))).toBe("x + y * z;\n");
  });

  it("x - (y - z) — right-side same-precedence op is parenthesised", () => {
    expect(js(gen("x - (y - z)"))).toBe("x - (y - z);\n");
  });

  it("x || y && z — && binds tighter than ||, no parens needed", () => {
    expect(js(gen("x || y && z"))).toBe("x || y && z;\n");
  });
});

describe("unary expression codegen", () => {
  it.each([
    ["Neg", "-x", "(-x)"],
    ["Not", "!x", "(!x)"],
  ])("%s emits correct JS operator", (_, source, expected) => {
    expect(js(gen(source))).toBe(`${expected};\n`);
  });
});

describe("assign expression codegen", () => {
  it.each([
    ["Assign", "x = 1;", "x = 1"],
    ["AddAssign", "x += 1;", "x += 1"],
    ["SubAssign", "x -= 1;", "x -= 1"],
    ["MulAssign", "x *= 1;", "x *= 1"],
    ["DivAssign", "x /= 1;", "x /= 1"],
    ["RemAssign", "x %= 1;", "x %= 1"],
    ["BitAndAssign", "x &= 1;", "x &= 1"],
    ["BitOrAssign", "x |= 1;", "x |= 1"],
    ["BitXorAssign", "x ^= 1;", "x ^= 1"],
    ["ShlAssign", "x <<= 1;", "x <<= 1"],
    ["ShrAssign", "x >>= 1;", "x >>= 1"],
  ])("%s emits correct JS operator", (_, source, expected) => {
    expect(js(gen(source))).toBe(`${expected};\n`);
  });
});

describe("field access expression codegen", () => {
  it("emits object.field", () => {
    expect(js(gen("foo.bar;"))).toBe("foo.bar;\n");
  });
});

describe("no-init let codegen", () => {
  it("immutable let with no initializer is omitted from output", () => {
    expect(js(gen("let x;"))).toBeNull();
  });

  it("mutable let with no initializer emits let x;", () => {
    expect(js(gen("let write x;"))).toBe("let x;\n");
  });
});

describe("method call expression codegen", () => {
  it("no-arg method call", () => {
    expect(js(gen("a.method()"))).toBe("a.method();\n");
  });
  it("method call with arguments", () => {
    expect(js(gen("a.method(b, c)"))).toBe("a.method(b, c);\n");
  });
  it("method call with arguments and trailing comma", () => {
    expect(js(gen("a.method(b, c, )"))).toBe("a.method(b, c);\n");
  });
  it("chained method calls", () => {
    expect(js(gen("a.foo().bar()"))).toBe("a.foo().bar();\n");
  });
});

describe("index expression codegen", () => {
  it("a[0] emits a[0]", () => {
    expect(js(gen("a[0]"))).toBe("a[0];\n");
  });
  it("a[b + c] emits a[b + c]", () => {
    expect(js(gen("a[b + c]"))).toBe("a[b + c];\n");
  });
  it("a[b][c] chains left-to-right", () => {
    expect(js(gen("a[b][c]"))).toBe("a[b][c];\n");
  });
  it("a[b[c]] nests properly", () => {
    expect(js(gen("a[b[c]]"))).toBe("a[b[c]];\n");
  });
});

describe("tuple expression codegen", () => {
  it("() lowers to [] (unit)", () => {
    expect(js(gen("()"))).toBe("[];\n");
  });
  it("(1,) lowers to [1]", () => {
    expect(js(gen("(1,)"))).toBe("[1];\n");
  });
  it("(1, 2) lowers to [1, 2]", () => {
    expect(js(gen("(1, 2)"))).toBe("[1, 2];\n");
  });
  it("(1) is transparent grouping, not a tuple", () => {
    expect(js(gen("(1)"))).toBe("1;\n");
  });
});

describe("block expression codegen", () => {
  it("empty block emits nothing", () => {
    expect(js(gen("{ }"))).toBe("\n");
  });
  it("block without trailing expressions creates a block", () => {
    expect(js(gen("{ 1; }"))).toBe("{ 1; }\n");
  });
  it("block with trailing expression returns that value", () => {
    expect(js(gen("{ 1 }"))).toBe(
      ["(() => {", "  return 1;", "})();", ""].join("\n"),
    );
  });
  it("block with statements and trailing expression", () => {
    expect(js(gen("{ let x = 1; x }"))).toBe(
      ["(() => {", "  const x = 1;", "  return x;", "})();", ""].join("\n"),
    );
  });
  it("block as let initializer", () => {
    expect(js(gen("let result = { 1 + 2 };"))).toBe(
      ["const result = (() => {", "  return 1 + 2;", "})();", ""].join("\n"),
    );
  });
});

describe("if expression codegen", () => {
  it("if without else wraps in IIFE", () => {
    expect(js(gen("if cond { foo }"))).toBe(
      ["(() => {", "  if (cond) {", "    return foo;", "  }", "})();", ""].join(
        "\n",
      ),
    );
  });
  it("if-else emits both branches", () => {
    expect(js(gen("if cond { a } else { b }"))).toBe(
      [
        "(() => {",
        "  if (cond) {",
        "    return a;",
        "  } else {",
        "    return b;",
        "  }",
        "})();",
        "",
      ].join("\n"),
    );
  });
  it("else-if chain emits inline else if", () => {
    expect(js(gen("if a { 1 } else if b { 2 }"))).toBe(
      [
        "(() => {",
        "  if (a) {",
        "    return 1;",
        "  } else if (b) {",
        "    return 2;",
        "  }",
        "})();",
        "",
      ].join("\n"),
    );
  });
  it("empty branches emit empty blocks", () => {
    expect(js(gen("if cond { } else { }"))).toBe(
      ["if (cond) {} else {}", ""].join("\n"),
    );
  });
  it("branches without return values don't use IIFE", () => {
    expect(js(gen("if cond { 2; } else { 1; }"))).toBe(
      "if (cond) { 2; } else { 1; }\n",
    );
  });
});

describe("struct expression codegen", () => {
  it("empty struct emits ({})", () => {
    expect(js(gen("Foo {}"))).toBe("({});\n");
  });
  it("named fields emit object literal", () => {
    expect(js(gen("Foo { x: 1, y: 2 }"))).toBe("({x: 1, y: 2});\n");
  });
  it("shorthand fields emit ES6 shorthand", () => {
    expect(js(gen("Foo { x }"))).toBe("({x});\n");
  });
  it("struct update spread emits spread-first object literal", () => {
    expect(js(gen("Foo { x: 1, ..base }"))).toBe("({...base, x: 1});\n");
  });
  it("structs with multiple spreads use them all", () => {
    expect(js(gen("Foo { x: 1, ..base1, ..base2 }"))).toBe(
      "({ ...base2, ...base1, x: 1 });\n",
    );
  });
});
