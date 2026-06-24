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

  it("unit-typed param is kept in JSIM output with null type", () => {
    const program = toJsim(parseOrThrow("fn f(x: ()) {}"));
    expect(program).toMatchObject({
      items: [
        {
          kind: "FunctionDecl",
          params: [
            {
              kind: "FunctionParam",
              name: "x",
              type: { kind: "PrimitiveType", value: "null" },
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
      const program = toJsim(parseOrThrow(source));
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
      const program = toJsim(parseOrThrow(source));
      expect(program.items[0]).toMatchObject({
        kind: "UnaryExpression",
        operator,
      });
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
      const program = toJsim(parseOrThrow(source));
      expect(program.items[0]).toMatchObject({
        kind: "AssignExpression",
        operator,
      });
    });
  });

  describe("path and identifier lowering", () => {
    it("single-segment path lowers to Identifier", () => {
      const program = toJsim(parseOrThrow("x"));
      expect(program.items[0]).toMatchObject({
        kind: "Identifier",
        value: "x",
      });
    });

    it("multi-segment path stays as PathExpression", () => {
      const program = toJsim(parseOrThrow("foo::bar;"));
      expect(program.items[0]).toMatchObject({
        kind: "PathExpression",
        path: ["foo", "bar"],
      });
    });

    it("absolute path stays as PathExpression", () => {
      const program = toJsim(parseOrThrow("::foo;"));
      expect(program.items[0]).toMatchObject({
        kind: "PathExpression",
        path: ["foo"],
      });
    });
  });

  describe("reference expressions", () => {
    it("ReferenceExpression is transparent — emits the operand directly", () => {
      const program = toJsim(parseOrThrow("&x;"));
      expect(program.items[0]).toMatchObject({
        kind: "Identifier",
        value: "x",
      });
    });
  });

  describe("int literal bases", () => {
    it("hex IntLiteral is converted to decimal", () => {
      const program = toJsim(parseOrThrow("0xFF"));
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "255",
      });
    });

    it("octal IntLiteral is converted to decimal", () => {
      const program = toJsim(parseOrThrow("0o17"));
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "15",
      });
    });

    it("binary IntLiteral is converted to decimal", () => {
      const program = toJsim(parseOrThrow("0b1010"));
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "10",
      });
    });
  });

  describe("other literal kinds", () => {
    it("CharLiteral lowers to StringLiteral", () => {
      const program = toJsim(parseOrThrow("'a'"));
      expect(program.items[0]).toMatchObject({
        kind: "StringLiteral",
        value: "a",
      });
    });

    it("FloatLiteral lowers to NumberLiteral", () => {
      const program = toJsim(parseOrThrow("3.14"));
      expect(program.items[0]).toMatchObject({
        kind: "NumberLiteral",
        value: "3.14",
      });
    });
  });

  describe("field access expressions", () => {
    it("FieldAccessExpression lowers to FieldAccessExpression with Identifier object", () => {
      const program = toJsim(parseOrThrow("foo.bar;"));
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
});
