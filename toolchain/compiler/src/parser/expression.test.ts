import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { isSome, none, some } from "../option.js";
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

  it("a.b() — method call syntax parses as MethodCallExpression", (): void => {
    const ast = parseProgram("a.b()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          receiver: { kind: "PathExpression", path: { segments: ["a"] } },
          method: { kind: "Identifier", text: "b" },
          arguments: [],
        },
      ],
    });
  });

  it("(a.b)(c) — explicit field extraction then call is CallExpression, not MethodCallExpression", (): void => {
    const ast = parseProgram("(a.b)(c)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          callee: {
            kind: "FieldAccessExpression",
            object: { kind: "PathExpression", path: { segments: ["a"] } },
            field: { kind: "Identifier", text: "b" },
          },
          arguments: [{ kind: "PathExpression", path: { segments: ["c"] } }],
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

describe("if expressions", (): void => {
  it("if true { 1 } — no else, block with trailing expression", (): void => {
    const ast = parseProgram("if true { 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: { kind: "BoolLiteral", value: true },
          thenBranch: {
            kind: "Block",
            statements: [],
            trailingExpression: some({ kind: "IntLiteral", value: "1" }),
          },
          elseBranch: none(),
        },
      ],
    });
  });

  it("if cond { a } else { b } — both branches present", (): void => {
    const ast = parseProgram("if cond { a } else { b }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: { kind: "PathExpression", path: { segments: ["cond"] } },
          thenBranch: {
            kind: "Block",
            trailingExpression: some({
              kind: "PathExpression",
              path: { segments: ["a"] },
            }),
          },
          elseBranch: some({
            kind: "Block",
            trailingExpression: some({
              kind: "PathExpression",
              path: { segments: ["b"] },
            }),
          }),
        },
      ],
    });
  });

  it("if a { 1 } else if b { 2 } else { 3 } — else branch is IfExpression, not a desugared block", (): void => {
    const ast = parseProgram("if a { 1 } else if b { 2 } else { 3 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: { kind: "PathExpression", path: { segments: ["a"] } },
          elseBranch: some({
            kind: "IfExpression",
            condition: { kind: "PathExpression", path: { segments: ["b"] } },
            thenBranch: {
              kind: "Block",
              trailingExpression: some({ kind: "IntLiteral", value: "2" }),
            },
            elseBranch: some({
              kind: "Block",
              trailingExpression: some({ kind: "IntLiteral", value: "3" }),
            }),
          }),
        },
      ],
    });
  });

  it("if a { 1 } else if b { 2 } — else-if chain without terminal else", (): void => {
    const ast = parseProgram("if a { 1 } else if b { 2 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          elseBranch: some({
            kind: "IfExpression",
            elseBranch: none(),
          }),
        },
      ],
    });
  });

  it("let x = if cond { 1 } else { 2 }; — if expression as let initializer", (): void => {
    const ast = parseProgram("let x = if cond { 1 } else { 2 };");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          initializer: some({ kind: "IfExpression" }),
        },
      ],
    });
  });

  it("if a + b > 0 { x } — compound binary condition", (): void => {
    const ast = parseProgram("if a + b > 0 { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "BinaryExpression",
            operator: "Gt",
            left: { kind: "BinaryExpression", operator: "Add" },
            right: { kind: "IntLiteral", value: "0" },
          },
        },
      ],
    });
  });

  it("if !flag { } — unary prefix in condition", (): void => {
    const ast = parseProgram("if !flag { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "UnaryExpression",
            operator: "Not",
            operand: { kind: "PathExpression", path: { segments: ["flag"] } },
          },
          thenBranch: {
            kind: "Block",
            statements: [],
            trailingExpression: none(),
          },
        },
      ],
    });
  });

  it("if a && b || c { } — logical operators retain correct precedence in condition", (): void => {
    const ast = parseProgram("if a && b || c { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "BinaryExpression",
            operator: "Or",
            left: { kind: "BinaryExpression", operator: "And" },
            right: { kind: "PathExpression", path: { segments: ["c"] } },
          },
        },
      ],
    });
  });

  it("if outer { if inner { 1 } else { 2 } } else { 3 } — nested if expressions", (): void => {
    const ast = parseProgram(
      "if outer { if inner { 1 } else { 2 } } else { 3 }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          thenBranch: {
            kind: "Block",
            trailingExpression: some({ kind: "IfExpression" }),
          },
          elseBranch: some({ kind: "Block" }),
        },
      ],
    });
  });

  it("if cond {} else {} — empty branches both yield unit blocks", (): void => {
    const ast = parseProgram("if cond {} else {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          thenBranch: {
            kind: "Block",
            statements: [],
            trailingExpression: none(),
          },
          elseBranch: some({
            kind: "Block",
            statements: [],
            trailingExpression: none(),
          }),
        },
      ],
    });
  });

  it("if { let x = 1; x > 0 } { result } — block expression as condition is valid", (): void => {
    const ast = parseProgram("if { let x = 1; x > 0 } { result }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "Block",
            trailingExpression: some({
              kind: "BinaryExpression",
              operator: "Gt",
            }),
          },
        },
      ],
    });
  });

  it("if (Foo { x: 1 }).flag { body } — struct expr inside parens is allowed as condition", (): void => {
    const ast = parseProgram("if (Foo { x: 1 }).flag { body }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "FieldAccessExpression",
            object: { kind: "StructExpression" },
            field: { text: "flag" },
          },
        },
      ],
    });
  });

  it("if cond { Foo { x: 1 } } — struct expr in branch body is allowed", (): void => {
    const ast = parseProgram("if cond { Foo { x: 1 } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          thenBranch: {
            kind: "Block",
            trailingExpression: some({ kind: "StructExpression" }),
          },
        },
      ],
    });
  });

  it("if Foo { x: 1 } { body } — struct expr as direct if condition is a parse error", (): void => {
    const result = parse(tokenize("if Foo { x: 1 } { body }").tokens);
    expect(result.program).toEqual(none());
  });

  it("if cond is missing then-block — error", (): void => {
    const result = parse(tokenize("if cond").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("{");
  });

  it("if cond { a } else with no block — error", (): void => {
    const result = parse(tokenize("if cond { a } else 42").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("block expressions", (): void => {
  it("{ } — empty block yields unit (no trailing expression)", (): void => {
    const ast = parseProgram("{ }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [],
          trailingExpression: none(),
        },
      ],
    });
  });

  it("{ let x = 1; } — block ending in statement yields unit", (): void => {
    const ast = parseProgram("{ let x = 1; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [{ kind: "LetStatement" }],
          trailingExpression: none(),
        },
      ],
    });
  });

  it("{ let x = 1; x } — block with trailing expression yields that expression", (): void => {
    const ast = parseProgram("{ let x = 1; x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [{ kind: "LetStatement" }],
          trailingExpression: some({
            kind: "PathExpression",
            path: { segments: ["x"] },
          }),
        },
      ],
    });
  });

  it("{ 1; } — expression followed by semicolon becomes a statement, no trailing expression", (): void => {
    const ast = parseProgram("{ 1; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [{ kind: "ExpressionStatement" }],
          trailingExpression: none(),
        },
      ],
    });
  });

  it("{ 1 } — integer literal as trailing expression", (): void => {
    const ast = parseProgram("{ 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [],
          trailingExpression: some({ kind: "IntLiteral", value: "1" }),
        },
      ],
    });
  });

  it("let x = { 1 + 2 }; — block expression as let initializer", (): void => {
    const ast = parseProgram("let x = { 1 + 2 };");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          initializer: some({
            kind: "Block",
            trailingExpression: some({
              kind: "BinaryExpression",
              operator: "Add",
            }),
          }),
        },
      ],
    });
  });

  it("{ { 1 } } — inner block is the trailing expression of outer block", (): void => {
    const ast = parseProgram("{ { 1 } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [],
          trailingExpression: some({
            kind: "Block",
            trailingExpression: some({ kind: "IntLiteral", value: "1" }),
          }),
        },
      ],
    });
  });

  it("{ 1 with no closing brace is an error", (): void => {
    const result = parse(tokenize("{ 1").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("}");
  });
});

describe("tuple expressions and unit", (): void => {
  it("() — unit is a zero-element TupleExpression", (): void => {
    const ast = parseProgram("()");
    expect(ast).toMatchObject({
      items: [{ kind: "TupleExpression", elements: [] }],
    });
  });

  it("(1,) — single-element tuple requires trailing comma to disambiguate from grouping", (): void => {
    const ast = parseProgram("(1,)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "TupleExpression",
          elements: [{ kind: "IntLiteral", value: "1" }],
        },
      ],
    });
  });

  it("(1, 2) — two-element tuple", (): void => {
    const ast = parseProgram("(1, 2)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "TupleExpression",
          elements: [
            { kind: "IntLiteral", value: "1" },
            { kind: "IntLiteral", value: "2" },
          ],
        },
      ],
    });
  });

  it("(1, 2,) — trailing comma on multi-element tuple is accepted", (): void => {
    const ast = parseProgram("(1, 2,)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "TupleExpression",
          elements: [{ kind: "IntLiteral" }, { kind: "IntLiteral" }],
        },
      ],
    });
  });

  it("(1) — single expression without trailing comma is transparent grouping", (): void => {
    const ast = parseProgram("(1)");
    expect(ast).toMatchObject({
      items: [{ kind: "IntLiteral", value: "1" }],
    });
    const item = ast.items[0];
    assert(item !== undefined);
    expect(item.kind).not.toBe("TupleExpression");
  });

  it("((1, 2), 3) — nested tuple", (): void => {
    const ast = parseProgram("((1, 2), 3)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "TupleExpression",
          elements: [
            {
              kind: "TupleExpression",
              elements: [{ kind: "IntLiteral" }, { kind: "IntLiteral" }],
            },
            { kind: "IntLiteral", value: "3" },
          ],
        },
      ],
    });
  });

  it("(a + b, c * d) — expressions as tuple elements", (): void => {
    const ast = parseProgram("(a + b, c * d)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "TupleExpression",
          elements: [
            { kind: "BinaryExpression", operator: "Add" },
            { kind: "BinaryExpression", operator: "Mul" },
          ],
        },
      ],
    });
  });

  it("let u: () = (); — unit type annotation with unit initializer", (): void => {
    const ast = parseProgram("let u: () = ();");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          type: some({ kind: "UnitType" }),
          initializer: some({ kind: "TupleExpression", elements: [] }),
        },
      ],
    });
  });

  it("(1, with no closing paren is an error", (): void => {
    const result = parse(tokenize("(1,").tokens);
    expect(result.program).toEqual(none());
  });

  it("(1 2) — missing comma between tuple elements is an error", (): void => {
    const result = parse(tokenize("(1 2)").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        message: "Expected ',' or ')' after expression in parentheses",
      },
    ]);
  });
});

describe("index expressions", (): void => {
  it("a[0] — simple integer index", (): void => {
    const ast = parseProgram("a[0]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          object: { kind: "PathExpression", path: { segments: ["a"] } },
          index: { kind: "IntLiteral", value: "0" },
        },
      ],
    });
  });

  it("a[b + c] — expression as index", (): void => {
    const ast = parseProgram("a[b + c]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          object: { kind: "PathExpression", path: { segments: ["a"] } },
          index: { kind: "BinaryExpression", operator: "Add" },
        },
      ],
    });
  });

  it("a[b][c] — index is left-associative", (): void => {
    const ast = parseProgram("a[b][c]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          object: {
            kind: "IndexExpression",
            object: { kind: "PathExpression", path: { segments: ["a"] } },
            index: { kind: "PathExpression", path: { segments: ["b"] } },
          },
          index: { kind: "PathExpression", path: { segments: ["c"] } },
        },
      ],
    });
  });

  it("a[b.c] — field access as index", (): void => {
    const ast = parseProgram("a[b.c]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          index: {
            kind: "FieldAccessExpression",
            object: { path: { segments: ["b"] } },
            field: { text: "c" },
          },
        },
      ],
    });
  });

  it("f()[0] — index on a call result", (): void => {
    const ast = parseProgram("f()[0]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          object: {
            kind: "CallExpression",
            callee: { path: { segments: ["f"] } },
          },
          index: { kind: "IntLiteral", value: "0" },
        },
      ],
    });
  });

  it("a[b] * 2 — index binds tighter than multiplication", (): void => {
    const ast = parseProgram("a[b] * 2");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Mul",
          left: { kind: "IndexExpression" },
          right: { kind: "IntLiteral", value: "2" },
        },
      ],
    });
  });

  it("a[ with no closing bracket is an error", (): void => {
    const result = parse(tokenize("a[").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("]");
  });

  it("a[] — empty index expression is an error", (): void => {
    const result = parse(tokenize("a[]").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("method call expressions", (): void => {
  it("a.method() — no-arg method call", (): void => {
    const ast = parseProgram("a.method()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          receiver: { kind: "PathExpression", path: { segments: ["a"] } },
          method: { kind: "Identifier", text: "method" },
          arguments: [],
        },
      ],
    });
  });

  it("a.method(b, c) — method call with arguments", (): void => {
    const ast = parseProgram("a.method(b, c)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          receiver: { kind: "PathExpression", path: { segments: ["a"] } },
          method: { kind: "Identifier", text: "method" },
          arguments: [
            { kind: "PathExpression", path: { segments: ["b"] } },
            { kind: "PathExpression", path: { segments: ["c"] } },
          ],
        },
      ],
    });
  });

  it("a.method(b, c,) — trailing comma in method arguments is accepted", (): void => {
    const ast = parseProgram("a.method(b, c,)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          arguments: [{ kind: "PathExpression" }, { kind: "PathExpression" }],
        },
      ],
    });
  });

  it("a.b.method() — receiver is a FieldAccessExpression", (): void => {
    const ast = parseProgram("a.b.method()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          receiver: {
            kind: "FieldAccessExpression",
            object: { kind: "PathExpression", path: { segments: ["a"] } },
            field: { text: "b" },
          },
          method: { text: "method" },
        },
      ],
    });
  });

  it("a.method().field — method call result used in field access", (): void => {
    const ast = parseProgram("a.method().field");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "FieldAccessExpression",
          object: {
            kind: "MethodCallExpression",
            receiver: { path: { segments: ["a"] } },
            method: { text: "method" },
          },
          field: { text: "field" },
        },
      ],
    });
  });

  it("a.method().other() — chained method calls", (): void => {
    const ast = parseProgram("a.method().other()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          receiver: { kind: "MethodCallExpression" },
          method: { text: "other" },
        },
      ],
    });
  });

  it("(a + b).method() — grouped expression as receiver", (): void => {
    const ast = parseProgram("(a + b).method()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          receiver: { kind: "BinaryExpression", operator: "Add" },
          method: { text: "method" },
        },
      ],
    });
  });

  it("a.b — plain field access is still FieldAccessExpression", (): void => {
    const ast = parseProgram("a.b");
    expect(ast).toMatchObject({
      items: [{ kind: "FieldAccessExpression" }],
    });
  });

  it("a.method( with unclosed args is an error", (): void => {
    const result = parse(tokenize("a.method(").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(")");
  });
});

describe("turbofish guardrail", (): void => {
  it("first::<i32>(xs) produces a Slice-1 diagnostic, not an ambiguous parse", (): void => {
    const { program, diagnostics } = parse(
      tokenize("first::<i32>(xs);").tokens,
    );
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("turbofish");
  });

  it("x.foo::<T>() produces a Slice-1 diagnostic on a method call", (): void => {
    const { program, diagnostics } = parse(tokenize("x.foo::<T>();").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("turbofish");
  });

  it("first::<>() — empty turbofish is still rejected", (): void => {
    const { program, diagnostics } = parse(tokenize("first::<>();").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("turbofish");
  });

  it("a::b::<T>() — turbofish after a multi-segment path is rejected", (): void => {
    const { program, diagnostics } = parse(tokenize("a::b::<T>();").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 1");
    expect(diagnostics[0].message).toContain("turbofish");
  });

  it("turbofish diagnostic span covers the :: token", (): void => {
    const { tokens } = tokenize("first::<i32>(xs);");
    const pathSep = tokens.find((t) => t.kind === "path_sep");
    assert(pathSep !== undefined, "Expected to find a path_sep token");
    const { diagnostics } = parse(tokens);
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].span).toEqual(some(pathSep.span));
  });

  it("first::<'a>() produces a lifetime-specific diagnostic", (): void => {
    const { program, diagnostics } = parse(tokenize("first::<'a>();").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
  });

  it("first::<T>() still produces the generic-Slice-4 diagnostic (regression)", (): void => {
    const { program, diagnostics } = parse(tokenize("first::<T>();").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 4");
    expect(diagnostics[0].message).not.toContain("lifetime");
  });

  it("first::<T, 'a>() falls back to the generic-Slice-4 diagnostic (lifetime not listed first)", (): void => {
    const { program, diagnostics } = parse(
      tokenize("first::<T, 'a>();").tokens,
    );
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 4");
    expect(diagnostics[0].message).not.toContain("lifetime");
  });
});

describe("comparison expressions unaffected by turbofish guardrail", (): void => {
  it("a < b — plain comparison is unaffected", (): void => {
    const ast = parseProgram("a < b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Lt" }],
    });
  });

  it("a < b > c — still the existing non-assoc chain error, not the turbofish diagnostic", (): void => {
    const { program, diagnostics } = parse(tokenize("a < b > c").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("cannot chain");
    expect(diagnostics[0].message).not.toContain("Slice 1");
    expect(diagnostics[0].message).not.toContain("turbofish");
    expect(diagnostics[0].message).not.toContain("generic");
  });

  it("if x < y { } — comparison in condition position is unaffected", (): void => {
    const ast = parseProgram("if x < y { }");
    expect(ast).toMatchObject({
      items: [{ kind: "IfExpression" }],
    });
  });

  it("a << b — shift is unaffected", (): void => {
    const ast = parseProgram("a << b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Shl" }],
    });
  });

  it("a >> b — shift is unaffected", (): void => {
    const ast = parseProgram("a >> b");
    expect(ast).toMatchObject({
      items: [{ kind: "BinaryExpression", operator: "Shr" }],
    });
  });

  it("foo < bar — a bare path (no ::) followed by < is comparison, not a misdetected turbofish", (): void => {
    const ast = parseProgram("foo < bar");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Lt",
          left: { kind: "PathExpression", path: { segments: ["foo"] } },
          right: { kind: "PathExpression", path: { segments: ["bar"] } },
        },
      ],
    });
  });
});

describe("struct expressions", (): void => {
  it("Foo {} — empty struct expression", (): void => {
    const ast = parseProgram("Foo {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          path: { segments: ["Foo"] },
          fields: [],
          base: none(),
        },
      ],
    });
  });

  it("Foo { x: 1 } — single explicit field", (): void => {
    const ast = parseProgram("Foo { x: 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          path: { segments: ["Foo"] },
          fields: [
            {
              kind: "FieldInit",
              name: { text: "x" },
              value: some({ kind: "IntLiteral", value: "1" }),
            },
          ],
          base: none(),
        },
      ],
    });
  });

  it("Foo { x: 1, y: 2 } — multiple fields", (): void => {
    const ast = parseProgram("Foo { x: 1, y: 2 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          fields: [
            {
              name: { text: "x" },
              value: some({ kind: "IntLiteral", value: "1" }),
            },
            {
              name: { text: "y" },
              value: some({ kind: "IntLiteral", value: "2" }),
            },
          ],
        },
      ],
    });
  });

  it("Foo { x: 1, y: 2, } — trailing comma is accepted", (): void => {
    const ast = parseProgram("Foo { x: 1, y: 2, }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          fields: [{ name: { text: "x" } }, { name: { text: "y" } }],
        },
      ],
    });
  });

  it("Foo { x } — shorthand field initializer (value is none)", (): void => {
    const ast = parseProgram("Foo { x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          fields: [
            {
              kind: "FieldInit",
              name: { text: "x" },
              value: none(),
            },
          ],
        },
      ],
    });
  });

  it("Foo { x: 1, ..base } — struct update spread is parsed; base captured", (): void => {
    const ast = parseProgram("Foo { x: 1, ..base }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          fields: [{ name: { text: "x" } }],
          base: some({ kind: "PathExpression", path: { segments: ["base"] } }),
        },
      ],
    });
  });

  it("Foo { x: 1, ..base } — struct update spread emits a not-yet-supported diagnostic", (): void => {
    const result = parse(tokenize("Foo { x: 1, ..base }").tokens);
    expect(
      result.diagnostics.some((d) => d.message.toLowerCase().includes("not")),
    ).toBe(true);
  });

  it("ns::Foo { x: 1 } — qualified path in struct expression", (): void => {
    const ast = parseProgram("ns::Foo { x: 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          path: { segments: ["ns", "Foo"] },
        },
      ],
    });
  });

  it("Foo { x: 1, ..base, y: 2 } — spread must be last field; error otherwise", (): void => {
    const result = parse(tokenize("Foo { x: 1, ..base, y: 2 }").tokens);
    expect(result.program).toEqual(none());
  });

  it("Foo { x: 1 with no closing brace is an error", (): void => {
    const result = parse(tokenize("Foo { x: 1").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("}");
  });
});

describe("composition / integration", (): void => {
  it("a[i].field — index then field access", (): void => {
    const ast = parseProgram("a[i].field");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "FieldAccessExpression",
          object: {
            kind: "IndexExpression",
            object: { path: { segments: ["a"] } },
            index: { path: { segments: ["i"] } },
          },
          field: { text: "field" },
        },
      ],
    });
  });

  it("a.method()[i] — method call result used as index base", (): void => {
    const ast = parseProgram("a.method()[i]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          object: { kind: "MethodCallExpression" },
          index: { path: { segments: ["i"] } },
        },
      ],
    });
  });

  it("if cond { a[i] } else { b.c } — complex expressions in if branches", (): void => {
    const ast = parseProgram("if cond { a[i] } else { b.c }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          thenBranch: { trailingExpression: some({ kind: "IndexExpression" }) },
          elseBranch: some({
            trailingExpression: some({ kind: "FieldAccessExpression" }),
          }),
        },
      ],
    });
  });

  it("{ let t = (1, 2); t } — tuple in block expression", (): void => {
    const ast = parseProgram("{ let t = (1, 2); t }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Block",
          statements: [
            {
              kind: "LetStatement",
              initializer: some({
                kind: "TupleExpression",
                elements: [{}, {}],
              }),
            },
          ],
          trailingExpression: some({ kind: "PathExpression" }),
        },
      ],
    });
  });

  it("f(Foo { x: 1 }) — struct expression as function argument is allowed", (): void => {
    const ast = parseProgram("f(Foo { x: 1 })");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          callee: { path: { segments: ["f"] } },
          arguments: [
            { kind: "StructExpression", path: { segments: ["Foo"] } },
          ],
        },
      ],
    });
  });

  it("a.method(b[0], Foo { x: c }) — mixed argument types", (): void => {
    const ast = parseProgram("a.method(b[0], Foo { x: c })");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MethodCallExpression",
          arguments: [
            { kind: "IndexExpression" },
            { kind: "StructExpression" },
          ],
        },
      ],
    });
  });

  it.todo(
    "(1, 2).0 — tuple element access via DecInt field (requires FieldAccess to accept IntLiteral)",
  );
});
