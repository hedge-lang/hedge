import type { Span } from "../lexer/token.js";
import type { Option } from "../option.js";

export interface Program {
  readonly kind: "Program";
  readonly items: readonly Item[];
  readonly docComment: Option<DocComment>;
}

export type Item = FunctionDecl | StaticDecl | ConstDecl | EnumDecl | Statement;

/**
 * Contributes nothing to emitted JS - a variant's tagged object already
 * carries its own discriminant. Exists only to emit a discriminated-union
 * `.d.ts` type alias. Field types are pre-rendered to `.d.ts` text at
 * lowering time rather than carried as `JSIM.Type`, since `PrimitiveType`
 * has no member for a named type reference.
 */
export interface EnumDecl {
  readonly kind: "EnumDecl";
  readonly name: string;
  readonly variants: readonly EnumDeclVariant[];
}

export type EnumDeclVariant =
  | { readonly kind: "UnitVariant"; readonly tag: string }
  | {
      readonly kind: "TupleVariant";
      readonly tag: string;
      readonly dataTypes: readonly string[];
    }
  | {
      readonly kind: "StructVariant";
      readonly tag: string;
      readonly dataFields: readonly {
        readonly name: string;
        readonly type: string;
      }[];
    };

/**
 * A `pub const`'s exported shape. Every *reference* to a const is inlined
 * to a literal at analysis time (see `semantics/analyzer.ts`'s
 * `analyzeConstReference`) since a const has no runtime storage inside
 * Hedge itself - but a `pub const` still needs one real exported JS
 * binding, since a plain-JS (non-Hedge) consumer importing it has no
 * inlining of its own. A non-`pub` const never lowers to one of these at
 * all (see `jsim.ts`'s `parseItem`) - it has no external consumer, so it
 * erases completely, matching the no-runtime-storage semantics.
 */
export interface ConstDecl {
  readonly kind: "ConstDecl";
  readonly name: string;
  readonly type: Option<Type>;
  readonly value: Expression;
  readonly span: Span;
}

export interface DocComment {
  readonly kind: "DocComment";
  readonly text: string;
}

export interface FunctionDecl {
  readonly kind: "FunctionDecl";
  /**
   * `none()` = module-private; `some("public")` = `pub`;
   * `some("package")` = `pub(package)`.
   */
  readonly scope: Option<"public" | "package">;
  readonly name: string;
  readonly params: readonly FunctionParam[];
  readonly returnType: Option<Type>;
  readonly body: readonly Statement[];
  readonly docComment: Option<DocComment>;
  readonly span: Span;
}

export type Statement =
  | LetStatement
  | BlockStatement
  | IfStatement
  | SwitchStatement
  | ReturnStatement
  | ThrowStatement
  | DisposeCallStatement
  | Expression
  | FunctionDecl;

/**
 * A `static` lowers to a module-private backing variable plus a
 * lazily-initializing accessor function of the static's own name - every
 * reference site is a `CallExpression` targeting that name (see
 * `semantics/analyzer.ts`'s `analyzeStaticReference`), not a plain
 * `Identifier` read, so `backingName`/`initFlagName` are only ever touched
 * by this node's own codegen. `pub static` is rejected in semantic
 * analysis, so there is no `scope` field here (unlike `FunctionDecl`) - a
 * `StaticDecl` reaching codegen is always module-private.
 *
 * Laziness is tracked by `initFlagName`, a separate boolean - not by
 * checking whether `backingName` is still nullish (`??=`), since a
 * unit-returning initializer's JS value is `undefined` (see
 * `jsimTailStatements`'s note on why a unit-returning function never emits
 * an explicit `return`), which `??=` would treat as "not yet initialized"
 * forever and rerun the initializer on every single access.
 */
export interface StaticDecl {
  readonly kind: "StaticDecl";
  readonly name: string;
  readonly backingName: string;
  readonly initFlagName: string;
  readonly init: Expression;
  readonly docComment: Option<DocComment>;
  readonly span: Span;
}

/**
 * The explicit disposer call a conditionally dropped binding needs, since it
 * can't lower to `using` (see ADR 0003: `using` can't express a drop flag).
 * {@link target} is already the emitted (alpha-renamed) name; there is no
 * receiver expression to lower further.
 */
export interface DisposeCallStatement {
  readonly kind: "DisposeCallStatement";
  readonly target: string;
}

export interface BlockStatement {
  readonly kind: "BlockStatement";
  readonly body: readonly Statement[];
}

export interface LetStatement {
  readonly kind: "LetStatement";
  readonly name: string;
  readonly mutable: boolean;
  readonly value: Option<Expression>;
  readonly docComment: Option<DocComment>;
  readonly span: Span;
  /**
   * `true` when this binding needs scope-end drop and lowers to `using`
   * instead of `const`/`let`.
   */
  readonly dispose: boolean;
}

export interface IfStatement {
  readonly kind: "IfStatement";
  readonly condition: Expression;
  readonly thenBranch: readonly Statement[];
  readonly elseBranch: Option<readonly Statement[]>;
}

/**
 * `match` on an enum lowers to `switch` on `<scrutinee>.tag` - one case per
 * explicitly-named tag; a tag covered only by a wildcard/binding catch-all
 * falls to `defaultBody`. `defaultBody` is never absent: the catch-all's
 * own chain, or a `ThrowStatement` (defense-in-depth per spec 0016).
 */
export interface SwitchStatement {
  readonly kind: "SwitchStatement";
  readonly discriminant: Expression;
  readonly cases: readonly SwitchCase[];
  readonly defaultBody: readonly Statement[];
}

export interface SwitchCase {
  readonly kind: "SwitchCase";
  readonly tag: string;
  readonly body: readonly Statement[];
}

/** `throw new Error(message);` - match's defense-in-depth fallback.
 * Division-by-zero/array-bounds throws stay raw text in
 * codegen/generator.ts; this is the only JSIM-node throw. */
export interface ThrowStatement {
  readonly kind: "ThrowStatement";
  readonly message: string;
}

export interface ReturnStatement {
  readonly kind: "ReturnStatement";
  readonly value: Option<Expression>;
}

export type Expression =
  | BooleanLiteral
  | StringLiteral
  | NumberLiteral
  | PathExpression
  | CallExpression
  | BinaryExpression
  | UnaryExpression
  | AssignExpression
  | FieldAccessExpression
  | Identifier
  | MethodCallExpression
  | ArrowFunctionExpression
  | IndexExpression
  | TupleExpression
  | ArrayExpression
  | ArrayRepeatExpression
  | ArraySliceViewExpression
  | RangeExpression
  | StructExpression
  | RefCellExpression;

interface BooleanLiteral {
  readonly kind: "BooleanLiteral";
  readonly value: boolean;
}

interface StringLiteral {
  readonly kind: "StringLiteral";
  readonly value: string;
}

interface NumberLiteral {
  readonly kind: "NumberLiteral";
  readonly value: string;
}

interface PathExpression {
  readonly kind: "PathExpression";
  readonly path: readonly string[];
}

interface CallExpression {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: readonly Expression[];
}

export interface FunctionParam {
  readonly kind: "FunctionParam";
  readonly name: string;
  /**
   * `none()` for a type with no JS-primitive representation (e.g. a
   * struct); the parameter still exists in JS, it just has no `.d.ts`
   * type annotation yet.
   */
  readonly type: Option<Type>;
}

type Type = PrimitiveType;
export interface PrimitiveType {
  readonly kind: "PrimitiveType";
  readonly value: "string" | "number" | "bigint" | "boolean" | "undefined";
}

export type BinaryOperator =
  | "Add"
  | "Sub"
  | "Mul"
  | "Div"
  | "Rem"
  | "Shl"
  | "Shr"
  | "BitAnd"
  | "BitXor"
  | "BitOr"
  | "Eq"
  | "Ne"
  | "Lt"
  | "Gt"
  | "Le"
  | "Ge"
  | "And"
  | "Or";

/**
 * How the JS backend should wrap/truncate the result of a numeric
 * binary operation.
 */
export type NumericKind =
  | { readonly kind: "signed"; readonly bits: 8 | 16 | 32 }
  | { readonly kind: "unsigned"; readonly bits: 8 | 16 | 32 }
  | { readonly kind: "bigint"; readonly signed: boolean }
  | { readonly kind: "float"; readonly bits: 32 | 64 };

interface BinaryExpression {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
  /**
   * Present for arithmetic operators on numeric types; `none()` for
   * comparisons and logical ops.
   */
  readonly numericKind: Option<NumericKind>;
  readonly span: Span;
}

export type UnaryOperator = "Neg" | "Not";
interface UnaryExpression {
  readonly kind: "UnaryExpression";
  readonly operator: UnaryOperator;
  readonly operand: Expression;
  /**
   * Present for `Neg` on numeric types; `none()` for `Not` and unit
   * operands.
   */
  readonly numericKind: Option<NumericKind>;
}

export type AssignOperator =
  | "Assign"
  | "AddAssign"
  | "SubAssign"
  | "MulAssign"
  | "DivAssign"
  | "RemAssign"
  | "BitAndAssign"
  | "BitOrAssign"
  | "BitXorAssign"
  | "ShlAssign"
  | "ShrAssign";
export interface AssignExpression {
  readonly kind: "AssignExpression";
  readonly operator: AssignOperator;
  readonly lhs: Expression;
  readonly rhs: Expression;
  /**
   * `some(...)` only when this assignment is itself a statement (not nested
   * inside a larger expression) - that's the only position `emitFunctionPart`
   * can give it its own source-map mapping, since a nested occurrence has no
   * statement-level `;` of its own to bound a span with.
   */
  readonly span: Option<Span>;
}

interface FieldAccessExpression {
  readonly kind: "FieldAccessExpression";
  readonly object: Expression;
  readonly field: string;
}

interface Identifier {
  readonly kind: "Identifier";
  readonly value: string;
  readonly type: Option<Type>;
}

interface MethodCallExpression {
  readonly kind: "MethodCallExpression";
  readonly receiver: Expression;
  readonly method: string;
  readonly arguments: readonly Expression[];
}

interface ArrowFunctionExpression {
  readonly kind: "ArrowFunctionExpression";
  readonly params: readonly string[];
  readonly body: readonly Statement[];
}

/**
 * `isArrayIndex` is `true` only when the object actually resolved to a real
 * `ArrayType` (see `jsim.ts`'s `jsimIndexExpression`) - `false` for the
 * Slice-1 ambiguous-`UnitType` placeholder case, so `codegen/generator.ts`'s
 * runtime bounds check only wraps a genuine array access, never a
 * generic/not-yet-typed indexable value.
 */
interface IndexExpression {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
  readonly isArrayIndex: boolean;
}

interface TupleExpression {
  readonly kind: "TupleExpression";
  readonly elements: readonly Expression[];
}

/**
 * `numericKind` is `some(...)` for a numeric element type (spec section 0012:
 * backed by the matching `TypedArray`), `none()` for a plain JS `Array` (any
 * other element type - see `codegen/generator.ts`'s own
 * constructor-selection logic).
 */
interface ArrayExpression {
  readonly kind: "ArrayExpression";
  readonly elements: readonly Expression[];
  readonly numericKind: Option<NumericKind>;
}

interface ArrayRepeatExpression {
  readonly kind: "ArrayRepeatExpression";
  readonly value: Expression;
  readonly count: number;
  readonly numericKind: Option<NumericKind>;
}

/**
 * A slice pattern's rest binding (`..tail`) over `[start, start+length)` of
 * a fixed-length array. `numericKind` picks the codegen path, mirroring
 * {@link ArrayExpression}: `some(...)` for a real `subarray` view, `none()`
 * for the `Proxy`-based helper (no `TypedArray` to slice otherwise).
 */
interface ArraySliceViewExpression {
  readonly kind: "ArraySliceViewExpression";
  readonly source: Expression;
  readonly start: number;
  readonly length: number;
  readonly numericKind: Option<NumericKind>;
}

interface RangeExpression {
  readonly kind: "RangeExpression";
  readonly start: Option<Expression>;
  readonly end: Option<Expression>;
  readonly inclusive: boolean;
}

interface StructExpression {
  readonly kind: "StructExpression";
  readonly fields: readonly StructExpressionField[];
}

/**
 * A `&mut` reference's runtime representation: a getter/setter accessor
 * object closing over `place` (the already-lowered read-form of the
 * borrowed place - a bare {@link Identifier} for a bare local/parameter, or a
 * {@link FieldAccessExpression}/{@link IndexExpression}/`.v`-hopped chain for a
 * projected place), not a data cell - `ref.v` reads/writes route
 * through the closure, so mutating through the reference is observed by
 * every other alias of the same place without the place's own storage ever
 * being boxed or rewritten. `place` is emitted twice (once for the getter's
 * return, once for the setter's assignment target) since it's the same
 * source text either way - see `codegen/generator.ts`'s
 * {@link RefCellExpression} case.
 */
interface RefCellExpression {
  readonly kind: "RefCellExpression";
  readonly place: Expression;
}

type StructExpressionField = StructField | SpreadExpression;

export interface StructField {
  readonly kind: "StructField";
  readonly name: string;
  readonly value: Option<Expression>;
}

export interface SpreadExpression {
  readonly kind: "SpreadExpression";
  readonly expression: Expression;
}
