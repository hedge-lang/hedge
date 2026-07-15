import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isSome, none, some } from "../option.js";
import { tokenize } from "../lexer/lexer.js";
import { analyzeOwnership } from "../ownership/move-check.js";
import { parse } from "../parser/parser.js";
import { analyze } from "../semantics/analyzer.js";
import { toJsim } from "./jsim.js";
import type * as JSIM from "./ast.js";

/**
 * Lowers `source` to JSIM without requiring error-free semantic analysis.
 * Several fixtures below are deliberately semantically invalid (bare
 * top-level expressions, undefined identifiers, a declared-but-unfilled
 * return type) to isolate JSIM's own lowering shape from full type-checking.
 * Only a successful parse is required.
 */
function jsimSource(source: string): JSIM.Program {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  const analysis = analyze(program.value, tokens);
  return toJsim(analysis.program, tokens);
}

/**
 * Like `jsimSource`, but also runs ownership analysis and threads its
 * per-function drop info through.
 */
function jsimSourceWithOwnership(source: string): JSIM.Program {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  const analysis = analyze(program.value, tokens);
  assert(
    analysis.diagnostics.every((d) => d.severity !== "error"),
    analysis.diagnostics.map((d) => d.message).join("; "),
  );
  const ownership = analyzeOwnership(analysis.program, tokens);
  assert(
    ownership.diagnostics.every((d) => d.severity !== "error"),
    ownership.diagnostics.map((d) => d.message).join("; "),
  );
  return toJsim(analysis.program, tokens, ownership.functions);
}

/**
 * Retrieves the main function declaration from the given program.
 *
 * @param program The program object containing various items, including
 *   function declarations.
 *
 * @return The main function declaration object if found.
 */
function mainFunction(program: JSIM.Program): JSIM.FunctionDecl {
  const main = program.items.find(
    (item): item is JSIM.FunctionDecl =>
      item.kind === "FunctionDecl" && item.name === "main",
  );
  assert(main !== undefined, "Expected a main function");
  return main;
}

describe("toJsim", () => {
  it("parses functions to the JSIM Function representation", () => {
    const program = jsimSource(`
                fn test_fn() {
                    // Empty on purpose
                }
            `);
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
    const program = jsimSource("fn f(x: i32, b: bool) {}");
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: some({ kind: "PrimitiveType", value: "number" }),
            },
            {
              kind: "FunctionParam",
              name: "b",
              type: some({ kind: "PrimitiveType", value: "boolean" }),
            },
          ],
        },
      ],
    });
  });

  it("maps a function return type to a JSIM PrimitiveType", () => {
    const program = jsimSource("fn f() -> bool {}");
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
    const program = jsimSource("fn f(x: i64) {}");
    expect(program).toMatchObject({
      items: [
        {
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: some({ kind: "PrimitiveType", value: "bigint" }),
            },
          ],
        },
      ],
    });
  });

  it("maps a unit return type to none()", () => {
    const program = jsimSource("fn f() -> () {}");
    expect(program).toMatchObject({
      items: [{ kind: "FunctionDecl", returnType: none() }],
    });
  });

  it("erases a &str param and return type transparently to string - no wrapper, same as a bare str", () => {
    const program = jsimSource("fn first(s: &str) -> &str { s }");
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          params: [
            {
              kind: "FunctionParam",
              name: "s",
              type: some({ kind: "PrimitiveType", value: "string" }),
            },
          ],
          returnType: some({ kind: "PrimitiveType", value: "string" }),
        },
      ],
    });
  });

  it("emits no scope-end using for an unused &str parameter, since a reference is Copy and never move-tracked for drop", () => {
    const program = jsimSourceWithOwnership(
      "fn longest<'a>(a: &'a str, b: &'a str) -> &'a str { a }",
    );
    const fn = program.items.find((item): item is JSIM.FunctionDecl => {
      return item.kind === "FunctionDecl" && item.name === "longest";
    });
    assert(fn !== undefined, "Expected a longest function");
    expect(fn.params).toHaveLength(2);
    expect(fn.params).toMatchObject([
      { type: some({ kind: "PrimitiveType", value: "string" }) },
      { type: some({ kind: "PrimitiveType", value: "string" }) },
    ]);
    expect(fn.body).toHaveLength(1);
    expect(fn.body).toMatchObject([{ kind: "ReturnStatement" }]);
  });

  it("erases a &mut i32 param the same as &i32 - mutability doesn't change the erased JS representation", () => {
    const program = jsimSource("fn f(x: &mut i32) {}");
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: some({ kind: "PrimitiveType", value: "number" }),
            },
          ],
        },
      ],
    });
  });

  it("struct declaration produces no JSIM items", () => {
    const program = jsimSource("struct Foo;");
    expect(program.items).toEqual([]);
  });

  it("unit-typed param is kept in JSIM output with null type", () => {
    const program = jsimSource("fn f(x: ()) {}");
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: some({ kind: "PrimitiveType", value: "null" }),
            },
          ],
        },
      ],
    });
  });

  describe("binary expressions", () => {
    it.each([
      ["Add", "x + y"],
      ["Sub", "x - y"],
      ["Mul", "x * y"],
      ["Div", "x / y"],
      ["Rem", "x % y"],
      ["Shl", "x << y"],
      ["Shr", "x >> y"],
      ["BitAnd", "x & y"],
      ["BitXor", "x ^ y"],
      ["BitOr", "x | y"],
      ["Eq", "x == y"],
      ["Ne", "x != y"],
      ["Lt", "x < y"],
      ["Gt", "x > y"],
      ["Le", "x <= y"],
      ["Ge", "x >= y"],
      ["And", "x && y"],
      ["Or", "x || y"],
    ])("binary operator %s is preserved in JSIM", (operator, source) => {
      const program = jsimSource(source);
      expect(program.items[0]).toMatchObject({
        kind: "BinaryExpression",
        operator,
      });
    });
  });

  describe("unary expressions", () => {
    it.each([
      ["Neg", "-x"],
      ["Not", "!x"],
    ])("unary operator %s is preserved in JSIM", (operator, source) => {
      const program = jsimSource(source);
      expect(program.items[0]).toMatchObject({
        kind: "UnaryExpression",
        operator,
      });
    });
  });

  describe("range expressions", () => {
    it("a range with both operands lowers with start/end present", () => {
      const program = jsimSource("x..y");
      expect(program.items[0]).toMatchObject({
        kind: "RangeExpression",
        inclusive: false,
        start: some({ kind: "Identifier", value: "x" }),
        end: some({ kind: "Identifier", value: "y" }),
      });
    });

    it("an inclusive range sets inclusive: true", () => {
      const program = jsimSource("x..=y");
      expect(program.items[0]).toMatchObject({
        kind: "RangeExpression",
        inclusive: true,
      });
    });

    it("a bare range (RangeFull) lowers with start and end both none()", () => {
      const program = jsimSource("..");
      expect(program.items[0]).toMatchObject({
        kind: "RangeExpression",
        inclusive: false,
        start: none(),
        end: none(),
      });
    });

    it("an identifier inside a range's start participates in alpha-rename normally", () => {
      const program = jsimSource("fn main() { let x = 1; let x = x..10; }");
      const functionDecl = program.items.find(
        (item) => item.kind === "FunctionDecl",
      );
      assert(
        functionDecl !== undefined,
        "Expected to find a function declaration block",
      );
      const letStatements = functionDecl.body.filter(
        (statement) => statement.kind === "LetStatement",
      );
      expect(letStatements).toMatchObject([
        { kind: "LetStatement", name: "x" },
        {
          kind: "LetStatement",
          name: "x$1",
          value: some({
            kind: "RangeExpression",
            start: some({ kind: "Identifier", value: "x" }),
          }),
        },
      ]);
    });
  });

  describe("assign expressions", () => {
    it.each([
      ["Assign", "x = 1;"],
      ["AddAssign", "x += 1;"],
      ["SubAssign", "x -= 1;"],
      ["MulAssign", "x *= 1;"],
      ["DivAssign", "x /= 1;"],
      ["RemAssign", "x %= 1;"],
      ["BitAndAssign", "x &= 1;"],
      ["BitOrAssign", "x |= 1;"],
      ["BitXorAssign", "x ^= 1;"],
      ["ShlAssign", "x <<= 1;"],
      ["ShrAssign", "x >>= 1;"],
    ])("assign operator %s is preserved in JSIM", (operator, source) => {
      const program = jsimSource(source);
      expect(program.items[0]).toMatchObject({
        kind: "AssignExpression",
        operator,
      });
    });
  });

  describe("path and identifier lowering", () => {
    it("single-segment path lowers to Identifier", () => {
      const program = jsimSource("x");
      expect(program.items[0]).toMatchObject({
        kind: "Identifier",
        value: "x",
      });
    });

    it("multi-segment path stays as PathExpression", () => {
      const program = jsimSource("foo::bar;");
      expect(program.items[0]).toMatchObject({
        kind: "PathExpression",
        path: ["foo", "bar"],
      });
    });

    it("absolute path stays as PathExpression", () => {
      const program = jsimSource("::foo;");
      expect(program.items[0]).toMatchObject({
        kind: "PathExpression",
        path: ["foo"],
      });
    });
  });

  describe("reference expressions", () => {
    it("ReferenceExpression is transparent — emits the operand directly", () => {
      const program = jsimSource("&x;");
      expect(program.items[0]).toMatchObject({
        kind: "Identifier",
        value: "x",
      });
    });
  });

  describe("dereference expressions", () => {
    it("DereferenceExpression is transparent - emits the operand directly", () => {
      const program = jsimSource("*x;");
      expect(program.items[0]).toMatchObject({
        kind: "Identifier",
        value: "x",
      });
    });
  });

  describe("int literal bases", () => {
    it("hex IntLiteral is converted to decimal", () => {
      const program = jsimSource("0xFF");
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "255",
      });
    });

    it("octal IntLiteral is converted to decimal", () => {
      const program = jsimSource("0o17");
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "15",
      });
    });

    it("binary IntLiteral is converted to decimal", () => {
      const program = jsimSource("0b1010");
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "10",
      });
    });
  });

  describe("other literal kinds", () => {
    it("CharLiteral lowers to StringLiteral", () => {
      const program = jsimSource("'a'");
      expect(program.items[0]).toMatchObject({
        kind: "StringLiteral",
        value: "a",
      });
    });

    it("FloatLiteral lowers to NumberLiteral", () => {
      const program = jsimSource("3.14");
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "3.14",
      });
    });
  });

  describe("field access expressions", () => {
    it("FieldAccessExpression lowers to FieldAccessExpression with Identifier object", () => {
      const program = jsimSource("foo.bar;");
      expect(program.items[0]).toMatchObject({
        kind: "FieldAccessExpression",
        object: { kind: "Identifier", value: "foo" },
        field: "bar",
      });
    });
  });

  describe("unknown param types", () => {
    it.todo(
      "unknown param type emits FunctionParam with type { kind: 'PrimitiveType', value: 'unknown' }" +
        " — currently the param is silently dropped; correct behavior is to emit `unknown`",
    );
  });

  describe("block lowering", () => {
    it("empty block in statement position lowers to BlockStatement with empty body", () => {
      const program = jsimSource("fn _() { { }; }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [{ kind: "BlockStatement", body: [] }],
          },
        ],
      });
    });

    it("block without trailing expression lowers to BlockStatement containing its statements", () => {
      const program = jsimSource("fn _() { { 1; }; }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "BlockStatement",
                body: [{ kind: "NumberLiteral", value: "1" }],
              },
            ],
          },
        ],
      });
    });

    it("block with trailing expression lowers to IIFE (CallExpression of ArrowFunctionExpression)", () => {
      const program = jsimSource("fn _() { let x = { 1 }; }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "LetStatement",
                value: {
                  value: {
                    kind: "CallExpression",
                    callee: {
                      kind: "ArrowFunctionExpression",
                      body: [{ kind: "ReturnStatement" }],
                    },
                  },
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe("if-expression lowering", () => {
    it("if with no result in any branch lowers to bare IfStatement (no IIFE)", () => {
      const program = jsimSource("fn _() { if cond { }; }");
      expect(program).toMatchObject({
        items: [{ kind: "FunctionDecl", body: [{ kind: "IfStatement" }] }],
      });
    });

    it("if with a result in a branch lowers to IIFE wrapping IfStatement", () => {
      const program = jsimSource(
        "fn _() { let x = if cond { 1 } else { 2 }; }",
      );
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "LetStatement",
                value: {
                  value: {
                    kind: "CallExpression",
                    callee: { kind: "ArrowFunctionExpression" },
                  },
                },
              },
            ],
          },
        ],
      });
    });

    it("else-if chain with no results lowers to nested bare IfStatements", () => {
      const program = jsimSource("fn _() { if a { } else if b { }; }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "IfStatement",
                elseBranch: { value: [{ kind: "IfStatement" }] },
              },
            ],
          },
        ],
      });
    });
  });

  describe("function trailing-expression lowering (tail-position return)", () => {
    it("plain-expression trailing return lowers to a single ReturnStatement, no IIFE", () => {
      const program = jsimSource("fn f(x: i32) -> i32 { x * 2 }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "ReturnStatement",
                value: { value: { kind: "BinaryExpression" } },
              },
            ],
          },
        ],
      });
    });

    it("if/else trailing return lowers to a bare IfStatement with ReturnStatement in each branch, no IIFE", () => {
      const program = jsimSource(
        "fn sign(x: i32) -> i32 { if x > 0 { 1 } else { -1 } }",
      );
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "IfStatement",
                thenBranch: [{ kind: "ReturnStatement" }],
                elseBranch: { value: [{ kind: "ReturnStatement" }] },
              },
            ],
          },
        ],
      });
    });

    it("else-if chain trailing return recursively pushes ReturnStatement into every leaf", () => {
      const program = jsimSource(
        "fn f(a: bool, b: bool) -> i32 { if a { 1 } else if b { 2 } else { 3 } }",
      );
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "IfStatement",
                thenBranch: [{ kind: "ReturnStatement" }],
                elseBranch: {
                  value: [
                    {
                      kind: "IfStatement",
                      thenBranch: [{ kind: "ReturnStatement" }],
                      elseBranch: { value: [{ kind: "ReturnStatement" }] },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
    });

    it("a unit-returning function's trailing expression stays a bare statement, not a ReturnStatement", () => {
      const program = jsimSource('fn f() { print("hi") }');
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [{ kind: "CallExpression" }],
          },
        ],
      });
    });

    it("block trailing-expression splices its return directly, no IIFE", () => {
      const program = jsimSource("fn f() -> i32 { { 5 } }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "ReturnStatement",
                value: { value: { kind: "NumberLiteral" } },
              },
            ],
          },
        ],
      });
    });

    it("known limitation: an if nested inside a function's trailing block is still IIFE-wrapped (one level deep only)", () => {
      const program = jsimSource(
        "fn f() -> i32 { { if true { 1 } else { 2 } } }",
      );
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              {
                kind: "ReturnStatement",
                value: {
                  value: {
                    kind: "CallExpression",
                    callee: { kind: "ArrowFunctionExpression" },
                  },
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe("alpha-rename", () => {
    it("three sequential shadows of the same name produce distinct emitted identifiers", () => {
      const program = jsimSource(
        "fn main() { let x = 1; let x = 2; let x = 3; }",
      );
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            body: [
              { kind: "LetStatement", name: "x" },
              { kind: "LetStatement", name: "x$1" },
              { kind: "LetStatement", name: "x$2" },
            ],
          },
        ],
      });
    });

    it("function parameter shadowed by inner let uses original name in declaration and suffixed name in body", () => {
      const program = jsimSource("fn foo(n: i32) { let n = 42; }");
      expect(program).toMatchObject({
        items: [
          {
            kind: "FunctionDecl",
            params: [{ kind: "FunctionParam", name: "n" }],
            body: [{ kind: "LetStatement", name: "n$1" }],
          },
        ],
      });
    });

    it("shadow of x skips user-defined x$1 and lands on x$2", () => {
      const program = jsimSource(
        "fn main() { let x = 1; let x$1 = 50; let x = 2; }",
      );
      const functionDecl = program.items.find(
        (item) => item.kind === "FunctionDecl",
      );
      assert(
        functionDecl !== undefined,
        "Expected to find a function declaration block",
      );
      const letStatements = functionDecl.body.filter(
        (statement) => statement.kind === "LetStatement",
      );
      expect(letStatements).toMatchObject([
        { kind: "LetStatement", name: "x" },
        { kind: "LetStatement", name: "x$1" },
        { kind: "LetStatement", name: "x$2" },
      ]);
    });

    it("user-defined x$1 declared after shadow is renamed to x$1$1", () => {
      const program = jsimSource(
        "fn main() { let x = 1; let x = 2; let x$1 = 99; }",
      );
      const functionDecl = program.items.find(
        (item) => item.kind === "FunctionDecl",
      );
      assert(
        functionDecl !== undefined,
        "Expected to find a function declaration block",
      );
      const letStatements = functionDecl.body.filter(
        (statement) => statement.kind === "LetStatement",
      );
      expect(letStatements).toMatchObject([
        { kind: "LetStatement", name: "x" },
        { kind: "LetStatement", name: "x$1" },
        { kind: "LetStatement", name: "x$1$1" },
      ]);
    });

    it("struct shorthand field resolves to the renamed binding in scope", () => {
      const program = jsimSource(
        "struct Pt { x: i32 } fn main() { let x = 1; let x = 2; let p = Pt { x }; }",
      );
      const functionDecl = program.items.find(
        (item) => item.kind === "FunctionDecl",
      );
      assert(
        functionDecl !== undefined,
        "Expected to find a function declaration block",
      );
      const letP = functionDecl.body.find(
        (b) => b.kind === "LetStatement" && b.name === "p",
      );
      assert(letP !== undefined, "Expected to find `let p` statement");
      expect(letP).toMatchObject({
        kind: "LetStatement",
        name: "p",
        value: {
          kind: "Some",
          value: {
            kind: "StructExpression",
            fields: [
              {
                kind: "StructField",
                name: "x",
                value: {
                  kind: "Some",
                  value: { kind: "Identifier", value: "x$1" },
                },
              },
            ],
          },
        },
      });
    });
  });
});

describe("scope-end drop", () => {
  it("a non-mut struct binding never moved is marked for dispose", () => {
    const program = jsimSourceWithOwnership(
      "struct R { id: i32 } fn main() { let x = R { id: 1 }; print(x.id); }",
    );
    const letX = mainFunction(program).body.find(
      (s) => s.kind === "LetStatement" && s.name === "x",
    );
    expect(letX).toMatchObject({ kind: "LetStatement", dispose: true });
  });

  it("a let mut struct binding is not marked for dispose (deferred to Slice 2)", () => {
    const program = jsimSourceWithOwnership(
      "struct R { id: i32 } fn main() { let mut x = R { id: 1 }; print(x.id); }",
    );
    const letX = mainFunction(program).body.find(
      (s) => s.kind === "LetStatement" && s.name === "x",
    );
    expect(letX).toMatchObject({ kind: "LetStatement", dispose: false });
  });

  it("a moved-from binding is not disposed; the binding it moved into is", () => {
    const program = jsimSourceWithOwnership(
      "struct R { id: i32 } fn main() { let x = R { id: 1 }; let y = x; print(y.id); }",
    );
    const body = mainFunction(program).body;
    const letX = body.find((s) => s.kind === "LetStatement" && s.name === "x");
    const letY = body.find((s) => s.kind === "LetStatement" && s.name === "y");
    expect(letX).toMatchObject({ kind: "LetStatement", dispose: false });
    expect(letY).toMatchObject({ kind: "LetStatement", dispose: true });
  });

  it("a Copy-typed (i32) binding is never marked for dispose", () => {
    const program = jsimSourceWithOwnership(
      "fn main() { let x = 1; print(x); }",
    );
    const letX = mainFunction(program).body.find(
      (s) => s.kind === "LetStatement" && s.name === "x",
    );
    expect(letX).toMatchObject({ kind: "LetStatement", dispose: false });
  });

  it("a struct parameter still owned at function exit gets a shadow rebind marked for dispose", () => {
    const program = jsimSourceWithOwnership(
      "struct R { id: i32 } fn f(p: R) { print(p.id); }",
    );
    const f = program.items.find(
      (item): item is JSIM.FunctionDecl =>
        item.kind === "FunctionDecl" && item.name === "f",
    );
    assert(f !== undefined, "Expected function f");
    // The signature keeps the original param name...
    expect(f.params).toMatchObject([{ kind: "FunctionParam", name: "p" }]);
    // ...while the body shadow-rebinds it to a fresh alpha-rename name.
    const shadow = f.body[0];
    expect(shadow).toMatchObject({
      kind: "LetStatement",
      dispose: true,
      value: { kind: "Some", value: { kind: "Identifier", value: "p" } },
    });
    assert(shadow?.kind === "LetStatement");
    expect(shadow.name).not.toBe("p");
    const printCall = f.body.find((s) => s.kind === "CallExpression");
    expect(printCall).toMatchObject({
      kind: "CallExpression",
      arguments: [
        { kind: "FieldAccessExpression", object: { value: shadow.name } },
      ],
    });
  });

  it("a mut struct parameter is not shadow-rebound (deferred to Slice 2)", () => {
    const program = jsimSourceWithOwnership(
      "struct R { id: i32 } fn f(mut p: R) { print(p.id); }",
    );
    const f = program.items.find(
      (item): item is JSIM.FunctionDecl =>
        item.kind === "FunctionDecl" && item.name === "f",
    );
    assert(f !== undefined, "Expected function f");
    expect(f.body.some((s) => s.kind === "LetStatement")).toBe(false);
  });
});
