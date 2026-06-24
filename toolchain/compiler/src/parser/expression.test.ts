import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isSome, none } from "../option.js";
import { parse } from "./parser.js";
import { tokenize } from "../lexer/lexer.js";
import type { Program } from "./ast.js";

function parseProgram(source: string): Program {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return program.value;
}

describe("binary expressions — smoke tests", (): void => {
  it("parses 1 + 2 as BinaryExpression(Add)", (): void => {
    const ast = parseProgram("1 + 2");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: { kind: "IntLiteral", value: "1" },
          right: { kind: "IntLiteral", value: "2" },
        },
      ],
    });
  });

  it("parses a - b as Sub", (): void => {
    const ast = parseProgram("a - b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Sub",
          left: { kind: "PathExpression", path: { segments: ["a"] } },
          right: { kind: "PathExpression", path: { segments: ["b"] } },
        },
      ],
    });
  });

  it("parses x * y as Mul", (): void => {
    const ast = parseProgram("x * y");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Mul" }],
    });
  });

  it("parses p / q as Div", (): void => {
    const ast = parseProgram("p / q");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Div" }],
    });
  });

  it("parses n % 3 as Rem", (): void => {
    const ast = parseProgram("n % 3");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Rem" }],
    });
  });

  it("parses x << 1 as Shl", (): void => {
    const ast = parseProgram("x << 1");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Shl" }],
    });
  });

  it("parses x >> 2 as Shr", (): void => {
    const ast = parseProgram("x >> 2");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Shr" }],
    });
  });

  it("parses a & b as BitAnd (not a reference)", (): void => {
    const ast = parseProgram("a & b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "BitAnd" }],
    });
  });

  it("parses a ^ b as BitXor", (): void => {
    const ast = parseProgram("a ^ b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "BitXor" }],
    });
  });

  it("parses a | b as BitOr", (): void => {
    const ast = parseProgram("a | b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "BitOr" }],
    });
  });

  it("parses a == b as Eq", (): void => {
    const ast = parseProgram("a == b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Eq" }],
    });
  });

  it("parses a != b as Ne", (): void => {
    const ast = parseProgram("a != b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Ne" }],
    });
  });

  it("parses a < b as Lt", (): void => {
    const ast = parseProgram("a < b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Lt" }],
    });
  });

  it("parses a > b as Gt", (): void => {
    const ast = parseProgram("a > b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Gt" }],
    });
  });

  it("parses a <= b as Le", (): void => {
    const ast = parseProgram("a <= b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Le" }],
    });
  });

  it("parses a >= b as Ge", (): void => {
    const ast = parseProgram("a >= b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Ge" }],
    });
  });

  it("parses a && b as And", (): void => {
    const ast = parseProgram("a && b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "And" }],
    });
  });

  it("parses a || b as Or", (): void => {
    const ast = parseProgram("a || b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Or" }],
    });
  });
});

describe("operator precedence", (): void => {
  it("1 + 2 * 3 parses as 1 + (2 * 3) — AC requirement", (): void => {
    const ast = parseProgram("1 + 2 * 3");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: { kind: "IntLiteral", value: "1" },
          right: {
            kind: "BinaryExpression",
            operator: "Mul",
            left: { kind: "IntLiteral", value: "2" },
            right: { kind: "IntLiteral", value: "3" },
          },
        },
      ],
    });
  });

  it("1 * 2 + 3 parses as (1 * 2) + 3", (): void => {
    const ast = parseProgram("1 * 2 + 3");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: {
            kind: "BinaryExpression",
            operator: "Mul",
            left: { kind: "IntLiteral", value: "1" },
            right: { kind: "IntLiteral", value: "2" },
          },
          right: { kind: "IntLiteral", value: "3" },
        },
      ],
    });
  });

  it("a || b && c parses as a || (b && c) — && is tighter than ||", (): void => {
    const ast = parseProgram("a || b && c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Or",
          left: { kind: "PathExpression", path: { segments: ["a"] } },
          right: {
            kind: "BinaryExpression",
            operator: "And",
            left: { kind: "PathExpression", path: { segments: ["b"] } },
            right: { kind: "PathExpression", path: { segments: ["c"] } },
          },
        },
      ],
    });
  });

  it("a && b == c parses as a && (b == c) — comparison is tighter than &&", (): void => {
    const ast = parseProgram("a && b == c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "And",
          left: { kind: "PathExpression", path: { segments: ["a"] } },
          right: {
            kind: "BinaryExpression",
            operator: "Eq",
            left: { kind: "PathExpression", path: { segments: ["b"] } },
            right: { kind: "PathExpression", path: { segments: ["c"] } },
          },
        },
      ],
    });
  });

  it("a == b + c * d parses as a == (b + (c * d)) — chain across three levels", (): void => {
    const ast = parseProgram("a == b + c * d");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Eq",
          left: { kind: "PathExpression", path: { segments: ["a"] } },
          right: {
            kind: "BinaryExpression",
            operator: "Add",
            left: { kind: "PathExpression", path: { segments: ["b"] } },
            right: {
              kind: "BinaryExpression",
              operator: "Mul",
              left: { kind: "PathExpression", path: { segments: ["c"] } },
              right: { kind: "PathExpression", path: { segments: ["d"] } },
            },
          },
        },
      ],
    });
  });

  it("a | b & c parses as a | (b & c) — BitAnd is tighter than BitOr", (): void => {
    const ast = parseProgram("a | b & c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "BitOr",
          left: { kind: "PathExpression", path: { segments: ["a"] } },
          right: {
            kind: "BinaryExpression",
            operator: "BitAnd",
            left: { kind: "PathExpression", path: { segments: ["b"] } },
            right: { kind: "PathExpression", path: { segments: ["c"] } },
          },
        },
      ],
    });
  });

  it("a ^ b | c parses as (a ^ b) | c — BitXor is tighter than BitOr", (): void => {
    const ast = parseProgram("a ^ b | c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "BitOr",
          left: {
            kind: "BinaryExpression",
            operator: "BitXor",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });

  it("a + b << c parses as (a + b) << c — Add is tighter than Shl", (): void => {
    const ast = parseProgram("a + b << c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Shl",
          left: {
            kind: "BinaryExpression",
            operator: "Add",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });
});

describe("left-associativity", (): void => {
  it("1 - 2 - 3 parses as (1 - 2) - 3, not 1 - (2 - 3)", (): void => {
    const ast = parseProgram("1 - 2 - 3");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Sub",
          left: {
            kind: "BinaryExpression",
            operator: "Sub",
            left: { kind: "IntLiteral", value: "1" },
            right: { kind: "IntLiteral", value: "2" },
          },
          right: { kind: "IntLiteral", value: "3" },
        },
      ],
    });
  });

  it("8 / 4 / 2 parses as (8 / 4) / 2", (): void => {
    const ast = parseProgram("8 / 4 / 2");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Div",
          left: {
            kind: "BinaryExpression",
            operator: "Div",
            left: { kind: "IntLiteral", value: "8" },
            right: { kind: "IntLiteral", value: "4" },
          },
          right: { kind: "IntLiteral", value: "2" },
        },
      ],
    });
  });

  it("a && b && c parses as (a && b) && c", (): void => {
    const ast = parseProgram("a && b && c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "And",
          left: {
            kind: "BinaryExpression",
            operator: "And",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });

  it("a || b || c parses as (a || b) || c", (): void => {
    const ast = parseProgram("a || b || c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Or",
          left: {
            kind: "BinaryExpression",
            operator: "Or",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });

  it("a | b | c parses as (a | b) | c", (): void => {
    const ast = parseProgram("a | b | c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "BitOr",
          left: {
            kind: "BinaryExpression",
            operator: "BitOr",
          },
          right: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });
});

describe("right-associativity — assignment", (): void => {
  it("x = 1 parses as AssignExpression", (): void => {
    const ast = parseProgram("x = 1");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "AssignExpression",
          lhs: { kind: "PathExpression", path: { segments: ["x"] } },
          rhs: { kind: "IntLiteral", value: "1" },
        },
      ],
    });
  });

  it("a = b = 0 is right-associative: a = (b = 0)", (): void => {
    const ast = parseProgram("a = b = 0");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "AssignExpression",
          lhs: { kind: "PathExpression", path: { segments: ["a"] } },
          rhs: {
            kind: "AssignExpression",
            lhs: { kind: "PathExpression", path: { segments: ["b"] } },
            rhs: { kind: "IntLiteral", value: "0" },
          },
        },
      ],
    });
  });

  const COMPOUND_ASSIGN_EXPRESSIONS: readonly [string, string][] = [
    ["+=", "AddAssign"],
    ["-=", "SubAssign"],
    ["*=", "MulAssign"],
    ["/=", "DivAssign"],
    ["%=", "RemAssign"],
    ["&=", "BitAndAssign"],
    ["|=", "BitOrAssign"],
    ["^=", "BitXorAssign"],
    ["<<=", "ShlAssign"],
    [">>=", "ShrAssign"],
  ];
  it.each(COMPOUND_ASSIGN_EXPRESSIONS)(
    "x %s 1 parses as CompoundAssignExpression with operator %s",
    (op, expectedOperator) => {
      const ast = parseProgram(`x ${op} 1`);
      expect(ast).toMatchObject({
        items: [
          {
            kind: "CompoundAssignExpression",
            operator: expectedOperator,
            lhs: { kind: "PathExpression", path: { segments: ["x"] } },
            rhs: { kind: "IntLiteral", value: "1" },
          },
        ],
      });
    },
  );

  it.todo("if x = y { } is a parse success and a type error");
});

describe("non-associative operators — comparison", (): void => {
  const NON_ASSOCIATIVE_OPERATORS: readonly [string, string][] = [
    ["a < b < c", "<"],
    ["a > b > c", ">"],
    ["a <= b <= c", "<="],
    ["a >= b >= c", ">="],
    ["a == b == c", "=="],
    ["a != b != c", "!="],
  ];
  it.each(NON_ASSOCIATIVE_OPERATORS)(
    '"%s" is a syntax error (non-associative)',
    (source, op) => {
      const result = parse(tokenize(source).tokens);
      expect(result.program).toEqual(none());
      expect(result.diagnostics[0]?.message).toContain("cannot chain");
      expect(result.diagnostics[0]?.message).toContain(op);
    },
  );

  it("a < b > c is a syntax error — chaining different comparison operators", (): void => {
    const result = parse(tokenize("a < b > c").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "cannot chain '<' with '>'",
    );
  });

  it("a < b == c is a syntax error — mixing non-associative operators at the same precedence level", (): void => {
    const result = parse(tokenize("a < b == c").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "cannot chain '<' with '=='",
    );
  });

  it("a == b != c is a syntax error", (): void => {
    const result = parse(tokenize("a == b != c").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(
      "cannot chain '==' with '!='",
    );
  });
});

describe("unary expressions", (): void => {
  it("!a parses as UnaryExpression with Not", (): void => {
    const ast = parseProgram("!a");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "UnaryExpression",
          operator: "Not",
          operand: { kind: "PathExpression", path: { segments: ["a"] } },
        },
      ],
    });
  });

  it("-1 parses as UnaryExpression with Neg", (): void => {
    const ast = parseProgram("-1");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "UnaryExpression",
          operator: "Neg",
          operand: { kind: "IntLiteral", value: "1" },
        },
      ],
    });
  });

  it("!!a chains as Not(Not(a))", (): void => {
    const ast = parseProgram("!!a");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "UnaryExpression",
          operator: "Not",
          operand: {
            kind: "UnaryExpression",
            operator: "Not",
            operand: { kind: "PathExpression", path: { segments: ["a"] } },
          },
        },
      ],
    });
  });

  it("-a * b parses as (-a) * b — unary prefix is tighter than multiplicative", (): void => {
    const ast = parseProgram("-a * b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Mul",
          left: {
            kind: "UnaryExpression",
            operator: "Neg",
            operand: { kind: "PathExpression", path: { segments: ["a"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["b"] } },
        },
      ],
    });
  });

  it("!a || b parses as (!a) || b — unary prefix is tighter than logical", (): void => {
    const ast = parseProgram("!a || b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Or",
          left: {
            kind: "UnaryExpression",
            operator: "Not",
            operand: { kind: "PathExpression", path: { segments: ["a"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["b"] } },
        },
      ],
    });
  });

  it("-a + -b parses as (-a) + (-b)", (): void => {
    const ast = parseProgram("-a + -b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: {
            kind: "UnaryExpression",
            operator: "Neg",
            operand: { kind: "PathExpression", path: { segments: ["a"] } },
          },
          right: {
            kind: "UnaryExpression",
            operator: "Neg",
            operand: { kind: "PathExpression", path: { segments: ["b"] } },
          },
        },
      ],
    });
  });
});

describe("grouping — transparent", (): void => {
  it("(1 + 2) * 3 parses as Mul(Add(1, 2), 3) with no GroupExpression node", (): void => {
    const ast = parseProgram("(1 + 2) * 3");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Mul",
          left: {
            kind: "BinaryExpression",
            operator: "Add",
            left: { kind: "IntLiteral", value: "1" },
            right: { kind: "IntLiteral", value: "2" },
          },
          right: { kind: "IntLiteral", value: "3" },
        },
      ],
    });
  });

  it("1 * (2 + 3) parses as Mul(1, Add(2, 3))", (): void => {
    const ast = parseProgram("1 * (2 + 3)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Mul",
          left: { kind: "IntLiteral", value: "1" },
          right: {
            kind: "BinaryExpression",
            operator: "Add",
            left: { kind: "IntLiteral", value: "2" },
            right: { kind: "IntLiteral", value: "3" },
          },
        },
      ],
    });
  });

  it("((a)) parses as a plain PathExpression — nested parens leave no trace", (): void => {
    const ast = parseProgram("((a))");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "PathExpression",
          path: { absolute: false, segments: ["a"] },
        },
      ],
    });
  });
});

describe("call expression interactions", (): void => {
  it("f() + 1 parses as Add(Call(f), 1)", (): void => {
    const ast = parseProgram("f() + 1");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: {
            kind: "CallExpression",
            callee: { kind: "PathExpression", path: { segments: ["f"] } },
            arguments: [],
          },
          right: { kind: "IntLiteral", value: "1" },
        },
      ],
    });
  });

  it("f(1 + 2) passes a binary expression as an argument", (): void => {
    const ast = parseProgram("f(1 + 2)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          callee: { kind: "PathExpression", path: { segments: ["f"] } },
          arguments: [
            {
              kind: "BinaryExpression",
              operator: "Add",
              left: { kind: "IntLiteral", value: "1" },
              right: { kind: "IntLiteral", value: "2" },
            },
          ],
        },
      ],
    });
  });

  it("f(a, b * c) passes multiple arguments, one containing a binary expression", (): void => {
    const ast = parseProgram("f(a, b * c)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          arguments: [
            { kind: "PathExpression", path: { segments: ["a"] } },
            {
              kind: "BinaryExpression",
              operator: "Mul",
              left: { kind: "PathExpression", path: { segments: ["b"] } },
              right: { kind: "PathExpression", path: { segments: ["c"] } },
            },
          ],
        },
      ],
    });
  });

  it("f()(g()) chains calls — inner call is an argument to the outer result", (): void => {
    const ast = parseProgram("f()(g())");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          callee: {
            kind: "CallExpression",
            callee: { kind: "PathExpression", path: { segments: ["f"] } },
            arguments: [],
          },
          arguments: [
            {
              kind: "CallExpression",
              callee: { kind: "PathExpression", path: { segments: ["g"] } },
              arguments: [],
            },
          ],
        },
      ],
    });
  });
});

describe("field access", (): void => {
  it("a.b parses as FieldAccessExpression", (): void => {
    const ast = parseProgram("a.b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "FieldAccessExpression",
          object: { kind: "PathExpression", path: { segments: ["a"] } },
          field: { kind: "Identifier", text: "b" },
        },
      ],
    });
  });

  it("a.b.c chains left-associatively as FieldAccess(FieldAccess(a, b), c)", (): void => {
    const ast = parseProgram("a.b.c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "FieldAccessExpression",
          object: {
            kind: "FieldAccessExpression",
            object: { kind: "PathExpression", path: { segments: ["a"] } },
            field: { kind: "Identifier", text: "b" },
          },
          field: { kind: "Identifier", text: "c" },
        },
      ],
    });
  });

  it("a.b + c.d — field access is tighter than addition", (): void => {
    const ast = parseProgram("a.b + c.d");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: {
            kind: "FieldAccessExpression",
            object: { kind: "PathExpression", path: { segments: ["a"] } },
            field: { kind: "Identifier", text: "b" },
          },
          right: {
            kind: "FieldAccessExpression",
            object: { kind: "PathExpression", path: { segments: ["c"] } },
            field: { kind: "Identifier", text: "d" },
          },
        },
      ],
    });
  });

  it("f().x — call and field access at the same precedence level, left-to-right", (): void => {
    const ast = parseProgram("f().x");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "FieldAccessExpression",
          object: {
            kind: "CallExpression",
            callee: { kind: "PathExpression", path: { segments: ["f"] } },
            arguments: [],
          },
          field: { kind: "Identifier", text: "x" },
        },
      ],
    });
  });

  it("a.b() — field access followed by call parses as Call(FieldAccess(a, b), [])", (): void => {
    const ast = parseProgram("a.b()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          callee: {
            kind: "FieldAccessExpression",
            object: { kind: "PathExpression", path: { segments: ["a"] } },
            field: { kind: "Identifier", text: "b" },
          },
          arguments: [],
        },
      ],
    });
  });

  it("a.b * 2 + c.d — mixed precedence with field access at the tightest level", (): void => {
    const ast = parseProgram("a.b * 2 + c.d");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: {
            kind: "BinaryExpression",
            operator: "Mul",
            left: {
              kind: "FieldAccessExpression",
              object: { path: { segments: ["a"] } },
              field: { text: "b" },
            },
            right: { kind: "IntLiteral", value: "2" },
          },
          right: {
            kind: "FieldAccessExpression",
            object: { path: { segments: ["c"] } },
            field: { text: "d" },
          },
        },
      ],
    });
  });
});

describe("ranges — deferred", (): void => {
  it.todo("a..b parses as RangeExpression");
  it.todo("a..=b parses as an inclusive RangeExpression");
  it.todo("a..b..c is a syntax error (non-associative)");
});

describe("adversarial / edge cases", (): void => {
  it("trailing binary operator with no RHS is an error", (): void => {
    const result = parse(tokenize("1 +").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("Expected");
  });

  it("a = b < c parses as Assign(a, Lt(b, c)) — lvalue check is semantic, not syntactic", (): void => {
    const ast = parseProgram("a = b < c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "AssignExpression",
          lhs: { kind: "PathExpression", path: { segments: ["a"] } },
          rhs: {
            kind: "BinaryExpression",
            operator: "Lt",
            left: { kind: "PathExpression", path: { segments: ["b"] } },
            right: { kind: "PathExpression", path: { segments: ["c"] } },
          },
        },
      ],
    });
  });

  it("a < b = c parses as Assign(Lt(a, b), c) — assignment is looser than comparison", (): void => {
    const ast = parseProgram("a < b = c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "AssignExpression",
          lhs: {
            kind: "BinaryExpression",
            operator: "Lt",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          },
          rhs: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });

  it("1 + 2 = 3 parses as Assign(Add(1, 2), 3) — parser does not enforce lvalue", (): void => {
    const ast = parseProgram("1 + 2 = 3");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "AssignExpression",
          lhs: {
            kind: "BinaryExpression",
            operator: "Add",
          },
          rhs: { kind: "IntLiteral", value: "3" },
        },
      ],
    });
  });

  it("bare - at EOF is an error", (): void => {
    const result = parse(tokenize("-").tokens);
    expect(result.program).toEqual(none());
  });

  it("bare ! at EOF is an error", (): void => {
    const result = parse(tokenize("!").tokens);
    expect(result.program).toEqual(none());
  });

  it("a. with no field name is an error that mentions identifier", (): void => {
    const result = parse(tokenize("a.").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("identifier");
  });

  it("(1 + 2 with no closing paren is an error that mentions )", (): void => {
    const result = parse(tokenize("(1 + 2").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(")");
  });
});
