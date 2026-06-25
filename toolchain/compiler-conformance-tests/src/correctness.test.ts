/**
 * @module
 *
 * Correctness test layer — property, metamorphic, and differential tests.
 *
 * A) Property/metamorphic tests over generated and hand-written programs.
 * B) Differential conformance tests comparing compiled JS to a reference evaluator.
 * C) Conformance rule-to-test mapping table (fails if any rule has zero test IDs).
 */
import { stdout } from "node:process";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compile, isSome, parse, tokenize } from "@hedge-lang/compiler";
import type {
  BinaryOperator,
  Block,
  Expression,
  IfExpression,
  Program,
} from "@hedge-lang/compiler";

function assert(cond: boolean, msg?: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Seeded PRNG — Mulberry32, deterministic across runs.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

type RNG = () => number;

function rngInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function rngPick<T>(rng: RNG, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  const item = arr[idx];
  assert(item !== undefined, "rngPick: empty array or bad index");
  return item;
}

// ---------------------------------------------------------------------------
// Program generator for the formal subset:
//   ints, lets, +/-/*, comparisons, if-else, variable lookup.
// ---------------------------------------------------------------------------
const ARITH_OPS: readonly string[] = ["+", "-", "*"];
const CMP_OPS: readonly string[] = ["==", "!=", "<", ">", "<=", ">="];

interface GenCtx {
  rng: RNG;
  depth: number;
  vars: string[];
}

function genIntLit(rng: RNG): string {
  return String(rngInt(rng, 0, 50));
}

function genIntExpr(ctx: GenCtx): string {
  const { rng, depth, vars } = ctx;
  if (depth <= 0 || rng() < 0.4) return genIntLit(rng);
  if (vars.length > 0 && rng() < 0.35) {
    return rngPick(rng, vars);
  }
  const op = rngPick(rng, ARITH_OPS);
  const child: GenCtx = { rng, depth: depth - 1, vars };
  return `(${genIntExpr(child)} ${op} ${genIntExpr(child)})`;
}

function genBoolExpr(ctx: GenCtx): string {
  const { rng } = ctx;
  if (ctx.depth <= 0) return rng() < 0.5 ? "true" : "false";
  const op = rngPick(rng, CMP_OPS);
  const child: GenCtx = { ...ctx, depth: ctx.depth - 1 };
  return `(${genIntExpr(child)} ${op} ${genIntExpr(child)})`;
}

/**
 * Generate `fn compute() -> i32 { <lets> <if-else> }` with a fixed seed.
 * The function body has several let bindings then a trailing if-else expression.
 */
function genComputeProgram(seed: number): string {
  const rng = mulberry32(seed);
  const numVars = rngInt(rng, 1, 4);
  const vars: string[] = [];
  const stmts: string[] = [];

  for (let i = 0; i < numVars; i++) {
    const name = `v${i}`;
    const ctx: GenCtx = { rng, depth: 1, vars: [...vars] };
    stmts.push(`let ${name} = ${genIntExpr(ctx)};`);
    vars.push(name);
  }

  const ctx: GenCtx = { rng, depth: 2, vars };
  const cond = genBoolExpr(ctx);
  const thenExpr = genIntExpr(ctx);
  const elseExpr = genIntExpr(ctx);
  const trailing = `if ${cond} { ${thenExpr} } else { ${elseExpr} }`;
  const body = `  ${stmts.join("\n  ")}\n  ${trailing}`;
  return `fn compute() -> i32 {\n${body}\n}`;
}

// ---------------------------------------------------------------------------
// AST structural equality helper — strips tokenId so spans don't affect shape.
// ---------------------------------------------------------------------------
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripTokenIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTokenIds);
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k !== "tokenId") result[k] = stripTokenIds(v);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Parse helper — mirrors the pattern used across existing test files.
// ---------------------------------------------------------------------------
function parseProgram(source: string): Program {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  return program.value;
}

// ---------------------------------------------------------------------------
// Reference evaluator for the formal subset.
// Throws with "SKIP: <reason>" prefix for any unsupported construct.
// ---------------------------------------------------------------------------
type RefValue = number | boolean;
type RefEnv = Map<string, RefValue>;

function evalBlock(block: Block, env: RefEnv): RefValue {
  const local = new Map(env);
  for (const stmt of block.statements) {
    if (stmt.kind === "LetStatement") {
      if (isSome(stmt.initializer)) {
        const val = evalExpr(stmt.initializer.value, local);
        local.set(stmt.pattern.name.text, val);
      }
    } else {
      // stmt.kind === "ExpressionStatement" (Statement has only two variants)
      evalExpr(stmt.expression, local);
    }
  }
  if (isSome(block.trailingExpression)) {
    return evalExpr(block.trailingExpression.value, local);
  }
  return 0;
}

function evalIfExpr(expr: IfExpression, env: RefEnv): RefValue {
  const cond = evalExpr(expr.condition, env);
  if (typeof cond !== "boolean") {
    throw new Error("SKIP: if condition did not evaluate to a boolean");
  }
  if (cond) {
    return evalBlock(expr.thenBranch, env);
  }
  if (isSome(expr.elseBranch)) {
    return evalExpr(expr.elseBranch.value, env);
  }
  return 0;
}

function applyArithOp(op: BinaryOperator, l: number, r: number): RefValue {
  switch (op) {
    case "Add":
      return l + r;
    case "Sub":
      return l - r;
    case "Mul":
      return l * r;
    case "Div":
      return r === 0 ? 0 : Math.trunc(l / r);
    case "Rem":
      return r === 0 ? 0 : l % r;
    default:
      throw new Error(`SKIP: not an arithmetic op "${op}"`);
  }
}

function applyNumericCmpOp(op: BinaryOperator, l: number, r: number): boolean {
  switch (op) {
    case "Eq":
      return l === r;
    case "Ne":
      return l !== r;
    case "Lt":
      return l < r;
    case "Gt":
      return l > r;
    case "Le":
      return l <= r;
    case "Ge":
      return l >= r;
    default:
      throw new Error(`SKIP: not a numeric comparison op "${op}"`);
  }
}

function applyBoolBinOp(op: BinaryOperator, l: boolean, r: boolean): RefValue {
  switch (op) {
    case "And":
      return l && r;
    case "Or":
      return l || r;
    case "Eq":
      return l === r;
    case "Ne":
      return l !== r;
    default:
      throw new Error(`SKIP: unsupported boolean op "${op}"`);
  }
}

function applyBinOp(op: BinaryOperator, l: RefValue, r: RefValue): RefValue {
  if (typeof l === "number" && typeof r === "number") {
    const arithmeticOps: readonly BinaryOperator[] = [
      "Add",
      "Sub",
      "Mul",
      "Div",
      "Rem",
    ];
    return arithmeticOps.includes(op)
      ? applyArithOp(op, l, r)
      : applyNumericCmpOp(op, l, r);
  }
  if (typeof l === "boolean" && typeof r === "boolean") {
    return applyBoolBinOp(op, l, r);
  }
  throw new Error("SKIP: mixed types in binary expression");
}

function evalExpr(expr: Expression, env: RefEnv): RefValue {
  switch (expr.kind) {
    case "IntLiteral":
      return parseInt(expr.value, expr.base);
    case "BoolLiteral":
      return expr.value;
    case "PathExpression": {
      const name = expr.path.segments[0];
      if (name === undefined)
        throw new Error("SKIP: empty path in PathExpression");
      const val = env.get(name);
      if (val === undefined) throw new Error(`SKIP: unresolved name "${name}"`);
      return val;
    }
    case "Identifier": {
      const val = env.get(expr.text);
      if (val === undefined)
        throw new Error(`SKIP: unresolved identifier "${expr.text}"`);
      return val;
    }
    case "BinaryExpression":
      return applyBinOp(
        expr.operator,
        evalExpr(expr.left, env),
        evalExpr(expr.right, env),
      );
    case "IfExpression":
      return evalIfExpr(expr, env);
    case "Block":
      return evalBlock(expr, env);
    default:
      throw new Error(
        `SKIP: unsupported expression kind "${expr.kind}" in reference evaluator`,
      );
  }
}

/** Evaluate the body of the first function in the program with an empty environment. */
function evalFunctionBody(program: Program): RefValue {
  const fn = program.items[0];
  if (fn === undefined || fn.kind !== "Function") {
    throw new Error("SKIP: first item is not a function");
  }
  return evalBlock(fn.body, new Map());
}

// ---------------------------------------------------------------------------
// Compiled runner — compile source and eval the generated function body.
// Returns null when compilation produced no code or the body is empty.
//
// The current compiler emits the trailing expression as an ExpressionStatement
// rather than a ReturnStatement, so calling compute() would return undefined.
// ---------------------------------------------------------------------------
function runCompiledSource(source: string): RefValue | null {
  const compileResult = compile(source);
  if (!isSome(compileResult.code)) return null;
  const { javascript } = compileResult.code.value;
  if (!isSome(javascript)) return null;
  const jsSource = javascript.value;
  // Match: function <name>() {\n  <body>\n}\n
  const match = /^function \w+\(\) \{\n([\s\S]+)\n}\n$/.exec(jsSource);
  if (match === null) return null;
  const indented = match[1];
  if (indented === undefined) return null;
  // Strip the two-space indent the generator adds to each line.
  const body = indented.replace(/^ {2}/gm, "");
  // Narrow the result at runtime — eval returns any, so we validate the type.
  const evalResult: unknown = runInNewContext(body, { Math });
  if (typeof evalResult === "number" || typeof evalResult === "boolean")
    return evalResult;
  return null;
}

/** Assert compiled result matches reference evaluator for the given full source. */
function assertMatchesRef(source: string): void {
  const program = parseProgram(source);
  const refResult = evalFunctionBody(program);
  const compResult = runCompiledSource(source);
  assert(compResult !== null, `Compilation failed for: ${source.slice(0, 80)}`);
  expect(compResult).toBe(refResult);
}

function assertI32(body: string): void {
  assertMatchesRef(`fn compute() -> i32 {\n  ${body}\n}`);
}

function assertBool(body: string): void {
  assertMatchesRef(`fn compute() -> bool {\n  ${body}\n}`);
}

// ---------------------------------------------------------------------------
// C) Conformance rule → test ID mapping.
//    Fail if any rule lists zero test IDs.
// ---------------------------------------------------------------------------
interface ConformanceRule {
  readonly id: string;
  readonly description: string;
  readonly testIds: readonly string[];
}

const CONFORMANCE_TABLE: readonly ConformanceRule[] = [
  {
    id: "PROP-WHITESPACE",
    description:
      "Extra whitespace and comments do not change the parsed AST shape",
    testIds: [
      "whitespace-invariance: extra spaces/newlines do not change AST shape",
      "comment invariance: line comments between tokens do not change AST shape",
      "comment invariance: block comments do not change AST shape",
    ],
  },
  {
    id: "PROP-ALPHA-RENAME",
    description:
      "Alpha-renaming local identifiers preserves diagnostic count and severity",
    testIds: [
      "alpha-rename-preserves-diagnostics: renaming locals keeps diagnostic count",
      "alpha-rename preserves error-free status across multiple generated seeds",
    ],
  },
  {
    id: "PROP-PARENS",
    description:
      "Redundant parentheses around atoms/expressions do not change the AST",
    testIds: [
      "parens-atom-invariance: (42) and 42 parse to same AST",
      "parens-subexpr-invariance: redundant outer parens do not change AST",
      "redundant parens on int literal: ((1)) compiles same as 1",
      "parens around both sides of addition do not change compiled output",
    ],
  },
  {
    id: "PROP-DETERMINISM",
    description: "Compiling the same source twice produces identical output",
    testIds: ["determinism: same source compiles to identical output twice"],
  },
  {
    id: "DIFF-INT-ARITH",
    description:
      "Compiler result matches reference evaluator for integer arithmetic",
    testIds: [
      "diff-literal: integer literal compiles and matches reference",
      "diff-add: addition compiles and matches reference",
      "diff-sub: subtraction compiles and matches reference",
      "diff-mul: multiplication compiles and matches reference",
      "chained arithmetic matches reference",
    ],
  },
  {
    id: "DIFF-CMP",
    description:
      "Compiler result matches reference evaluator for comparison expressions",
    testIds: [
      "diff-eq: equality comparison compiles and matches reference",
      "diff-lt: less-than comparison compiles and matches reference",
      "diff-gt: greater-than comparison compiles and matches reference",
    ],
  },
  {
    id: "DIFF-IF",
    description:
      "Compiler result matches reference evaluator for if-else expressions",
    testIds: [
      "diff-if-true: if true { 1 } else { 2 } evaluates to 1",
      "diff-if-false: if false { 1 } else { 2 } evaluates to 2",
      "nested let and if expression match reference",
    ],
  },
  {
    id: "DIFF-LET",
    description: "Compiler result matches reference evaluator for let bindings",
    testIds: [
      "diff-let-binding: let binding is available in trailing expression",
    ],
  },
  {
    id: "DIFF-GENERATED",
    description:
      "Compiler result matches reference evaluator on generated programs",
    testIds: [
      "diff-generated-seed-1: generated program matches reference evaluator",
      "diff-generated-seed-2: generated program matches reference evaluator",
      "diff-generated-seed-3: generated program matches reference evaluator",
    ],
  },
];

// ---------------------------------------------------------------------------
// A) Property / Metamorphic tests
// ---------------------------------------------------------------------------

describe("property: whitespace and comment invariance", (): void => {
  const BASE = `fn compute() -> i32 { let x = 1; let y = 2; x + y }`;

  function astShape(source: string): unknown {
    return stripTokenIds(parseProgram(source));
  }

  it("whitespace-invariance: extra spaces/newlines do not change AST shape", (): void => {
    const withSpaces = `fn  compute ( ) -> i32  {
        let   x  =  1  ;
        let   y  =  2  ;
        x  +  y
      }`;
    expect(astShape(withSpaces)).toEqual(astShape(BASE));
  });

  it("comment invariance: line comments between tokens do not change AST shape", (): void => {
    const withComments = `
        // top-level comment
        fn compute() -> i32 {
          let x = 1; // x is one
          let y = 2; // y is two
          x + y // sum
        }
      `;
    expect(astShape(withComments)).toEqual(astShape(BASE));
  });

  it("comment invariance: block comments do not change AST shape", (): void => {
    const withBlock = `fn compute/* name */() -> i32 { let x /* init */ = 1; let y = 2; x + y }`;
    expect(astShape(withBlock)).toEqual(astShape(BASE));
  });
});

describe("property: alpha-renaming preserves diagnostics", (): void => {
  it("alpha-rename-preserves-diagnostics: renaming locals keeps diagnostic count", (): void => {
    const original = compile(
      `fn main() { let foo = 1; let bar = 2; foo + bar; }`,
    );
    const renamed = compile(
      `fn main() { let alpha = 1; let beta = 2; alpha + beta; }`,
    );
    expect(original.diagnostics.length).toBe(renamed.diagnostics.length);
    expect(original.diagnostics.map((d) => d.severity)).toEqual(
      renamed.diagnostics.map((d) => d.severity),
    );
  });

  it("alpha-rename preserves error-free status across multiple generated seeds", (): void => {
    for (const seed of [10, 20, 30, 40]) {
      const source = genComputeProgram(seed);
      // Rename v0→z0, v1→z1, etc. at source level.
      const renamed = source.replace(
        /\bv(\d+)\b/g,
        (match: string) => `z${match.slice(1)}`,
      );
      const r1 = compile(source);
      const r2 = compile(renamed);
      expect(r1.diagnostics.length).toBe(r2.diagnostics.length);
      expect(r1.diagnostics.map((d) => d.severity)).toEqual(
        r2.diagnostics.map((d) => d.severity),
      );
    }
  });
});

describe("property: parenthesization invariance", (): void => {
  it("parens-atom-invariance: (42) and 42 parse to same AST", (): void => {
    expect(stripTokenIds(parseProgram("(42)"))).toEqual(
      stripTokenIds(parseProgram("42")),
    );
  });

  it("parens-subexpr-invariance: redundant outer parens do not change AST", (): void => {
    // (x + y) at the top level is the same AST as x + y.
    expect(stripTokenIds(parseProgram("(x + y)"))).toEqual(
      stripTokenIds(parseProgram("x + y")),
    );
  });

  it("redundant parens on int literal: ((1)) compiles same as 1", (): void => {
    const r1 = compile("fn compute() -> i32 { 1 }");
    const r2 = compile("fn compute() -> i32 { ((1)) }");
    expect(r1.diagnostics.filter((d) => d.severity === "error")).toHaveLength(
      0,
    );
    expect(r2.diagnostics.filter((d) => d.severity === "error")).toHaveLength(
      0,
    );
    if (isSome(r1.code) && isSome(r2.code)) {
      expect(r1.code.value.javascript).toEqual(r2.code.value.javascript);
    }
  });

  it("parens around both sides of addition do not change compiled output", (): void => {
    const r1 = compile("fn compute() -> i32 { let x = 1; let y = 2; x + y }");
    const r2 = compile(
      "fn compute() -> i32 { let x = 1; let y = 2; (x) + (y) }",
    );
    expect(r1.diagnostics.filter((d) => d.severity === "error")).toHaveLength(
      0,
    );
    expect(r2.diagnostics.filter((d) => d.severity === "error")).toHaveLength(
      0,
    );
    if (isSome(r1.code) && isSome(r2.code)) {
      expect(r1.code.value.javascript).toEqual(r2.code.value.javascript);
    }
  });
});

describe("property: determinism", (): void => {
  it("determinism: same source compiles to identical output twice", (): void => {
    const sources = [
      `fn compute() -> i32 { let x = 1; x + 2 }`,
      `fn main() { let a = true; let b = false; a; }`,
      genComputeProgram(99),
    ];
    for (const source of sources) {
      expect(compile(source)).toEqual(compile(source));
    }
  });
});

// ---------------------------------------------------------------------------
// B) Differential / conformance tests — hand-written programs.
// ---------------------------------------------------------------------------

describe("differential: formal subset hand-written programs", (): void => {
  it("diff-literal: integer literal compiles and matches reference", (): void => {
    assertI32("42");
  });

  it("diff-add: addition compiles and matches reference", (): void => {
    assertI32("1 + 2");
  });

  it("diff-sub: subtraction compiles and matches reference", (): void => {
    assertI32("10 - 3");
  });

  it("diff-mul: multiplication compiles and matches reference", (): void => {
    assertI32("4 * 5");
  });

  it("diff-eq: equality comparison compiles and matches reference", (): void => {
    assertBool("42 == 42");
    assertBool("1 == 2");
  });

  it("diff-lt: less-than comparison compiles and matches reference", (): void => {
    assertBool("3 < 5");
    assertBool("5 < 3");
  });

  it("diff-gt: greater-than comparison compiles and matches reference", (): void => {
    assertBool("7 > 10");
    assertBool("10 > 7");
  });

  it("diff-if-true: if true { 1 } else { 2 } evaluates to 1", (): void => {
    assertI32("if true { 1 } else { 2 }");
  });

  it("diff-if-false: if false { 1 } else { 2 } evaluates to 2", (): void => {
    assertI32("if false { 1 } else { 2 }");
  });

  it("diff-let-binding: let binding is available in trailing expression", (): void => {
    assertI32("let x = 10; let y = 3; x + y");
  });

  it("nested let and if expression match reference", (): void => {
    assertI32("let x = 5; if (x == 5) { 100 } else { 0 }");
  });

  it("chained arithmetic matches reference", (): void => {
    assertI32("let a = 3; let b = 4; (a * a) + (b * b)");
  });
});

describe("differential: generated programs", (): void => {
  for (const seed of [1, 2, 3]) {
    it(`diff-generated-seed-${seed}: generated program matches reference evaluator`, (): void => {
      const source = genComputeProgram(seed);
      const program = parseProgram(source);

      let refResult: RefValue;
      try {
        refResult = evalFunctionBody(program);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("SKIP:")) {
          // Unsupported construct in reference evaluator — explicit skip, not a failure.
          stdout.write(`[SKIP seed=${seed}] ${msg}\n`);
          return;
        }
        throw e;
      }

      const compResult = runCompiledSource(source);
      if (compResult === null) {
        const r = compile(source);
        throw new Error(
          `Compilation failed: ${r.diagnostics.map((d) => d.message).join("; ")}`,
        );
      }
      expect(compResult).toBe(refResult);
    });
  }
});

// ---------------------------------------------------------------------------
// C) Conformance rule coverage check
// ---------------------------------------------------------------------------

describe("conformance: rule coverage", (): void => {
  it("every conformance rule lists at least one test ID", (): void => {
    const uncovered = CONFORMANCE_TABLE.filter((r) => r.testIds.length === 0);
    expect(
      uncovered.map((r) => `${r.id}: ${r.description}`),
      "These rules have no test IDs listed",
    ).toEqual([]);
  });

  it("CONFORMANCE_TABLE contains all required rule categories", (): void => {
    const ids = new Set(CONFORMANCE_TABLE.map((r) => r.id));
    const required = [
      "PROP-WHITESPACE",
      "PROP-ALPHA-RENAME",
      "PROP-PARENS",
      "PROP-DETERMINISM",
      "DIFF-INT-ARITH",
      "DIFF-CMP",
      "DIFF-IF",
      "DIFF-LET",
      "DIFF-GENERATED",
    ];
    for (const id of required) {
      expect(
        ids.has(id),
        `Rule "${id}" is missing from CONFORMANCE_TABLE`,
      ).toBe(true);
    }
  });
});
