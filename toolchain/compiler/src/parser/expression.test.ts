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

  it("*a + b parses as (*a) + b - dereference is tighter than additive", (): void => {
    const ast = parseProgram("*a + b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "BinaryExpression",
          operator: "Add",
          left: {
            kind: "DereferenceExpression",
            operand: { kind: "PathExpression", path: { segments: ["a"] } },
          },
          right: { kind: "PathExpression", path: { segments: ["b"] } },
        },
      ],
    });
  });

  it("*p.field parses as *(p.field) - field access binds tighter than dereference", (): void => {
    const ast = parseProgram("*p.field");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "DereferenceExpression",
          operand: { kind: "FieldAccessExpression" },
        },
      ],
    });
  });

  it("*f() dereferences a call result", (): void => {
    const ast = parseProgram("*f()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "DereferenceExpression",
          operand: { kind: "CallExpression" },
        },
      ],
    });
  });

  it("foo(*p) passes a dereference as a call argument", (): void => {
    const ast = parseProgram("foo(*p)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          arguments: [{ kind: "DereferenceExpression" }],
        },
      ],
    });
  });

  it("a[*i] uses a dereference as an index expression", (): void => {
    const ast = parseProgram("a[*i]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IndexExpression",
          index: { kind: "DereferenceExpression" },
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

describe("ranges", (): void => {
  it("a..b parses as RangeExpression", (): void => {
    const ast = parseProgram("a..b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          inclusive: false,
          start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
          end: some({ kind: "PathExpression", path: { segments: ["b"] } }),
        },
      ],
    });
  });

  it("a..=b parses as an inclusive RangeExpression", (): void => {
    const ast = parseProgram("a..=b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          inclusive: true,
          start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
          end: some({ kind: "PathExpression", path: { segments: ["b"] } }),
        },
      ],
    });
  });

  it("a..b..c is a syntax error (non-associative)", (): void => {
    const { program, diagnostics } = parse(tokenize("a..b..c").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("cannot chain");
    expect(diagnostics[0].message).toContain("..");
  });

  it("a.. parses as RangeExpression with no end (RangeFrom)", (): void => {
    const ast = parseProgram("a..");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          inclusive: false,
          start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
          end: none(),
        },
      ],
    });
  });

  it("..b parses as RangeExpression with no start (RangeTo)", (): void => {
    const ast = parseProgram("..b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          inclusive: false,
          start: none(),
          end: some({ kind: "PathExpression", path: { segments: ["b"] } }),
        },
      ],
    });
  });

  it("..=b parses as an inclusive RangeExpression with no start (RangeToInclusive)", (): void => {
    const ast = parseProgram("..=b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          inclusive: true,
          start: none(),
          end: some({ kind: "PathExpression", path: { segments: ["b"] } }),
        },
      ],
    });
  });

  it(".. alone parses as a bare RangeExpression (RangeFull)", (): void => {
    const ast = parseProgram("..");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          inclusive: false,
          start: none(),
          end: none(),
        },
      ],
    });
  });

  it("..= alone is a syntax error (inclusive range requires an end)", (): void => {
    const { program, diagnostics } = parse(tokenize("..=").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("..=");
  });

  it("a..= is a syntax error (inclusive range requires an end)", (): void => {
    const { program, diagnostics } = parse(tokenize("a..=").tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("..=");
  });

  it("0..0 (empty range, equal bounds) parses fine", (): void => {
    const ast = parseProgram("0..0");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "IntLiteral", value: "0" }),
          end: some({ kind: "IntLiteral", value: "0" }),
        },
      ],
    });
  });

  it("-5..5 and -5..-5 (negative bounds) parse fine", (): void => {
    const ast1 = parseProgram("-5..5");
    expect(ast1).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "UnaryExpression", operator: "Neg" }),
          end: some({ kind: "IntLiteral", value: "5" }),
        },
      ],
    });

    const ast2 = parseProgram("-5..-5");
    expect(ast2).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "UnaryExpression", operator: "Neg" }),
          end: some({ kind: "UnaryExpression", operator: "Neg" }),
        },
      ],
    });
  });

  it.each([
    ["a..=b..=c", "..="],
    ["a..b..=c", ".."],
    ["a..=b..c", "..="],
  ])('"%s" is a syntax error (cannot chain range operators)', (source) => {
    const { program, diagnostics } = parse(tokenize(source).tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("cannot chain");
  });

  it("(a..b)..c parses as nested Range via parens, consistent with (a < b) < c today", (): void => {
    const ast = parseProgram("(a..b)..c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "RangeExpression" }),
          end: some({ kind: "PathExpression", path: { segments: ["c"] } }),
        },
      ],
    });
  });

  it("a.. * b parses as a range whose end dereferences b", (): void => {
    const ast = parseProgram("a.. * b");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
          end: some({
            kind: "DereferenceExpression",
            operand: { kind: "PathExpression", path: { segments: ["b"] } },
          }),
        },
      ],
    });
  });

  it("if a.. { foo(); }: range is the condition (RangeFrom), body not swallowed", (): void => {
    const ast = parseProgram("if a.. { foo(); }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "RangeExpression",
            start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
            end: none(),
          },
          thenBranch: { kind: "Block" },
        },
      ],
    });
  });

  it("if ..b { foo(); }: range is the condition (RangeTo), body not swallowed", (): void => {
    const ast = parseProgram("if ..b { foo(); }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "RangeExpression",
            start: none(),
            end: some({ kind: "PathExpression", path: { segments: ["b"] } }),
          },
          thenBranch: { kind: "Block" },
        },
      ],
    });
  });

  it("if .. { foo(); }: bare RangeFull condition, body not swallowed", (): void => {
    const ast = parseProgram("if .. { foo(); }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: { kind: "RangeExpression", start: none(), end: none() },
          thenBranch: { kind: "Block" },
        },
      ],
    });
  });

  it("a..{ 5 } outside a condition parses a Block as the range's end (allowStruct is true here, no ambiguity)", (): void => {
    const ast = parseProgram("let r = a..{ 5 };");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "LetStatement",
          initializer: some({
            kind: "RangeExpression",
            start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
            end: some({
              kind: "Block",
              trailingExpression: some({ kind: "IntLiteral", value: "5" }),
            }),
          }),
        },
      ],
    });
  });

  it("foo(a..b): range as a call argument", (): void => {
    const ast = parseProgram("foo(a..b)");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "CallExpression",
          arguments: [{ kind: "RangeExpression" }],
        },
      ],
    });
  });

  it("Point { r: a..b }: range as a struct field value", (): void => {
    const ast = parseProgram("Point { r: a..b }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "StructExpression",
          fields: [
            { name: { text: "r" }, value: some({ kind: "RangeExpression" }) },
          ],
        },
      ],
    });
  });

  it("a.b..c.d: field access as both range operands", (): void => {
    const ast = parseProgram("a.b..c.d");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "FieldAccessExpression" }),
          end: some({ kind: "FieldAccessExpression" }),
        },
      ],
    });
  });

  it("foo()..bar(): call expressions as both range operands", (): void => {
    const ast = parseProgram("foo()..bar()");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "CallExpression" }),
          end: some({ kind: "CallExpression" }),
        },
      ],
    });
  });

  it("a malformed range operand produces exactly one diagnostic, not a cascade", (): void => {
    const { program, diagnostics } = parse(tokenize("a.. *").tokens);
    expect(program).toEqual(none());
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(1);
  });

  it("a || b..c parses as (a || b)..c: range binds looser than ||", (): void => {
    const ast = parseProgram("a || b..c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({
            kind: "BinaryExpression",
            operator: "Or",
            left: { kind: "PathExpression", path: { segments: ["a"] } },
            right: { kind: "PathExpression", path: { segments: ["b"] } },
          }),
          end: some({ kind: "PathExpression", path: { segments: ["c"] } }),
        },
      ],
    });
  });

  it("a..b || c parses as a..(b || c): || binds tighter than range", (): void => {
    const ast = parseProgram("a..b || c");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "RangeExpression",
          start: some({ kind: "PathExpression", path: { segments: ["a"] } }),
          end: some({
            kind: "BinaryExpression",
            operator: "Or",
            left: { kind: "PathExpression", path: { segments: ["b"] } },
            right: { kind: "PathExpression", path: { segments: ["c"] } },
          }),
        },
      ],
    });
  });
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

describe("match expressions", (): void => {
  it("parses `match x {}` as an empty arms array", (): void => {
    const ast = parseProgram("match x {}");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          scrutinee: { kind: "PathExpression", path: { segments: ["x"] } },
          arms: [],
        },
      ],
    });
  });

  it("parses `match x { y => y }` to one arm with a binding pattern", (): void => {
    const ast = parseProgram("match x { y => y }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: {
                kind: "BindingPattern",
                mutable: false,
                name: { text: "y" },
              },
              guard: none(),
              body: { kind: "PathExpression", path: { segments: ["y"] } },
            },
          ],
        },
      ],
    });
  });

  it("parses `match x { _ => 1 }` as one arm with the wildcard pattern", (): void => {
    const ast = parseProgram("match x { _ => 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: { kind: "WildcardPattern" },
              guard: none(),
              body: { kind: "IntLiteral", value: "1" },
            },
          ],
        },
      ],
    });
  });

  it("parses `match x { a => 1, b => 2 }` as multiple arms", (): void => {
    const ast = parseProgram("match x { a => 1, b => 2 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: { kind: "BindingPattern", name: { text: "a" } },
              body: { kind: "IntLiteral", value: "1" },
            },
            {
              kind: "MatchArm",
              pattern: { kind: "BindingPattern", name: { text: "b" } },
              body: { kind: "IntLiteral", value: "2" },
            },
          ],
        },
      ],
    });
  });

  it("accepts a trailing comma after a single arm (`match x { y => y, }`)", (): void => {
    const ast = parseProgram("match x { y => y, }");
    expect(ast).toMatchObject({
      items: [{ kind: "MatchExpression", arms: [{ kind: "MatchArm" }] }],
    });
  });

  it("accepts a trailing comma after the last of several arms (`match x { a => 1, b => 2, }`)", (): void => {
    const ast = parseProgram("match x { a => 1, b => 2, }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [{ kind: "MatchArm" }, { kind: "MatchArm" }],
        },
      ],
    });
  });

  it("rejects a missing comma between two expression-bodied arms with a parse error (`match x { a => 1 b => 2 }`)", (): void => {
    const result = parse(tokenize("match x { a => 1 b => 2 }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain(",");
  });

  it("treats the comma as optional after a block-bodied arm (`match x { a => { 1 } b => 2 }`)", (): void => {
    const ast = parseProgram("match x { a => { 1 } b => 2 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            { pattern: { name: { text: "a" } }, body: { kind: "Block" } },
            {
              pattern: { name: { text: "b" } },
              body: { kind: "IntLiteral", value: "2" },
            },
          ],
        },
      ],
    });
  });

  it("treats the comma as optional after an if-bodied arm (`match x { a => if c { 1 } else { 2 } b => 3 }`)", (): void => {
    const ast = parseProgram("match x { a => if c { 1 } else { 2 } b => 3 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: { name: { text: "a" } },
              body: { kind: "IfExpression" },
            },
            {
              pattern: { name: { text: "b" } },
              body: { kind: "IntLiteral", value: "3" },
            },
          ],
        },
      ],
    });
  });

  it("stores a guard on the arm when present and leaves it absent otherwise (`match x { y if cond => y, _ => 0 }`)", (): void => {
    const ast = parseProgram("match x { y if cond => y, _ => 0 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: { kind: "BindingPattern", name: { text: "y" } },
              guard: some({
                kind: "PathExpression",
                path: { segments: ["cond"] },
              }),
              body: { kind: "PathExpression", path: { segments: ["y"] } },
            },
            {
              kind: "MatchArm",
              pattern: { kind: "WildcardPattern" },
              guard: none(),
              body: { kind: "IntLiteral", value: "0" },
            },
          ],
        },
      ],
    });
  });

  it("accepts a compound boolean expression as a guard (`match x { y if y > 0 && y < 10 => y }`)", (): void => {
    const ast = parseProgram("match x { y if y > 0 && y < 10 => y }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              guard: some({
                kind: "BinaryExpression",
                operator: "And",
              }),
            },
          ],
        },
      ],
    });
  });

  it("produces a clear parse error for a missing '=>' (`match x { y z }`)", (): void => {
    const result = parse(tokenize("match x { y z }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("=>");
  });

  it("produces a clear parse error for a missing '=>' on a later arm (`match x { a => 1, b c }`)", (): void => {
    const result = parse(tokenize("match x { a => 1, b c }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("=>");
  });

  it("produces a clear parse error for a second `if` where '=>' was expected (`match x { y if a if b => y }`)", (): void => {
    const result = parse(tokenize("match x { y if a if b => y }").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("=>");
  });

  it("produces a parse error for a missing arm body (`match x { y => }`)", (): void => {
    const result = parse(tokenize("match x { y => }").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("produces a parse error for a missing scrutinee (`match { y => 1 }`)", (): void => {
    const result = parse(tokenize("match { y => 1 }").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("produces a parse error for a match with no closing brace (`match x { y => 1`)", (): void => {
    const result = parse(tokenize("match x { y => 1").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("}");
  });

  it("does not require a semicolon for a match used as a mid-block statement (`fn f() { match x {} let done = true; }`)", (): void => {
    const ast = parseProgram("fn f() { match x {} let done = true; }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "ExpressionStatement",
                expression: { kind: "MatchExpression" },
              },
              { kind: "LetStatement" },
            ],
          },
        },
      ],
    });
  });
});

describe("Slice 3 pattern kinds - literal patterns", (): void => {
  it("parses a bare int literal pattern in a match arm (`match x { 1 => a, _ => b }`)", (): void => {
    const ast = parseProgram("match x { 1 => a, _ => b }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: {
                kind: "LiteralPattern",
                literal: { kind: "IntLiteral", value: "1" },
              },
            },
            { kind: "MatchArm", pattern: { kind: "WildcardPattern" } },
          ],
        },
      ],
    });
  });

  it("parses a negative int literal pattern (`match x { -1 => a }`)", (): void => {
    const ast = parseProgram("match x { -1 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: {
                kind: "LiteralPattern",
                negative: true,
                literal: { kind: "IntLiteral", value: "1" },
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a negative float literal pattern (`match x { -1.5 => a }`)", (): void => {
    const ast = parseProgram("match x { -1.5 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              kind: "MatchArm",
              pattern: {
                kind: "LiteralPattern",
                negative: true,
                literal: { kind: "FloatLiteral", value: "1.5" },
              },
            },
          ],
        },
      ],
    });
  });

  it("rejects a leading `-` on a non-numeric literal pattern (`match x { -\"hi\" => a, _ => b }`)", (): void => {
    const result = parse(tokenize('match x { -"hi" => a, _ => b }').tokens);
    expect(result.program).toEqual(none());
  });

  it("does not treat a plain positive literal pattern as negative", (): void => {
    const ast = parseProgram("match x { 1 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [{ pattern: { kind: "LiteralPattern", negative: false } }],
        },
      ],
    });
  });
});

describe("Slice 3 pattern kinds - range patterns", (): void => {
  it("parses an inclusive int range pattern (`match x { 1..=5 => a }`)", (): void => {
    const ast = parseProgram("match x { 1..=5 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "RangePattern",
                start: {
                  negative: false,
                  literal: { kind: "IntLiteral", value: "1" },
                },
                end: {
                  negative: false,
                  literal: { kind: "IntLiteral", value: "5" },
                },
              },
            },
          ],
        },
      ],
    });
  });

  it("parses an inclusive char range pattern (`match x { 'a'..='z' => a }`)", (): void => {
    const ast = parseProgram("match x { 'a'..='z' => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "RangePattern",
                start: { negative: false, literal: { value: "a" } },
                end: { negative: false, literal: { value: "z" } },
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a range pattern with negative bounds (`match x { -5..=-1 => a }`)", (): void => {
    const ast = parseProgram("match x { -5..=-1 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "RangePattern",
                start: {
                  negative: true,
                  literal: { kind: "IntLiteral", value: "5" },
                },
                end: {
                  negative: true,
                  literal: { kind: "IntLiteral", value: "1" },
                },
              },
            },
          ],
        },
      ],
    });
  });

  it("produces a parse error for a range pattern missing its end literal (`match x { 1..= => a }`)", (): void => {
    const result = parse(tokenize("match x { 1..= => a }").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("Slice 3 pattern kinds - or-patterns", (): void => {
  it("parses `1 | 2 | 3` as a flat OrPattern with three alternatives, not right-nested", (): void => {
    const ast = parseProgram("match x { 1 | 2 | 3 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "OrPattern",
                alternatives: [
                  {
                    kind: "LiteralPattern",
                    literal: { kind: "IntLiteral", value: "1" },
                  },
                  {
                    kind: "LiteralPattern",
                    literal: { kind: "IntLiteral", value: "2" },
                  },
                  {
                    kind: "LiteralPattern",
                    literal: { kind: "IntLiteral", value: "3" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses `a | b` as an OrPattern of two binding patterns", (): void => {
    const ast = parseProgram("match x { a | b => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "OrPattern",
                alternatives: [
                  { kind: "BindingPattern", name: { text: "a" } },
                  { kind: "BindingPattern", name: { text: "b" } },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("does not wrap a single pattern (no `|`) in an OrPattern", (): void => {
    const ast = parseProgram("match x { 1 => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [{ pattern: { kind: "LiteralPattern" } }],
        },
      ],
    });
  });

  it("produces a parse error for a trailing `|` with nothing after it (`match x { 1 | => a }`)", (): void => {
    const result = parse(tokenize("match x { 1 | => a }").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("Slice 3 pattern kinds - tuple patterns", (): void => {
  it("parses `(a, b)` as a two-element tuple pattern", (): void => {
    const ast = parseProgram("match x { (a, b) => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TuplePattern",
                elements: [
                  { kind: "BindingPattern", name: { text: "a" } },
                  { kind: "BindingPattern", name: { text: "b" } },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses `()` as a zero-element (unit) tuple pattern", (): void => {
    const ast = parseProgram("match x { () => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [{ pattern: { kind: "TuplePattern", elements: [] } }],
        },
      ],
    });
  });

  it("parses `(a,)` as a one-element tuple pattern (trailing comma)", (): void => {
    const ast = parseProgram("match x { (a,) => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TuplePattern",
                elements: [{ kind: "BindingPattern", name: { text: "a" } }],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses `(a)` (no trailing comma) as a one-element tuple pattern too", (): void => {
    const ast = parseProgram("match x { (a) => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TuplePattern",
                elements: [{ kind: "BindingPattern", name: { text: "a" } }],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a tuple pattern with a nested or-pattern element (`(a, 1 | 2)`)", (): void => {
    const ast = parseProgram("match x { (a, 1 | 2) => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TuplePattern",
                elements: [
                  { kind: "BindingPattern", name: { text: "a" } },
                  { kind: "OrPattern", alternatives: [{}, {}] },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("produces a parse error for an unclosed tuple pattern (`match x { (a, b => a }`)", (): void => {
    const result = parse(tokenize("match x { (a, b => a }").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("Slice 3 pattern kinds - tuple-struct and path patterns", (): void => {
  it("parses `Some(x)` as a single-segment tuple-struct pattern", (): void => {
    const ast = parseProgram("match x { Some(x) => x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TupleStructPattern",
                path: { segments: ["Some"] },
                elements: [{ kind: "BindingPattern", name: { text: "x" } }],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses `Message::Move(a, b)` as a multi-segment tuple-struct pattern", (): void => {
    const ast = parseProgram("match x { Message::Move(a, b) => a }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TupleStructPattern",
                path: { segments: ["Message", "Move"] },
                elements: [
                  { kind: "BindingPattern", name: { text: "a" } },
                  { kind: "BindingPattern", name: { text: "b" } },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a nested tuple-struct pattern (`Some(Some(x))`)", (): void => {
    const ast = parseProgram("match x { Some(Some(x)) => x }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "TupleStructPattern",
                path: { segments: ["Some"] },
                elements: [
                  {
                    kind: "TupleStructPattern",
                    path: { segments: ["Some"] },
                    elements: [{ kind: "BindingPattern", name: { text: "x" } }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses `Message::Quit` (no call/braces) as a bare PathPattern", (): void => {
    const ast = parseProgram("match x { Message::Quit => 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: {
                kind: "PathPattern",
                path: { segments: ["Message", "Quit"] },
              },
            },
          ],
        },
      ],
    });
  });

  it("does not promote a bare single-segment identifier to a PathPattern even if it looks like a constant (`MY_CONST`)", (): void => {
    // Hedge has no name resolution at parse time, so a bare single-segment
    // identifier always parses as a fresh BindingPattern - matching or
    // shadowing a same-named constant is a semantic-analysis concern, not
    // this parser's job (see spec 0016 and the grill-me record for #45).
    const ast = parseProgram("match x { MY_CONST => 1 }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "MatchExpression",
          arms: [
            {
              pattern: { kind: "BindingPattern", name: { text: "MY_CONST" } },
            },
          ],
        },
      ],
    });
  });

  it("rejects a byRef sigil applied to a tuple-struct pattern (`&Some(x)`)", (): void => {
    const result = parse(tokenize("match x { &Some(x) => x }").tokens);
    expect(result.program).toEqual(none());
  });

  it("rejects a mut sigil applied to a tuple-struct pattern (`mut Some(x)`)", (): void => {
    const result = parse(tokenize("match x { mut Some(x) => x }").tokens);
    expect(result.program).toEqual(none());
  });

  it("produces a parse error for an unclosed tuple-struct pattern (`match x { Some(x => x }`)", (): void => {
    const result = parse(tokenize("match x { Some(x => x }").tokens);
    expect(result.program).toEqual(none());
  });
});

describe("if let expressions", (): void => {
  it("parses an if-let with no else into a LetExpression condition (`if let y = expr { }`)", (): void => {
    const ast = parseProgram("if let y = expr { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "LetExpression",
            pattern: {
              kind: "BindingPattern",
              mutable: false,
              name: { text: "y" },
            },
            scrutinee: { kind: "PathExpression", path: { segments: ["expr"] } },
          },
          thenBranch: { kind: "Block" },
          elseBranch: none(),
        },
      ],
    });
  });

  it("parses an if-let's else block when present (`if let y = expr { } else { }`)", (): void => {
    const ast = parseProgram("if let y = expr { a } else { b }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: { kind: "LetExpression" },
          elseBranch: some({ kind: "Block" }),
        },
      ],
    });
  });

  it("accepts a wildcard pattern in an if-let (`if let _ = expr { }`)", (): void => {
    const ast = parseProgram("if let _ = expr { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "LetExpression",
            pattern: { kind: "WildcardPattern" },
          },
        },
      ],
    });
  });

  it("accepts a mutable binding pattern in an if-let (`if let mut y = expr { }`)", (): void => {
    const ast = parseProgram("if let mut y = expr { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "LetExpression",
            pattern: { kind: "BindingPattern", mutable: true },
          },
        },
      ],
    });
  });

  it("produces a parse error for an if-let with a missing block (`if let y = expr;`)", (): void => {
    const result = parse(tokenize("if let y = expr;").tokens);
    expect(result.program).toEqual(none());
    expect(result.diagnostics[0]?.message).toContain("{");
  });

  it("produces a parse error for an if-let with a missing '=' (`if let y expr { }`)", (): void => {
    const result = parse(tokenize("if let y expr { }").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("produces a parse error for an if-let with a missing pattern (`if let = expr { }`)", (): void => {
    const result = parse(tokenize("if let = expr { }").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });
});

describe("if / if let chaining", (): void => {
  it("chains if-let, else-if-let, else-if, and else into one nested structure (`if let a = e1 {} else if let b = e2 {} else if c {} else {}`)", (): void => {
    const ast = parseProgram(
      "if let a = e1 { } else if let b = e2 { } else if c { } else { }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: {
            kind: "LetExpression",
            pattern: { name: { text: "a" } },
          },
          elseBranch: some({
            kind: "IfExpression",
            condition: {
              kind: "LetExpression",
              pattern: { name: { text: "b" } },
            },
            elseBranch: some({
              kind: "IfExpression",
              condition: {
                kind: "PathExpression",
                path: { segments: ["c"] },
              },
              elseBranch: some({ kind: "Block" }),
            }),
          }),
        },
      ],
    });
  });

  it("chains a plain if into an else-if-let (`if c { } else if let p = e { }`)", (): void => {
    const ast = parseProgram("if c { } else if let p = e { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "IfExpression",
          condition: { kind: "PathExpression", path: { segments: ["c"] } },
          elseBranch: some({
            kind: "IfExpression",
            condition: {
              kind: "LetExpression",
              pattern: { name: { text: "p" } },
            },
            elseBranch: none(),
          }),
        },
      ],
    });
  });

  it("ends an if-let/else-if-let chain with no final else in none() (`if let a = e {} else if let b = e {}`)", (): void => {
    const ast = parseProgram("if let a = e { } else if let b = e { }");
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
});

describe("while let expressions", (): void => {
  it("parses a while-let's condition as a LetExpression and body as a Block (`while let y = expr { }`)", (): void => {
    const ast = parseProgram("while let y = expr { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "WhileExpression",
          condition: {
            kind: "LetExpression",
            pattern: {
              kind: "BindingPattern",
              mutable: false,
              name: { text: "y" },
            },
            scrutinee: { kind: "PathExpression", path: { segments: ["expr"] } },
          },
          body: { kind: "Block" },
        },
      ],
    });
  });

  it("accepts a wildcard pattern in a while-let (`while let _ = expr { }`)", (): void => {
    const ast = parseProgram("while let _ = expr { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "WhileExpression",
          condition: {
            kind: "LetExpression",
            pattern: { kind: "WildcardPattern" },
          },
        },
      ],
    });
  });

  it("accepts a mutable binding pattern in a while-let (`while let mut y = expr { }`)", (): void => {
    const ast = parseProgram("while let mut y = expr { }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "WhileExpression",
          condition: {
            kind: "LetExpression",
            pattern: { kind: "BindingPattern", mutable: true },
          },
        },
      ],
    });
  });

  it("parses a while-let as a block's trailing expression (`fn f() { while let y = g() { h(y) } }`)", (): void => {
    const ast = parseProgram("fn f() { while let y = g() { h(y) } }");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [],
            trailingExpression: some({ kind: "WhileExpression" }),
          },
        },
      ],
    });
  });

  it("does not require a semicolon for a while-let used as a mid-block statement (`fn f() { while let y = g() { h(y) } let done = true; }`)", (): void => {
    const ast = parseProgram(
      "fn f() { while let y = g() { h(y) } let done = true; }",
    );
    expect(ast).toMatchObject({
      items: [
        {
          kind: "Function",
          body: {
            statements: [
              {
                kind: "ExpressionStatement",
                expression: { kind: "WhileExpression" },
              },
              { kind: "LetStatement" },
            ],
          },
        },
      ],
    });
  });

  it("produces a parse error for a while-let with a missing block (`while let y = expr;`)", (): void => {
    const result = parse(tokenize("while let y = expr;").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("produces a parse error for a while-let with a missing '=' (`while let y expr { }`)", (): void => {
    const result = parse(tokenize("while let y expr { }").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });

  it("produces a parse error for a while-let with a missing pattern (`while let = expr { }`)", (): void => {
    const result = parse(tokenize("while let = expr { }").tokens);
    expect(result.program).toEqual(none());
    assert(result.diagnostics[0] !== undefined, "Expected a diagnostic");
  });
});

describe("bare `while`/`loop`/`for` regression after while-let support", (): void => {
  it("still rejects a bare while with the unchanged Slice 6 guardrail (`fn f() { while true { } }`)", (): void => {
    const { tokens } = tokenize("fn f() { while true { } } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[0]?.message).toContain("while");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" }, body: { statements: [] } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("still rejects a label-prefixed while-let with the loop guardrail, since labels remain out of scope (`'outer: while let y = expr { }`)", (): void => {
    const { tokens } = tokenize(
      "fn f() { 'outer: while let y = expr { } } fn g() {}",
    );
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.message).toContain("Slice 1");
    expect(diagnostics[0]?.message).toContain("while");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
  });

  it("still fully rejects a bare loop, unchanged (`fn f() { loop { } }`)", (): void => {
    const { tokens } = tokenize("fn f() { loop { } } fn g() {}");
    const { program, diagnostics } = parse(tokens);
    assert(isSome(program), "Expected a program to come back");
    expect(diagnostics[0]?.message).toContain("loop");
    expect(program.value.items).toMatchObject([
      { kind: "Function", name: { text: "f" } },
      { kind: "Function", name: { text: "g" } },
    ]);
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

describe("array expressions", (): void => {
  it("[1, 2, 3] — list-form array literal", (): void => {
    const ast = parseProgram("[1, 2, 3]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ArrayExpression",
          elements: [
            { kind: "IntLiteral", value: "1" },
            { kind: "IntLiteral", value: "2" },
            { kind: "IntLiteral", value: "3" },
          ],
        },
      ],
    });
  });

  it("[1, 2, 3,] — trailing comma on a list-form array literal is accepted", (): void => {
    const ast = parseProgram("[1, 2, 3,]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ArrayExpression",
          elements: [
            { kind: "IntLiteral" },
            { kind: "IntLiteral" },
            { kind: "IntLiteral" },
          ],
        },
      ],
    });
  });

  it("[] — empty list-form array literal parses with zero elements", (): void => {
    const ast = parseProgram("[]");
    expect(ast).toMatchObject({
      items: [{ kind: "ArrayExpression", elements: [] }],
    });
  });

  it("[0; 5] — repeat-form array literal", (): void => {
    const ast = parseProgram("[0; 5]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ArrayRepeatExpression",
          value: { kind: "IntLiteral", value: "0" },
          count: { kind: "IntLiteral", value: "5" },
        },
      ],
    });
  });

  it("[[1, 2], [3, 4]] — nested array literals", (): void => {
    const ast = parseProgram("[[1, 2], [3, 4]]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ArrayExpression",
          elements: [
            {
              kind: "ArrayExpression",
              elements: [{ kind: "IntLiteral" }, { kind: "IntLiteral" }],
            },
            {
              kind: "ArrayExpression",
              elements: [{ kind: "IntLiteral" }, { kind: "IntLiteral" }],
            },
          ],
        },
      ],
    });
  });

  it("[a + b, c * d] — expressions as array elements", (): void => {
    const ast = parseProgram("[a + b, c * d]");
    expect(ast).toMatchObject({
      items: [
        {
          kind: "ArrayExpression",
          elements: [
            { kind: "BinaryExpression", operator: "Add" },
            { kind: "BinaryExpression", operator: "Mul" },
          ],
        },
      ],
    });
  });

  it("[1, with no closing bracket is an error", (): void => {
    const result = parse(tokenize("[1,").tokens);
    expect(result.program).toEqual(none());
  });

  it("[1 2] — missing comma between array elements is an error", (): void => {
    const result = parse(tokenize("[1 2]").tokens);
    expect(result.program).toEqual(none());
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
    const { tokens } = tokenize("first::<'a>();");
    const pathSep = tokens.find((t) => t.kind === "path_sep");
    assert(pathSep !== undefined, "Expected to find a path_sep token");
    const { program, diagnostics } = parse(tokens);
    expect(program).toEqual(none());
    assert(diagnostics[0] !== undefined, "Expected diagnostics");
    expect(diagnostics[0].message).toContain("Slice 2");
    expect(diagnostics[0].message).toContain("lifetime");
    expect(diagnostics[0].span).toEqual(some(pathSep.span));
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
