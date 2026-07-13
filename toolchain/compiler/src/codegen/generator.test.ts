import { describe, expect, it } from "vitest";
import { assert } from "../assert.js";

import { toJsim } from "../jsim/jsim.js";
import { analyzeOwnership } from "../ownership/move-check.js";
import { isSome, none } from "../option.js";
import { analyzeSource } from "../testing/analyze-source.js";
import { jsimSource } from "../testing/jsim-source.js";
import { generate } from "./generator.js";
import type { Code } from "./output.js";

function gen(source: string): Code {
  return generate(jsimSource(source));
}

/**
 * Like `gen`, but also runs ownership analysis and threads its
 * per-function drop info through, for fixtures that need real
 * `using`/dispose codegen.
 */
function genWithOwnership(source: string): Code {
  const { program, tokens } = analyzeSource(source);
  const ownership = analyzeOwnership(program, tokens);
  assert(
    ownership.diagnostics.every((d) => d.severity !== "error"),
    ownership.diagnostics.map((d) => d.message).join("; "),
  );
  return generate(toJsim(program, tokens, ownership.functions));
}

function js(code: Code): string | null {
  return isSome(code.javascript) ? code.javascript.value : null;
}

function dts(code: Code): string | null {
  return isSome(code.typedef) ? code.typedef.value : null;
}

/**
 * Extracts body statements from a single `function _()` wrapper,
 * stripping one indent level.
 */
function stmts(code: Code): string | null {
  const output = js(code);
  if (output === null) return null;
  if (/^function _\([^)]*\) \{}\n$/.test(output)) return "";
  const match = /^function _\([^)]*\) \{\n([\s\S]+)\n}\n$/.exec(output);
  if (match === null) return null;
  assert(match[1] !== undefined, "match[1] should be defined");
  return match[1].replace(/^ {2}/gm, "");
}

describe("generator", (): void => {
  it("generates nothing for an empty program", (): void => {
    expect(gen("")).toEqual({
      javascript: none(),
      typedef: none(),
      sourceMap: { version: 3, mappings: [] },
    });
  });

  it("lowers a read-only let to const and `let mut` to let", (): void => {
    expect(stmts(gen('fn _() { let greeting = "hi"; }'))).toBe(
      'const greeting = "hi";',
    );
    expect(stmts(gen("fn _() { let mut n = 1; }"))).toBe("let n = 1;");
    expect(stmts(gen("fn _() { let b_true = true; }"))).toBe(
      "const b_true = true;",
    );
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
      fn lib() { 0; }
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

  it("keeps a struct-typed parameter in the JS signature (no JS-primitive type, but still a real param)", (): void => {
    expect(js(gen("struct R { id: i32 } fn f(p: R) { print(p.id); }"))).toBe(
      "function f(p) {\n  print(p.id);\n}\n",
    );
  });

  it("emits param types in .d.ts for pub fn", (): void => {
    expect(dts(gen("pub fn add(x: i32, y: i32) -> i32 { x + y }"))).toBe(
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
    ["Add", "i32", "x + y", "((x + y)|0)"],
    ["Sub", "i32", "x - y", "((x - y)|0)"],
    ["Mul", "i32", "x * y", "((x * y)|0)"],
    [
      "Div",
      "i32",
      "x / y",
      '((((_l, _r) => _r === 0 ? (() => { throw new RangeError("attempt to divide by zero"); })() : _l / _r)(x, y))|0)',
    ],
    [
      "Rem",
      "i32",
      "x % y",
      '((((_l, _r) => _r === 0 ? (() => { throw new RangeError("attempt to divide by zero"); })() : _l % _r)(x, y))|0)',
    ],
    ["Shl", "i32", "x << y", "((x << y)|0)"],
    ["Shr", "i32", "x >> y", "((x >> y)|0)"],
    ["BitAnd", "i32", "x & y", "((x & y)|0)"],
    ["BitXor", "i32", "x ^ y", "((x ^ y)|0)"],
    ["BitOr", "i32", "x | y", "((x | y)|0)"],
    ["Eq", "i32", "x == y", "x === y"],
    ["Ne", "i32", "x != y", "x !== y"],
    ["Lt", "i32", "x < y", "x < y"],
    ["Gt", "i32", "x > y", "x > y"],
    ["Le", "i32", "x <= y", "x <= y"],
    ["Ge", "i32", "x >= y", "x >= y"],
    ["Add", "f32", "x + y", "Math.fround(x + y)"],
    ["Sub", "f32", "x - y", "Math.fround(x - y)"],
    ["Mul", "f32", "x * y", "Math.fround(x * y)"],
    ["Div", "f32", "x / y", "Math.fround(x / y)"],
    ["Rem", "f32", "x % y", "Math.fround(x % y)"],
    ["Eq", "f32", "x == y", "x === y"],
    ["Ne", "f32", "x != y", "x !== y"],
    ["Lt", "f32", "x < y", "x < y"],
    ["Gt", "f32", "x > y", "x > y"],
    ["Le", "f32", "x <= y", "x <= y"],
    ["Ge", "f32", "x >= y", "x >= y"],
    ["And", "bool", "x && y", "x && y"],
    ["Or", "bool", "x || y", "x || y"],
  ])("%s emits correct JS operator for %s", (_, ty, source, expected) => {
    expect(stmts(gen(`fn _(x: ${ty}, y: ${ty}) { ${source}; }`))).toBe(
      `${expected};`,
    );
  });

  it.each([
    ["Shr", "f32", "x >> y"],
    ["Shl", "f32", "x << y"],
    ["BitAnd", "f32", "x & y"],
    ["BitOr", "f32", "x | y"],
    ["BitXor", "f32", "x ^ y"],
  ])("%s on %s is a type-error", (_, ty, source): void => {
    expect(() =>
      stmts(gen(`fn _(x: ${ty}, y: ${ty}) { ${source}; }`)),
    ).toThrow();
  });

  it("(x + y) * z — parens preserved because + binds looser than *", () => {
    expect(stmts(gen("fn _(x: (), y: (), z: ()) { (x + y) * z; }"))).toBe(
      "(x + y) * z;",
    );
  });

  it("x + y * z — no parens needed, * binds tighter", () => {
    expect(stmts(gen("fn _(x: (), y: (), z: ()) { x + y * z; }"))).toBe(
      "x + y * z;",
    );
  });

  it("x - (y - z) — right-side same-precedence op is parenthesised", () => {
    expect(stmts(gen("fn _(x: (), y: (), z: ()) { x - (y - z); }"))).toBe(
      "x - (y - z);",
    );
  });

  it("x || y && z — && binds tighter than ||, no parens needed", () => {
    expect(stmts(gen("fn _(x: bool, y: bool, z: bool) { x || y && z; }"))).toBe(
      "x || y && z;",
    );
  });
});

describe("unary expression codegen", () => {
  it.each([
    ["Neg", "-x", "(-x)"],
    ["Not", "!x", "(!x)"],
  ])("%s emits correct JS operator", (_, source, expected) => {
    expect(stmts(gen(`fn _(x: ()) { ${source}; }`))).toBe(`${expected};`);
  });

  it.each([
    ["i32", "((-x)|0)"],
    ["i8", "(((-x) << 24) >> 24)"],
    ["u32", "((-x)>>>0)"],
    ["f32", "Math.fround(-x)"],
    ["f64", "(-x)"],
  ])("Neg on %s wraps result", (ty, expected) => {
    expect(stmts(gen(`fn _(x: ${ty}) { -x; }`))).toBe(`${expected};`);
  });

  it.each([
    ["i64", "-0x8000_0000_0000_0001"],
    ["i32", "-0x8000_0001"],
    ["i16", "-0x8001"],
    ["i8", "-0x81"],
    ["u64", "-1"],
    ["u32", "-1"],
    ["u16", "-1"],
    ["u8", "-1"],
  ])("Neg on %s = %s literal panics", (ty, expected) => {
    expect(() => {
      stmts(gen(`fn _() { let x: ${ty} = ${expected}; }`));
    }).toThrow(`out of range for ${ty}`);
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
    expect(stmts(gen(`fn _(mut x: ()) { ${source} }`))).toBe(`${expected};`);
  });
});

describe("field access expression codegen", () => {
  it("emits object.field", () => {
    expect(stmts(gen("fn _(foo: ()) { foo.bar; }"))).toBe("foo.bar;");
  });
  it("calling a field value uses (0, a.b)(c) to detach this", () => {
    const js = stmts(gen("fn _(foo: (), x: ()) { (foo.bar)(x); }"));
    assert(js !== null, "JS output should not be null");

    expect(js).toBe("(0, foo.bar)(x);");
    expect(
      eval(`
      const foo = {
        bar() { return this }
      };
      const x = "x";
      ${js}
    `),
    ).toBeUndefined();
  });
  it("calling an index value uses (0, a[b])(c) to detach this", () => {
    const js = stmts(gen("fn _(a: (), b: (), x: ()) { (a[b])(x); }"));
    assert(js !== null, "JS output should not be null");
    expect(js).toBe("(0, a[b])(x);");
    expect(
      eval(`
      const b = "b";
      const x = "x";
      const a = {
        b() { return this }
      };
      ${js}
    `),
    ).toBeUndefined();
  });
});

describe("no-init let codegen", () => {
  it("immutable let with no initializer is omitted from output", () => {
    expect(stmts(gen("fn _() { let x; }"))).toBe("");
  });

  it("mutable let with no initializer emits let x;", () => {
    expect(stmts(gen("fn _() { let mut x; }"))).toBe("let x;");
  });
});

describe("method call expression codegen", () => {
  it("no-arg method call", () => {
    expect(stmts(gen("fn _(a: ()) { a.method() }"))).toBe("a.method();");
  });
  it("method call with arguments", () => {
    expect(stmts(gen("fn _(a: (), b: (), c: ()) { a.method(b, c) }"))).toBe(
      "a.method(b, c);",
    );
  });
  it("method call with arguments and trailing comma", () => {
    expect(stmts(gen("fn _(a: (), b: (), c: ()) { a.method(b, c, ) }"))).toBe(
      "a.method(b, c);",
    );
  });
  it("chained method calls", () => {
    expect(stmts(gen("fn _(a: ()) { a.foo().bar() }"))).toBe("a.foo().bar();");
  });
});

describe("index expression codegen", () => {
  it("a[0] emits a[0]", () => {
    expect(stmts(gen("fn _(a: ()) { a[0] }"))).toBe("a[0];");
  });
  it("a[b + c] emits a[b + c]", () => {
    expect(stmts(gen("fn _(a: (), b: (), c: ()) { a[b + c] }"))).toBe(
      "a[b + c];",
    );
  });
  it("a[b][c] chains left-to-right", () => {
    expect(stmts(gen("fn _(a: (), b: (), c: ()) { a[b][c] }"))).toBe(
      "a[b][c];",
    );
  });
  it("a[b[c]] nests properly", () => {
    expect(stmts(gen("fn _(a: (), b: (), c: ()) { a[b[c]] }"))).toBe(
      "a[b[c]];",
    );
  });
});

describe("tuple expression codegen", () => {
  it("() lowers to [] (unit)", () => {
    expect(stmts(gen("fn _() { (); }"))).toBe("[];");
  });
  it("(1,) lowers to [1]", () => {
    expect(stmts(gen("fn _() { (1,); }"))).toBe("[1];");
  });
  it("(1, 2) lowers to [1, 2]", () => {
    expect(stmts(gen("fn _() { (1, 2); }"))).toBe("[1, 2];");
  });
  it("(1) is transparent grouping, not a tuple", () => {
    expect(stmts(gen("fn _() { (1); }"))).toBe("1;");
  });
});

describe("range expression codegen", () => {
  it("a..b lowers to an object literal with start/end/inclusive", () => {
    expect(stmts(gen("fn _(a: (), b: ()) { a..b; }"))).toBe(
      "({start: a, end: b, inclusive: false});",
    );
  });
  it("a..=b sets inclusive: true", () => {
    expect(stmts(gen("fn _(a: (), b: ()) { a..=b; }"))).toBe(
      "({start: a, end: b, inclusive: true});",
    );
  });
  it("a.. omits the end key (RangeFrom)", () => {
    expect(stmts(gen("fn _(a: ()) { a..; }"))).toBe(
      "({start: a, inclusive: false});",
    );
  });
  it("..b omits the start key (RangeTo)", () => {
    expect(stmts(gen("fn _(b: ()) { ..b; }"))).toBe(
      "({end: b, inclusive: false});",
    );
  });
  it(".. omits both start and end keys (RangeFull)", () => {
    expect(stmts(gen("fn _() { ..; }"))).toBe("({inclusive: false});");
  });
  it("a range used as a field-access receiver needs no extra parens beyond its own self-delimiting object literal", () => {
    expect(stmts(gen("fn _(a: (), b: ()) { (a..b).foo; }"))).toBe(
      "({start: a, end: b, inclusive: false}).foo;",
    );
  });
});

describe("block expression codegen", () => {
  it("empty block emits nothing", () => {
    expect(stmts(gen("fn _() { { }; }"))).toBe("");
  });
  it("block without trailing expressions creates a block", () => {
    expect(stmts(gen("fn _() { { 1; }; }"))).toBe("{ 1; }");
  });
  it("multi-statement block emits multiline", () => {
    expect(stmts(gen("fn _(x: ()) { { let y = 1; x; }; }"))).toBe(
      ["{\n  const y = 1;\n  x;\n}"].join("\n"),
    );
  });
  it("block with trailing expression wraps in IIFE", () => {
    expect(stmts(gen("fn _() { { 1 }; }"))).toBe(
      ["(() => {", "  return 1;", "})();"].join("\n"),
    );
  });
  it("block with statements and trailing expression", () => {
    expect(stmts(gen("fn _() { { let x = 1; x }; }"))).toBe(
      ["(() => {", "  const x = 1;", "  return x;", "})();"].join("\n"),
    );
  });
  it("block as let initializer", () => {
    expect(stmts(gen("fn _() { let result = { 1 + 2 }; }"))).toBe(
      ["const result = (() => {", "  return ((1 + 2)|0);", "})();"].join("\n"),
    );
  });
});

describe("if expression codegen", () => {
  it("if without else wraps in IIFE", () => {
    expect(stmts(gen("fn _(cond: (), foo: ()) { if cond { foo } }"))).toBe(
      ["(() => {", "  if (cond) {", "    return foo;", "  }", "})();"].join(
        "\n",
      ),
    );
  });
  it("if-else emits both branches", () => {
    expect(
      stmts(gen("fn _(cond: (), a: (), b: ()) { if cond { a } else { b } }")),
    ).toBe(
      [
        "(() => {",
        "  if (cond) {",
        "    return a;",
        "  } else {",
        "    return b;",
        "  }",
        "})();",
      ].join("\n"),
    );
  });
  it("else-if chain emits inline else if", () => {
    expect(
      stmts(
        gen(
          "fn _(a: (), b: ()) -> i32 { if a { 1 } else if b { 2 } else { 3 } }",
        ),
      ),
    ).toBe(
      [
        "if (a) {",
        "  return 1;",
        "} else if (b) {",
        "  return 2;",
        "} else {",
        "  return 3;",
        "}",
      ].join("\n"),
    );
  });
  it("a plain trailing expression returns a value with the correct i32 wrap", () => {
    const code = gen("fn double(x: i32) -> i32 { x * 2 }");
    expect(js(code)).toBe("function double(x) {\n  return ((x * 2)|0);\n}\n");
  });

  it("an if/else trailing expression returns a value from each branch, no IIFE", () => {
    const code = gen("fn sign(x: i32) -> i32 { if x > 0 { 1 } else { -1 } }");
    expect(js(code)).toBe(
      "function sign(x) {\n  if (x > 0) {\n    return 1;\n  } else {\n    return ((-1)|0);\n  }\n}\n",
    );
  });

  it("empty branches emit empty blocks", () => {
    expect(stmts(gen("fn _(cond: ()) { if cond { } else { }; }"))).toBe(
      "if (cond) {} else {}",
    );
  });
  it("branches without return values don't use IIFE", () => {
    expect(stmts(gen("fn _(cond: ()) { if cond { 2; } else { 1; }; }"))).toBe(
      "if (cond) { 2; } else { 1; }",
    );
  });
});

describe("struct expression codegen", () => {
  it("empty struct emits ({}) plus a no-op Symbol.dispose", () => {
    expect(stmts(gen("struct Foo{} fn _() { Foo {}; }"))).toBe(
      "({[Symbol.dispose]() {}});",
    );
  });
  it("named fields emit object literal plus a no-op Symbol.dispose", () => {
    expect(
      stmts(
        gen("struct Foo { x: i32, y: i32 } fn _() { Foo { x: 1, y: 2 }; }"),
      ),
    ).toBe("({x: 1, y: 2, [Symbol.dispose]() {}});");
  });
  it("shorthand fields emit ES6 shorthand plus a no-op Symbol.dispose", () => {
    expect(stmts(gen("struct Foo { x: () } fn _(x: ()) { Foo { x }; }"))).toBe(
      "({x, [Symbol.dispose]() {}});",
    );
  });
  it("struct update spread emits spread-first object literal plus a no-op Symbol.dispose", () => {
    expect(
      stmts(
        gen(
          "struct Foo { x: i32, y: i32, z: i32 } fn _(base: ()) { Foo { x: 1, ..base }; }",
        ),
      ),
    ).toBe("({...base, x: 1, [Symbol.dispose]() {}});");
  });
});

describe("using / scope-end drop codegen", (): void => {
  it("a non-mut struct binding never moved lowers to using", (): void => {
    const code = genWithOwnership(
      "struct R { id: i32 } fn _() { let x = R { id: 1 }; print(x.id); }",
    );
    expect(stmts(code)).toBe(
      "using x = ({id: 1, [Symbol.dispose]() {}});\nprint(x.id);",
    );
  });

  it("a let mut struct binding stays plain let (deferred to Slice 2)", (): void => {
    const code = genWithOwnership(
      "struct R { id: i32 } fn _() { let mut x = R { id: 1 }; print(x.id); }",
    );
    expect(stmts(code)).toBe(
      "let x = ({id: 1, [Symbol.dispose]() {}});\nprint(x.id);",
    );
  });

  it("a moved-from binding stays const; the binding it moved into becomes using", (): void => {
    const code = genWithOwnership(
      "struct R { id: i32 } fn _() { let x = R { id: 1 }; let y = x; print(y.id); }",
    );
    expect(stmts(code)).toBe(
      "const x = ({id: 1, [Symbol.dispose]() {}});\nusing y = x;\nprint(y.id);",
    );
  });

  it("a struct parameter still owned at function exit gets a shadow using rebind", (): void => {
    const code = genWithOwnership(
      "struct R { id: i32 } fn f(p: R) { print(p.id); }",
    );
    expect(js(code)).toBe(
      "function f(p) {\n  using p$1 = p;\n  print(p$1.id);\n}\n",
    );
  });

  it("a mut struct parameter is not shadow-rebound (deferred to Slice 2)", (): void => {
    const code = genWithOwnership(
      "struct R { id: i32 } fn f(mut p: R) { print(p.id); }",
    );
    expect(js(code)).toBe("function f(p) {\n  print(p.id);\n}\n");
  });

  it("a using-declared struct runs cleanly under Node's explicit resource management", (): void => {
    const code = genWithOwnership(
      "struct R { id: i32 } fn _() { let x = R { id: 1 }; print(x.id); }",
    );
    const body = stmts(code);
    assert(body !== null, "JS output should not be null");
    const printed: unknown[] = [];
    const script = `
      const print = (v) => { printed.push(v); };
      { ${body} }
    `;
    // `script` is compiler-generated JS from the hardcoded fixture above,
    // not external or user-supplied input, so this is the same
    // test-only pattern already used by the field/index-detach tests
    // in this file, not a real code-injection surface.
    // biome-ignore lint/security/noGlobalEval: test-only eval of compiler-generated fixture output, see comment above
    eval(script); // nosemgrep: javascript.browser.security.eval-detected.eval-detected,javascript_eval_rule-eval-with-expression
    expect(printed).toEqual([1]);
  });

  it("a let-bound UnitType-placeholder value never lowers to `using` because tuple/index/method-call/range constructs have no disposer", (): void => {
    const code = genWithOwnership(
      "fn _(a: (), b: ()) { let t = (1, 2); let i = a[0]; let m = a.method(); let r = a..b; print(t); }",
    );
    expect(stmts(code)).toBe(
      [
        "const t = [1, 2];",
        "const i = a[0];",
        "const m = a.method();",
        "const r = ({start: a, end: b, inclusive: false});",
        "print(t);",
      ].join("\n"),
    );
  });

  it("a const-declared range runs cleanly (regression: no [Symbol.dispose] crash from an incorrect using lowering)", (): void => {
    const code = genWithOwnership("fn _(a: (), b: ()) { let r = a..b; }");
    const body = stmts(code);
    assert(body !== null, "JS output should not be null");
    const script = `(function (a, b) { ${body} })(1, 10);`;
    // `script` is compiler-generated JS from the hardcoded fixture above,
    // not external or user-supplied input; same test-only pattern as the
    // other eval-based codegen tests in this file, not a code-injection surface.
    // biome-ignore lint/security/noGlobalEval: test-only eval of compiler-generated fixture output, see comment above
    eval(script); // nosemgrep: javascript.browser.security.eval-detected.eval-detected,javascript_eval_rule-eval-with-expression
  });
});

describe("source maps", (): void => {
  it("maps the whole function declaration back to its own source span", (): void => {
    const source = "fn _() { print(1); }";
    const code = gen(source);
    const output = js(code);
    assert(output !== null);
    const functionStart = output.indexOf("function _()");
    const functionEnd = output.indexOf("\n}") + "\n}".length;
    const covering = code.sourceMap.mappings.find(
      (m) => m.generatedStart <= functionStart && m.generatedEnd >= functionEnd,
    );
    assert(covering !== undefined, "Expected a covering mapping");
    expect(source.slice(covering.sourceStart, covering.sourceEnd)).toBe(source);
  });

  it("maps a let binding's generated text through its trailing semicolon", (): void => {
    const source = "fn _() { let x = 1 + 2; print(x); }";
    const code = gen(source);
    const output = js(code);
    assert(output !== null);
    const letTextStart = output.indexOf("const x = ");
    const letTextEnd = output.indexOf(";", letTextStart) + 1;
    const mapping = code.sourceMap.mappings.find(
      (m) => m.generatedStart <= letTextStart && m.generatedEnd >= letTextEnd,
    );
    assert(mapping !== undefined, "Expected a covering let-statement mapping");
    expect(source.slice(mapping.sourceStart, mapping.sourceEnd)).toBe(
      "let x = 1 + 2;",
    );
  });

  it("does not map an uninitialized wildcard let that emits no code", (): void => {
    const source = "fn _() { let _; print(2); }";
    const code = gen(source);
    // `let _;` (immutable, no initializer) emits an empty string (see
    // emitLet), so it must produce no mapping entry pointing back at it,
    // not a zero-width one.
    const wildcardMappings = code.sourceMap.mappings.filter(
      (m) => source.slice(m.sourceStart, m.sourceEnd) === "let _;",
    );
    expect(wildcardMappings).toEqual([]);
  });
});
