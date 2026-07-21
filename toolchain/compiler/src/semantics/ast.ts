// Mirrors parser/ast.ts structurally but every expression node extends
// DecoratedAstNode — the resolved Type field is the semantic layer's invariant.
// Duplication is intentional; do not merge these two ASTs.

import type { Option } from "../option.js";
import type { FloatSuffix, IntSuffix } from "../lexer/token.js";

/** Every AST node carries the index of the token that begins it. */
interface AstNode {
  readonly tokenId: number;
}

interface DecoratedAstNode extends AstNode {
  readonly type: Type;
}

export interface Program {
  readonly kind: "Program";
  readonly items: Item[];
  readonly attributes: readonly Attribute[];
}

export interface Attribute {
  readonly kind: "Attribute";
  readonly name: Identifier;
  readonly arguments: Option<
    { path: Option<Path>; literal: Option<StringLiteral | IntLiteral> }[]
  >;
}

/** A top-level entry. Slice 1 is lenient and also accepts bare statements. */
export type Item =
  | FunctionDecl
  | StructDecl
  | ConstDecl
  | StaticDecl
  | Statement
  | Expression;

/**
 * A `const`'s fully compile-time-evaluated value. Unlike `Expression`, this
 * carries no unevaluated subtree - a `const` is inlined at each use site
 * (spec 0008 "Constants and statics"), so by the time analysis finishes a
 * `ConstDecl` there is nothing left to lower but this resolved value.
 */
export type ConstValue =
  | { readonly kind: "Int"; readonly value: bigint }
  | { readonly kind: "Float"; readonly value: number }
  | { readonly kind: "Bool"; readonly value: boolean }
  | { readonly kind: "Char"; readonly value: string }
  | { readonly kind: "Str"; readonly value: string };

export type Statement =
  | LetStatement
  | ExpressionStatement
  | FunctionDecl
  | StructDecl
  | ConstDecl
  | StaticDecl;

type BinaryOperator =
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

type CompoundAssignOperator =
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

export type Expression =
  | StringLiteral
  | IntLiteral
  | FloatLiteral
  | BoolLiteral
  | CharLiteral
  | PathExpression
  | CallExpression
  | ReferenceExpression
  | DereferenceExpression
  | BinaryExpression
  | UnaryExpression
  | AssignExpression
  | CompoundAssignExpression
  | FieldAccessExpression
  | MethodCallExpression
  | IndexExpression
  | TupleExpression
  | ArrayExpression
  | ArrayRepeatExpression
  | RangeExpression
  | StructExpression
  | IfExpression
  | Block;

interface Visibility {
  readonly kind: "Visibility";
  /** `none()` for bare `pub`; `some("package")` for `pub(package)`, etc. */
  readonly scope: Option<string>;
}

export interface Param extends DecoratedAstNode {
  readonly kind: "Param";
  readonly mutable: boolean;
  readonly pattern: BindingPattern;
  readonly type: Type;
}

export interface FunctionDecl extends AstNode {
  readonly kind: "Function";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly never[];
  readonly params: readonly Param[];
  readonly returnType: Option<Type>;
  readonly whereClause: Option<never>;
  readonly attributes: readonly Attribute[];
  readonly body: Block;
}

export interface StructDecl extends DecoratedAstNode {
  readonly kind: "Struct";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly body: StructBody;
  readonly attributes: readonly Attribute[];
}

/**
 * `const NAME: Type = <folded value>;`. Only ever produced for a top-level
 * declaration - see `parser/ast.ts`'s `ConstDecl` doc comment.
 */
export interface ConstDecl extends DecoratedAstNode {
  readonly kind: "Const";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly value: ConstValue;
  readonly attributes: readonly Attribute[];
}

/**
 * `static NAME: Type = Expression;`. Unlike `ConstDecl`, `value` stays a real
 * `Expression` - a static's initializer runs once, at runtime, on first
 * access, and may call arbitrary functions (spec 0008).
 */
export interface StaticDecl extends DecoratedAstNode {
  readonly kind: "Static";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly value: Expression;
  readonly attributes: readonly Attribute[];
}

export type StructBody = NamedFieldsBody | TupleFieldsBody | UnitBody;

export interface NamedFieldsBody {
  readonly kind: "NamedFields";
  readonly fields: readonly StructField[];
}

interface TupleFieldsBody {
  readonly kind: "TupleFields";
  readonly fields: readonly TupleField[];
}

interface UnitBody {
  readonly kind: "Unit";
}

export interface StructField extends DecoratedAstNode {
  readonly kind: "StructField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
}

export interface TupleField extends DecoratedAstNode {
  readonly kind: "TupleField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly type: Type;
}

export interface Block extends DecoratedAstNode {
  readonly kind: "Block";
  readonly statements: Statement[];
  readonly trailingExpression: Option<Expression>;
  readonly innerAttributes: readonly Attribute[];
}

export interface LetStatement extends DecoratedAstNode {
  readonly kind: "LetStatement";
  readonly attributes: readonly Attribute[];
  readonly mutable: boolean;
  readonly pattern: BindingPattern;
  readonly initializer: Option<Expression>;
}

export interface BindingPattern {
  readonly kind: "BindingPattern";
  readonly name: Identifier;
}

export interface ExpressionStatement extends DecoratedAstNode {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface Identifier extends DecoratedAstNode {
  readonly kind: "Identifier";
  readonly text: string;
}

export interface StringLiteral extends DecoratedAstNode {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface IntLiteral extends DecoratedAstNode {
  readonly kind: "IntLiteral";
  /** Digits only — no prefix, underscores stripped. */
  readonly value: string;
  readonly base: 10 | 16 | 8 | 2;
  readonly suffix: Option<IntSuffix>;
}

export interface FloatLiteral extends DecoratedAstNode {
  readonly kind: "FloatLiteral";
  /** Full normalized text, underscores stripped. */
  readonly value: string;
  readonly suffix: Option<FloatSuffix>;
}

export interface BoolLiteral extends DecoratedAstNode {
  readonly kind: "BoolLiteral";
  readonly value: boolean;
}

export interface CharLiteral extends DecoratedAstNode {
  readonly kind: "CharLiteral";
  /** Resolved character (after escape decoding). */
  readonly value: string;
}

export interface Path {
  readonly absolute: boolean;
  readonly segments: string[];
}

export type Type =
  | NamedType
  | UnitType
  | PrimitiveType
  | StructType
  | FunctionType
  | ReferenceType
  | ArrayType;

/**
 * `[T; N]`, a fixed-size array. `length` is a resolved, non-negative integer
 * - the parser guarantees the source's own length expression is a literal
 * integer (no const-evaluation exists yet), so by the time a program reaches
 * this layer there's nothing left to evaluate.
 */
interface ArrayType {
  readonly kind: "ArrayType";
  readonly elementType: Type;
  readonly length: number;
}

export interface FunctionType {
  readonly kind: "FunctionType";
  readonly params: readonly Type[];
  readonly returnType: Type;
}

/**
 * `&T` / `&mut T`, erased of lifetime identity - nothing downstream of
 * parsing does lifetime-aware checking yet (the borrow checker still
 * consumes the parser-level `Program`, not this one), so only the mutability
 * and referent type are meaningful here.
 */
interface ReferenceType extends AstNode {
  readonly kind: "ReferenceType";
  readonly mutable: boolean;
  readonly referent: Type;
}

export type PrimitiveType =
  | PrimitiveIntType
  | PrimitiveUintType
  | PrimitiveFloatType
  | PrimitiveBooleanType
  | PrimitiveCharType
  | PrimitiveStringType;

export type PrimitiveIntegerType = PrimitiveUintType | PrimitiveIntType;
type PrimitiveUintType =
  | PrimitiveU8Type
  | PrimitiveU16Type
  | PrimitiveU32Type
  | PrimitiveU64Type
  | PrimitiveUsizeType;
type PrimitiveIntType =
  | PrimitiveI8Type
  | PrimitiveI16Type
  | PrimitiveI32Type
  | PrimitiveI64Type
  | PrimitiveIsizeType;
type PrimitiveFloatType = PrimitiveF32Type | PrimitiveF64Type;

interface PrimitiveU8Type {
  readonly kind: "PrimitiveU8Type";
}

interface PrimitiveU16Type {
  readonly kind: "PrimitiveU16Type";
}

interface PrimitiveU32Type {
  readonly kind: "PrimitiveU32Type";
}

interface PrimitiveU64Type {
  readonly kind: "PrimitiveU64Type";
}

interface PrimitiveUsizeType {
  readonly kind: "PrimitiveUsizeType";
}

interface PrimitiveI8Type {
  readonly kind: "PrimitiveI8Type";
}

interface PrimitiveI16Type {
  readonly kind: "PrimitiveI16Type";
}

interface PrimitiveI32Type {
  readonly kind: "PrimitiveI32Type";
}

interface PrimitiveI64Type {
  readonly kind: "PrimitiveI64Type";
}

interface PrimitiveF32Type {
  readonly kind: "PrimitiveF32Type";
}

interface PrimitiveF64Type {
  readonly kind: "PrimitiveF64Type";
}

interface PrimitiveIsizeType {
  readonly kind: "PrimitiveIsizeType";
}

interface PrimitiveBooleanType {
  readonly kind: "PrimitiveBooleanType";
}

interface PrimitiveCharType {
  readonly kind: "PrimitiveCharType";
}

interface PrimitiveStringType {
  readonly kind: "PrimitiveStringType";
}

interface StructType {
  readonly kind: "StructType";
  readonly name: string;
}

interface NamedType extends AstNode {
  readonly kind: "NamedType";
  readonly path: Path;
}

export interface UnitType extends AstNode {
  readonly kind: "UnitType";
}

export interface PathExpression extends DecoratedAstNode {
  readonly kind: "PathExpression";
  readonly path: Path;
}

export interface CallExpression extends DecoratedAstNode {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: Expression[];
}

export interface ReferenceExpression extends DecoratedAstNode {
  readonly kind: "ReferenceExpression";
  /** `true` for `&mut` (exclusive), `false` for `&` (shared). */
  readonly mutable: boolean;
  readonly operand: Expression;
}

export interface DereferenceExpression extends DecoratedAstNode {
  readonly kind: "DereferenceExpression";
  readonly operand: Expression;
}

export interface BinaryExpression extends DecoratedAstNode {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpression extends DecoratedAstNode {
  readonly kind: "UnaryExpression";
  readonly operator: "Neg" | "Not";
  readonly operand: Expression;
}

export interface AssignExpression extends DecoratedAstNode {
  readonly kind: "AssignExpression";
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface CompoundAssignExpression extends DecoratedAstNode {
  readonly kind: "CompoundAssignExpression";
  readonly operator: CompoundAssignOperator;
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface FieldAccessExpression extends DecoratedAstNode {
  readonly kind: "FieldAccessExpression";
  readonly object: Expression;
  readonly field: Identifier;
}

export interface MethodCallExpression extends DecoratedAstNode {
  readonly kind: "MethodCallExpression";
  readonly receiver: Expression;
  readonly method: Identifier;
  readonly arguments: Expression[];
}

export interface IndexExpression extends DecoratedAstNode {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
}

export interface TupleExpression extends DecoratedAstNode {
  readonly kind: "TupleExpression";
  /** Zero elements = unit `()`. One element with trailing comma = single-element tuple. */
  readonly elements: Expression[];
}

/** `[a, b, c]` - the list form of an array literal; `type` is always an `ArrayType`. */
export interface ArrayExpression extends DecoratedAstNode {
  readonly kind: "ArrayExpression";
  readonly elements: Expression[];
}

/** `[value; count]` - the repeat form of an array literal; `type` is always an `ArrayType`. */
export interface ArrayRepeatExpression extends DecoratedAstNode {
  readonly kind: "ArrayRepeatExpression";
  readonly value: Expression;
  /** Resolved element count, mirroring `ArrayType.length` - see that type's own doc comment. */
  readonly count: number;
}

export interface RangeExpression extends DecoratedAstNode {
  readonly kind: "RangeExpression";
  readonly start: Option<Expression>;
  readonly end: Option<Expression>;
  readonly inclusive: boolean;
}

export interface FieldInit extends DecoratedAstNode {
  readonly kind: "FieldInit";
  readonly name: Identifier;
  /** `none()` for shorthand `Foo { x }` (value inferred from binding in scope). */
  readonly value: Option<Expression>;
}

export interface StructExpression extends DecoratedAstNode {
  readonly kind: "StructExpression";
  readonly path: Path;
  readonly fields: FieldInit[];
  /** `some(expr)` for `Foo { x: 1, ..base }` spread. Semantic analysis is deferred. */
  readonly base: Option<Expression>;
}

export interface IfExpression extends DecoratedAstNode {
  readonly kind: "IfExpression";
  readonly condition: Expression;
  readonly thenBranch: Block;
  readonly elseBranch: Option<IfExpression | Block>;
}
