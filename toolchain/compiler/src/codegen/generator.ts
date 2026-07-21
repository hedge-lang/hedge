import { assert, assertNever } from "../assert.js";
import { isSome, mapSome, none, some, unwrapSomeOr } from "../option.js";
import type {
  AssignOperator,
  BinaryOperator,
  NumericKind,
  UnaryOperator,
  BlockStatement,
  ConstDecl,
  DisposeCallStatement,
  DocComment,
  Expression,
  FunctionDecl,
  IfStatement,
  Item,
  LetStatement,
  Program,
  ReturnStatement,
  Statement,
  StaticDecl,
} from "../jsim/ast.js";
import type { Code, SourceMapMapping } from "./output.js";

const BINARY_OPS: Record<BinaryOperator, string> = {
  Add: "+",
  Sub: "-",
  Mul: "*",
  Div: "/",
  Rem: "%",
  Shl: "<<",
  Shr: ">>",
  BitAnd: "&",
  BitXor: "^",
  BitOr: "|",
  Eq: "===",
  Ne: "!==",
  Lt: "<",
  Gt: ">",
  Le: "<=",
  Ge: ">=",
  And: "&&",
  Or: "||",
};

const UNARY_OPS: Record<UnaryOperator, string> = {
  Neg: "-",
  Not: "!",
};

const ASSIGN_OPS: Record<AssignOperator, string> = {
  Assign: "=",
  AddAssign: "+=",
  SubAssign: "-=",
  MulAssign: "*=",
  DivAssign: "/=",
  RemAssign: "%=",
  BitAndAssign: "&=",
  BitOrAssign: "|=",
  BitXorAssign: "^=",
  ShlAssign: "<<=",
  ShrAssign: ">>=",
};

type PrecKey =
  | "BooleanLiteral"
  | "StringLiteral"
  | "NumberLiteral"
  | "PathExpression"
  | "CallExpression"
  | "UnaryExpression"
  | "AssignExpression"
  | "FieldAccessExpression"
  | "Identifier"
  | "MethodCallExpression"
  | "ArrowFunctionExpression"
  | "IndexExpression"
  | "TupleExpression"
  | "ArrayExpression"
  | "ArrayRepeatExpression"
  | "RangeExpression"
  | "StructExpression"
  | "RefCellExpression"
  | BinaryOperator;

// Ascending precedence: earlier entries bind looser → more likely to need parens.
// Atoms (literals, identifiers, etc.) are absent; levelOf returns PREC_LEVELS.length,
// placing them above everything (they never need parens in any position).
const PREC_LEVELS: ReadonlyArray<readonly PrecKey[]> = [
  ["ArrowFunctionExpression", "AssignExpression"],
  ["Or"],
  ["And"],
  ["BitOr"],
  ["BitXor"],
  ["BitAnd"],
  ["Eq", "Ne"],
  ["Lt", "Gt", "Le", "Ge"],
  ["Shl", "Shr"],
  ["Add", "Sub"],
  ["Mul", "Div", "Rem"],
  ["UnaryExpression"],
  [
    "CallExpression",
    "MethodCallExpression",
    "FieldAccessExpression",
    "IndexExpression",
  ],
];

function levelOf(key: PrecKey): number {
  const idx = PREC_LEVELS.findIndex((group) => group.some((k) => k === key));
  return idx === -1 ? PREC_LEVELS.length : idx;
}

function precKey(expr: Expression): PrecKey {
  if (expr.kind === "BinaryExpression") return expr.operator;
  return expr.kind;
}

// Left operand of a left-assoc op: same level is fine (x + y + z → no parens on `x + y`)
function needsAtLeast(expr: Expression, levelKey: PrecKey): string {
  const s = emitExpression(expr);
  return levelOf(precKey(expr)) < levelOf(levelKey) ? `(${s})` : s;
}

// Right operand of a left-assoc op: same level must be parenthesised (x + (y + z))
function needsStrictlyAbove(expr: Expression, levelKey: PrecKey): string {
  const s = emitExpression(expr);
  return levelOf(precKey(expr)) <= levelOf(levelKey) ? `(${s})` : s;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line: string): string => (line === "" ? line : `  ${line}`))
    .join("\n");
}

function emitDocComment(doc: DocComment, isModule: boolean = false): string {
  const lines = doc.text.split("\n");
  const body = isModule
    ? ["@module", ...lines].map((l) => ` * ${l}`)
    : lines.map((l) => ` * ${l}`);
  return ["/**", ...body, " */"].join("\n");
}

// eslint-disable-next-line complexity -- Routing function: one branch per numeric kind × op
function emitNumericBinaryOp(
  nk: NumericKind,
  op: BinaryOperator,
  l: string,
  r: string,
): string {
  const isDivision = op === "Div" || op === "Rem";
  const jsOp = BINARY_OPS[op];
  const zero = nk.kind === "bigint" ? "0n" : "0";
  // Floats follow IEEE 754 (division by zero yields Infinity/NaN); the
  // zero-guard is only needed for integer and bigint types.
  const needsZeroGuard = isDivision && nk.kind !== "float";
  const inner = needsZeroGuard
    ? `((_l, _r) => _r === ${zero} ? (() => { throw new RangeError("attempt to divide by zero"); })() : _l ${jsOp} _r)(${l}, ${r})`
    : `${l} ${jsOp} ${r}`;

  switch (nk.kind) {
    case "signed":
      if (nk.bits === 32) {
        return `((${inner})|0)`;
      }
      return `(((${inner}) << ${32 - nk.bits}) >> ${32 - nk.bits})`;
    case "unsigned":
      if (nk.bits === 32) return `((${inner})>>>0)`;
      return `((${inner})&${(1 << nk.bits) - 1})`;
    case "bigint":
      return nk.signed
        ? `BigInt.asIntN(64,${inner})`
        : `BigInt.asUintN(64,${inner})`;
    case "float":
      return nk.bits === 32 ? `Math.fround(${inner})` : `(${inner})`;
    default:
      assertNever(nk, `Unexpected numeric kind: ${JSON.stringify(nk)}`);
  }
}

function emitNumericUnaryOp(nk: NumericKind, inner: string): string {
  switch (nk.kind) {
    case "signed":
      if (nk.bits === 32) return `((${inner})|0)`;
      return `(((${inner}) << ${32 - nk.bits}) >> ${32 - nk.bits})`;
    case "unsigned":
      if (nk.bits === 32) return `((${inner})>>>0)`;
      return `((${inner})&${(1 << nk.bits) - 1})`;
    case "bigint":
      return nk.signed
        ? `BigInt.asIntN(64,${inner})`
        : `BigInt.asUintN(64,${inner})`;
    case "float":
      return nk.bits === 32 ? `Math.fround(${inner})` : `(${inner})`;
    default:
      assertNever(nk, `Unexpected numeric kind: ${JSON.stringify(nk)}`);
  }
}

/**
 * `[T; N]` is move-only (never `Copy`, even when `T` is - see
 * `semantics/type-capabilities.ts`'s own note on why), so every array
 * reaching scope end without being moved needs disposing like any other
 * move-only value. A bare JS `Array`/`TypedArray` has no `[Symbol.dispose]`
 * of its own, so every array construction attaches one via this shared
 * helper - emitted once per compiled program, only when an array is
 * actually constructed (see `generate`'s own `usesArrayDisposeHelper`
 * check). The disposer recursively disposes each element that has its own
 * `[Symbol.dispose]` (a nested array, or a struct - every struct literal
 * always emits one, even if a no-op, see `StructExpression` codegen below) -
 * an element type with neither (every primitive) is a no-op.
 */
const ARRAY_DISPOSE_HELPER_NAME = "__hedgeDisposeArray";
const ARRAY_DISPOSE_HELPER = `function ${ARRAY_DISPOSE_HELPER_NAME}(arr) {
  arr[Symbol.dispose] = function () {
    for (const el of arr) {
      if (el != null && typeof el[Symbol.dispose] === "function") {
        el[Symbol.dispose]();
      }
    }
  };
  return arr;
}`;

/**
 * Wraps an array index access (read via `IndexExpression`, or write via
 * `AssignExpression`'s own special-cased lhs handling) in the same
 * zero-guard IIFE shape `emitNumericBinaryOp` already uses for division -
 * out-of-range panics with a `RangeError` instead of silently returning
 * `undefined` (a read) or growing a plain `Array` with holes (a write).
 * `accessExpr` is the already-built `_arr`/`_i`-referencing access (a bare
 * read, or a full assignment like `_arr[_i] += v`) so both call sites share
 * one bounds check instead of duplicating the read/write shapes twice each.
 */
const ARRAY_INDEX_OUT_OF_RANGE_CONDITION = "_i < 0 || _i >= _arr.length";
const ARRAY_INDEX_OUT_OF_RANGE_THROW =
  'throw new RangeError("index out of bounds")';

function indexBoundsCheck(
  object: string,
  index: string,
  accessExpr: string,
): string {
  return `((_arr, _i) => ${ARRAY_INDEX_OUT_OF_RANGE_CONDITION} ? (() => { ${ARRAY_INDEX_OUT_OF_RANGE_THROW}; })() : (${accessExpr}))(${object}, ${index})`;
}

/**
 * Selects the `TypedArray` constructor backing a numeric-element `[T; N]`
 * (spec section 0012: `Vec<u8>`/`[u8; N]` is a `Uint8Array`,
 * `Vec<i32>`/`[i32; N]` an `Int32Array`, and so on). A non-numeric element
 * type uses a plain `Array` instead - see the
 * `ArrayExpression`/`ArrayRepeatExpression` codegen cases below.
 */
function typedArrayConstructor(nk: NumericKind): string {
  switch (nk.kind) {
    case "signed":
      if (nk.bits === 8) return "Int8Array";
      if (nk.bits === 16) return "Int16Array";
      return "Int32Array";
    case "unsigned":
      if (nk.bits === 8) return "Uint8Array";
      if (nk.bits === 16) return "Uint16Array";
      return "Uint32Array";
    case "bigint":
      return nk.signed ? "BigInt64Array" : "BigUint64Array";
    case "float":
      return nk.bits === 32 ? "Float32Array" : "Float64Array";
    default:
      return assertNever(nk, `Unexpected numeric kind: ${JSON.stringify(nk)}`);
  }
}

// eslint-disable-next-line complexity -- This is a routing function
function emitExpression(expression: Expression): string {
  switch (expression.kind) {
    case "BooleanLiteral":
      return expression.value ? "true" : "false";
    case "StringLiteral":
      return JSON.stringify(expression.value);
    case "NumberLiteral":
      return expression.value;
    case "Identifier":
      return expression.value;
    case "PathExpression":
      return expression.path.join(".");
    case "CallExpression": {
      const args = expression.arguments.map(emitExpression).join(", ");
      // `(0, a.b)(c)` detaches `this` so the callee runs without an implicit
      // receiver, distinguishing it from MethodCallExpression in JS semantics.
      const k = expression.callee.kind;
      const callee =
        k === "FieldAccessExpression" || k === "IndexExpression"
          ? `(0, ${emitExpression(expression.callee)})`
          : needsAtLeast(expression.callee, "CallExpression");
      return `${callee}(${args})`;
    }
    case "BinaryExpression": {
      const { operator: op, left, right, numericKind } = expression;
      const l = needsAtLeast(left, op);
      const r = needsStrictlyAbove(right, op);
      if (isSome(numericKind)) {
        return emitNumericBinaryOp(numericKind.value, op, l, r);
      }
      return `${l} ${BINARY_OPS[op]} ${r}`;
    }
    case "UnaryExpression": {
      const operand = needsAtLeast(expression.operand, "UnaryExpression");
      const inner = `${UNARY_OPS[expression.operator]}${operand}`;
      if (isSome(expression.numericKind)) {
        return emitNumericUnaryOp(expression.numericKind.value, inner);
      }
      return `(${inner})`;
    }
    case "AssignExpression": {
      if (
        expression.lhs.kind === "IndexExpression" &&
        expression.lhs.isArrayIndex
      ) {
        const object = emitExpression(expression.lhs.object);
        const index = emitExpression(expression.lhs.index);
        const rhs = emitExpression(expression.rhs);
        const op = ASSIGN_OPS[expression.operator];
        return indexBoundsCheck(object, index, `_arr[_i] ${op} ${rhs}`);
      }
      return `${emitExpression(expression.lhs)} ${ASSIGN_OPS[expression.operator]} ${emitExpression(expression.rhs)}`;
    }
    case "FieldAccessExpression":
      return `${needsAtLeast(expression.object, "FieldAccessExpression")}.${expression.field}`;
    case "MethodCallExpression":
      return `${needsAtLeast(expression.receiver, "MethodCallExpression")}.${expression.method}(${expression.arguments.map(emitExpression).join(", ")})`;
    case "ArrowFunctionExpression": {
      const params = expression.params.join(", ");
      const lines = expression.body
        .map(emitStatement)
        .filter((s) => s.length > 0);
      const body =
        lines.length === 0 ? "{}" : `{\n${lines.map(indent).join("\n")}\n}`;
      return `(${params}) => ${body}`;
    }
    case "IndexExpression": {
      const object = needsAtLeast(expression.object, "IndexExpression");
      const index = emitExpression(expression.index);
      return expression.isArrayIndex
        ? indexBoundsCheck(object, index, "_arr[_i]")
        : `${object}[${index}]`;
    }
    case "TupleExpression":
      return `[${expression.elements.map(emitExpression).join(", ")}]`;
    case "ArrayExpression": {
      const elements = `[${expression.elements.map(emitExpression).join(", ")}]`;
      const value = isSome(expression.numericKind)
        ? `new ${typedArrayConstructor(expression.numericKind.value)}(${elements})`
        : elements;
      return `${ARRAY_DISPOSE_HELPER_NAME}(${value})`;
    }
    case "ArrayRepeatExpression": {
      const ctor = isSome(expression.numericKind)
        ? typedArrayConstructor(expression.numericKind.value)
        : "Array";
      const value = `new ${ctor}(${String(expression.count)}).fill(${emitExpression(expression.value)})`;
      return `${ARRAY_DISPOSE_HELPER_NAME}(${value})`;
    }
    case "StructExpression": {
      const fields = expression.fields.map((f) =>
        f.kind === "SpreadExpression"
          ? `...${emitExpression(f.expression)}`
          : unwrapSomeOr(
              mapSome(f.value, (fValue) => {
                const fName = f.name;
                const emittedExpression = emitExpression(fValue);
                return emittedExpression === fName
                  ? fName
                  : `${fName}: ${emittedExpression}`;
              }),
              f.name,
            ),
      );
      // Every struct value carries a (currently no-op) disposer, so any
      // binding for it can uniformly lower to `using`. Slice 1 has no
      // trait/`impl` support yet, so there is no way to write a custom
      // `Drop` for a struct; this establishes the codegen shape a later
      // slice's real Drop impls will fill in.
      return `({${[...fields, "[Symbol.dispose]() {}"].join(", ")}})`;
    }
    case "RefCellExpression": {
      const place = expression.place;
      // A dynamic array-index place's emitted text is a bounds-check call
      // expression, not an assignable target, so reusing it as
      // `${place} = nv` crashes. Capturing `arr`/`i` once in a wrapping IIFE
      // fixes that and pins the reference to the index's value at borrow
      // time, instead of re-evaluating `i` on every access.
      if (place.kind === "IndexExpression" && place.isArrayIndex) {
        const object = emitExpression(place.object);
        const index = emitExpression(place.index);
        return `((_arr, _i) => { if (${ARRAY_INDEX_OUT_OF_RANGE_CONDITION}) { ${ARRAY_INDEX_OUT_OF_RANGE_THROW}; } return { get v() { return _arr[_i]; }, set v(nv) { _arr[_i] = nv; } }; })(${object}, ${index})`;
      }
      const placeText = emitExpression(place);
      return `({ get v() { return ${placeText}; }, set v(nv) { ${placeText} = nv; } })`;
    }
    case "RangeExpression": {
      const parts = [
        ...(isSome(expression.start)
          ? [`start: ${emitExpression(expression.start.value)}`]
          : []),
        ...(isSome(expression.end)
          ? [`end: ${emitExpression(expression.end.value)}`]
          : []),
        `inclusive: ${expression.inclusive}`,
      ];
      return `({${parts.join(", ")}})`;
    }
    default:
      assertNever(
        expression,
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

function branchHasReturn(stmts: readonly Statement[]): boolean {
  return stmts.some((s) => s.kind === "ReturnStatement");
}

function emitBranchBlock(
  stmts: readonly Statement[],
  multiline: boolean,
): string {
  const lines = stmts.map(emitStatement).filter((s) => s.length > 0);
  if (lines.length === 0) return "{}";
  if (multiline) return `{\n${lines.map(indent).join("\n")}\n}`;
  return `{ ${lines.join(" ")} }`;
}

function emitIfStatement(stmt: IfStatement): string {
  const cond = emitExpression(stmt.condition);
  const isMultiline =
    branchHasReturn(stmt.thenBranch) ||
    unwrapSomeOr(mapSome(stmt.elseBranch, branchHasReturn), false);
  const thenStr = emitBranchBlock(stmt.thenBranch, isMultiline);
  if (!isSome(stmt.elseBranch)) return `if (${cond}) ${thenStr}`;
  const elseStmts = stmt.elseBranch.value;
  if (elseStmts.length === 1 && elseStmts[0]?.kind === "IfStatement") {
    return `if (${cond}) ${thenStr} else ${emitIfStatement(elseStmts[0])}`;
  }
  return `if (${cond}) ${thenStr} else ${emitBranchBlock(elseStmts, isMultiline)}`;
}

function emitBlockStatement(stmt: BlockStatement): string {
  const lines = stmt.body.map(emitStatement).filter((s) => s.length > 0);
  if (lines.length === 0) return "";
  if (lines.length === 1) {
    const line = lines[0];
    assert(line !== undefined, "Expected a single line in block statement");
    return `{ ${line} }`;
  }
  return `{\n${lines.map(indent).join("\n")}\n}`;
}

function emitReturn(stmt: ReturnStatement): string {
  return isSome(stmt.value)
    ? `return ${emitExpression(stmt.value.value)};`
    : `return;`;
}

function letKeyword(statement: LetStatement): string {
  return statement.dispose ? "using" : statement.mutable ? "let" : "const";
}

function emitLet(statement: LetStatement): string {
  if (!statement.mutable && !isSome(statement.value)) return "";
  const value = statement.value;
  return isSome(value)
    ? `${letKeyword(statement)} ${statement.name} = ${emitExpression(value.value)};`
    : `let ${statement.name};`;
}

function emitDisposeCall(statement: DisposeCallStatement): string {
  return `${statement.target}[Symbol.dispose]();`;
}

function emitStatement(statement: Statement): string {
  switch (statement.kind) {
    case "LetStatement":
      return emitLet(statement);
    case "BlockStatement":
      return emitBlockStatement(statement);
    case "IfStatement":
      return emitIfStatement(statement);
    case "ReturnStatement":
      return emitReturn(statement);
    case "DisposeCallStatement":
      return emitDisposeCall(statement);
    case "FunctionDecl":
      return emitFunction(statement);
    default:
      return `${emitExpression(statement)};`;
  }
}

interface EmittedPart {
  readonly text: string;
  /**
   * Offsets relative to this part's own start (0-based), shifted to
   * absolute by `generate`.
   */
  readonly mappings: readonly SourceMapMapping[];
}

/**
 * Emits a function declaration along with source-map mappings for itself
 * and its direct top-level `let` bindings / their binary-expression
 * initializers. Finer mappings (let bindings, binary expressions) are
 * pushed before the coarse whole-function mapping so a first-match lookup
 * prefers the tightest covering entry.
 */
function emitFunctionPart(decl: FunctionDecl): EmittedPart {
  const bodyEntries = decl.body
    .map((stmt) => ({ stmt, text: emitStatement(stmt) }))
    .filter((entry) => entry.text.length > 0);
  const bodyStr =
    bodyEntries.length === 0
      ? "{}"
      : `{\n${bodyEntries.map((e) => indent(e.text)).join("\n")}\n}`;
  const keyword = isSome(decl.scope) ? "export function" : "function";
  const params = decl.params.map((p) => p.name).join(", ");
  const header = `${keyword} ${decl.name}(${params}) `;
  const text = `${header}${bodyStr}`;

  const mappings: SourceMapMapping[] = [];
  // past the header and the body's opening "{\n"
  let cursor = header.length + 2;
  for (const entry of bodyEntries) {
    const line = indent(entry.text);
    if (entry.stmt.kind === "LetStatement") {
      mappings.push({
        generatedStart: cursor,
        generatedEnd: cursor + line.length,
        sourceStart: entry.stmt.span.start,
        sourceEnd: entry.stmt.span.end,
      });
      const value = entry.stmt.value;
      if (isSome(value) && value.value.kind === "BinaryExpression") {
        const binExpr = value.value;
        // `entry.text` is always exactly `${prefix}${exprText};` (see
        // emitLet), so the expression's offset is just the prefix's own
        // length; no need to search for it.
        const prefix = `${letKeyword(entry.stmt)} ${entry.stmt.name} = `;
        const exprStart = cursor + 2 + prefix.length;
        mappings.push({
          generatedStart: exprStart,
          generatedEnd: exprStart + emitExpression(binExpr).length,
          sourceStart: binExpr.span.start,
          sourceEnd: binExpr.span.end,
        });
      }
    } else if (
      entry.stmt.kind === "AssignExpression" &&
      isSome(entry.stmt.span)
    ) {
      mappings.push({
        generatedStart: cursor,
        generatedEnd: cursor + line.length,
        sourceStart: entry.stmt.span.value.start,
        sourceEnd: entry.stmt.span.value.end,
      });
    }
    cursor += line.length + 1; // + the "\n" following this line
  }
  mappings.push({
    generatedStart: 0,
    generatedEnd: text.length,
    sourceStart: decl.span.start,
    sourceEnd: decl.span.end,
  });

  return { text, mappings };
}

function emitFunction(decl: FunctionDecl): string {
  return emitFunctionPart(decl).text;
}

/**
 * A `static` lowers to a module-private backing variable plus an accessor
 * function of its own name that lazily initializes it on first call
 * (`??=` short-circuits after the first real assignment) - avoids the
 * ES-module init-order/circular-import hazard a plain top-level `const`
 * would have (spec 0008). Every reference site is already a `CallExpression`
 * targeting this same name (see `semantics/analyzer.ts`'s
 * `analyzeStaticReference`), so no other codegen path needs to know about
 * statics at all.
 */
function emitStaticPart(decl: StaticDecl): EmittedPart {
  const text = `let ${decl.backingName};\nfunction ${decl.name}() {\n  return ${decl.backingName} ??= ${emitExpression(decl.init)};\n}`;
  return {
    text,
    mappings: [
      {
        generatedStart: 0,
        generatedEnd: text.length,
        sourceStart: decl.span.start,
        sourceEnd: decl.span.end,
      },
    ],
  };
}

/**
 * A `pub const`'s exported JS value - see `jsim/ast.ts`'s `ConstDecl` doc
 * comment for why this exists (a plain-JS consumer needs a real binding,
 * unlike an in-Hedge reference site, which is already inlined).
 */
function emitConstPart(decl: ConstDecl): EmittedPart {
  const text = `export const ${decl.name} = ${emitExpression(decl.value)};`;
  return {
    text,
    mappings: [
      {
        generatedStart: 0,
        generatedEnd: text.length,
        sourceStart: decl.span.start,
        sourceEnd: decl.span.end,
      },
    ],
  };
}

function emitItem(item: Item): string {
  switch (item.kind) {
    case "FunctionDecl":
      return emitFunction(item);
    case "StaticDecl":
      return emitStaticPart(item).text;
    case "ConstDecl":
      return emitConstPart(item).text;
    case "LetStatement":
      return emitLet(item);
    case "BlockStatement":
      return emitBlockStatement(item);
    case "IfStatement":
      return emitIfStatement(item);
    case "ReturnStatement":
      return emitReturn(item);
    case "DisposeCallStatement":
      return emitDisposeCall(item);
    default:
      return `${emitExpression(item)};`;
  }
}

function emitDtsFunction(
  decl: FunctionDecl,
  scope: "public" | "package",
): string {
  const params = decl.params
    .map((p) => `${p.name}: ${isSome(p.type) ? p.type.value.value : "unknown"}`)
    .join(", ");
  const returnType = isSome(decl.returnType)
    ? decl.returnType.value.value
    : "void";
  const declaration = `export declare function ${decl.name}(${params}): ${returnType};`;
  const parts: string[] = [];
  if (scope === "package") {
    const text = isSome(decl.docComment)
      ? `@internal\n${decl.docComment.value.text}`
      : "@internal";
    parts.push(emitDocComment({ kind: "DocComment", text }));
  } else if (isSome(decl.docComment)) {
    parts.push(emitDocComment(decl.docComment.value));
  }
  parts.push(declaration);
  return parts.join("\n");
}

function emitDtsItem(item: Item): string | null {
  if (item.kind === "ConstDecl") {
    return isSome(item.type)
      ? `export declare const ${item.name}: ${item.type.value.value};`
      : null;
  }
  if (item.kind !== "FunctionDecl" || !isSome(item.scope)) {
    return null;
  }
  return emitDtsFunction(item, item.scope.value);
}

function hasMain(program: Program): boolean {
  return program.items.some(
    (item: Item): boolean =>
      item.kind === "FunctionDecl" && item.name === "main",
  );
}

function emitItemParts(program: Program): EmittedPart[] {
  const parts: EmittedPart[] = [];
  for (const item of program.items) {
    if (item.kind === "FunctionDecl") {
      const part = emitFunctionPart(item);
      if (part.text.length > 0) parts.push(part);
      continue;
    }
    if (item.kind === "StaticDecl") {
      parts.push(emitStaticPart(item));
      continue;
    }
    if (item.kind === "ConstDecl") {
      parts.push(emitConstPart(item));
      continue;
    }
    const emitted = emitItem(item);
    if (emitted.length > 0) parts.push({ text: emitted, mappings: [] });
  }
  return parts;
}

function mainEntryPointParts(
  program: Program,
): readonly [shebang: EmittedPart, mainCall: EmittedPart] {
  const mainDecl = program.items.find(
    (item): item is FunctionDecl =>
      item.kind === "FunctionDecl" && item.name === "main",
  );
  const mainCallText = "main();";
  return [
    { text: "#!/usr/bin/env node", mappings: [] },
    {
      text: mainCallText,
      mappings: mainDecl
        ? [
            {
              generatedStart: 0,
              generatedEnd: mainCallText.length,
              sourceStart: mainDecl.span.start,
              sourceEnd: mainDecl.span.end,
            },
          ]
        : [],
    },
  ];
}

/**
 * Shifts each part's mappings (relative to its own start) to absolute
 * offsets in the final `"\n\n"`-joined text.
 */
function absoluteMappings(parts: readonly EmittedPart[]): SourceMapMapping[] {
  const mappings: SourceMapMapping[] = [];
  let offset = 0;
  for (const part of parts) {
    for (const mapping of part.mappings) {
      mappings.push({
        generatedStart: offset + mapping.generatedStart,
        generatedEnd: offset + mapping.generatedEnd,
        sourceStart: mapping.sourceStart,
        sourceEnd: mapping.sourceEnd,
      });
    }
    offset += part.text.length + 2; // "\n\n" separator between parts
  }
  return mappings;
}

/**
 * Generate JavaScript and a TypeScript declaration from a JSIM program.
 * Slice-1 subset: a `fn main` is invoked as the entry point, and the `.d.ts`
 * is empty until `export "js"` items exist (slice 9).
 */
export function generate(program: Program): Code {
  const parts = emitItemParts(program);

  // The helper call itself (`__hedgeDisposeArray(`) only ever appears in
  // emitted text when this pass's own ArrayExpression/ArrayRepeatExpression
  // cases produced it - checking the generated text directly, rather than
  // threading a "did this program construct an array" flag through every
  // recursive emit* function, keeps the helper's own presence a pure
  // function of what actually got emitted.
  if (
    parts.some((part) => part.text.includes(`${ARRAY_DISPOSE_HELPER_NAME}(`))
  ) {
    parts.unshift({ text: ARRAY_DISPOSE_HELPER, mappings: [] });
  }

  if (hasMain(program)) {
    const [shebang, mainCall] = mainEntryPointParts(program);
    parts.unshift(shebang);
    parts.push(mainCall);
  }

  const mappings = absoluteMappings(parts);

  const dtsParts: string[] = [];
  if (isSome(program.docComment)) {
    dtsParts.push(emitDocComment(program.docComment.value, true));
  }
  for (const item of program.items) {
    const dts = emitDtsItem(item);
    if (dts !== null) {
      dtsParts.push(dts);
    }
  }

  return {
    javascript: parts.length
      ? some(`${parts.map((p) => p.text).join("\n\n")}\n`)
      : none(),
    typedef: dtsParts.length ? some(`${dtsParts.join("\n\n")}\n`) : none(),
    sourceMap: { version: 3, mappings },
  };
}
