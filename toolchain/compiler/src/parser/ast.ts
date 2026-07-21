import { assertNever } from "../assert.js";
import { none, some, type Option } from "../option.js";
import type { FloatSuffix, IntSuffix } from "../lexer/token.js";
export type { IntSuffix, FloatSuffix } from "../lexer/token.js";

/** Every AST node carries the index of the token that begins it. */
export interface AstNode {
  readonly tokenId: number;
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

export type Statement =
  | LetStatement
  | ExpressionStatement
  | FunctionDecl
  | StructDecl
  | ConstDecl
  | StaticDecl;

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

export type CompoundAssignOperator =
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
  | StructExpression
  | RangeExpression
  | IfExpression
  | Block
  | Identifier;

export interface Visibility {
  readonly kind: "Visibility";
  /** `none()` for bare `pub`; `some("package")` for `pub(package)`, etc. */
  readonly scope: Option<string>;
}

export interface Param extends AstNode {
  readonly kind: "Param";
  readonly pattern: Pattern;
  readonly type: Type;
}

export interface FunctionDecl extends AstNode {
  readonly kind: "Function";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly GenericParam[];
  readonly params: readonly Param[];
  readonly returnType: Option<Type>;
  readonly whereClause: Option<never>;
  readonly attributes: readonly Attribute[];
  readonly body: Block;
}

export interface StructDecl extends AstNode {
  readonly kind: "Struct";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly GenericParam[];
  readonly body: StructBody;
  readonly attributes: readonly Attribute[];
}

/**
 * `const NAME: Type = Expression;` - a compile-time constant. Legal at the
 * top level and inside a function body (see `parser/statement.ts`'s local
 * item dispatch).
 */
export interface ConstDecl extends AstNode {
  readonly kind: "Const";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
  readonly value: Expression;
  readonly attributes: readonly Attribute[];
}

/**
 * `static NAME: Type = Expression;` - a lazily-initialized, module-level
 * singleton. Only legal at the top level, unlike `ConstDecl` - a local
 * static's initializer could otherwise reference an enclosing function's
 * local variable, but the static only ever initializes once.
 */
export interface StaticDecl extends AstNode {
  readonly kind: "Static";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
  readonly value: Expression;
  readonly attributes: readonly Attribute[];
}

export type StructBody = NamedFieldsBody | TupleFieldsBody | UnitBody;

export interface NamedFieldsBody {
  readonly kind: "NamedFields";
  readonly fields: readonly StructField[];
}

export interface TupleFieldsBody {
  readonly kind: "TupleFields";
  readonly fields: readonly TupleField[];
}

export interface UnitBody {
  readonly kind: "Unit";
}

export interface StructField extends AstNode {
  readonly kind: "StructField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
}

export interface TupleField extends AstNode {
  readonly kind: "TupleField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly type: Type;
}

export interface Block extends AstNode {
  readonly kind: "Block";
  readonly statements: Statement[];
  readonly trailingExpression: Option<Expression>;
  readonly innerAttributes: readonly Attribute[];
}

export interface LetStatement extends AstNode {
  readonly kind: "LetStatement";
  readonly attributes: readonly Attribute[];
  readonly pattern: Pattern;
  readonly type: Option<Type>;
  readonly initializer: Option<Expression>;
}

export type Pattern = BindingPattern | WildcardPattern;

export interface BindingPattern extends AstNode {
  readonly kind: "BindingPattern";
  readonly mutable: boolean;
  readonly name: Identifier;
}

export interface WildcardPattern extends AstNode {
  readonly kind: "WildcardPattern";
}

export function patternMutable(pattern: Pattern): boolean {
  switch (pattern.kind) {
    case "BindingPattern":
      return pattern.mutable;
    case "WildcardPattern":
      return false;
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

export function patternBindingName(pattern: Pattern): Option<string> {
  switch (pattern.kind) {
    case "BindingPattern":
      return some(pattern.name.text);
    case "WildcardPattern":
      return none();
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

export interface ExpressionStatement extends AstNode {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface Identifier extends AstNode {
  readonly kind: "Identifier";
  readonly text: string;
}

export interface StringLiteral extends AstNode {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface IntLiteral extends AstNode {
  readonly kind: "IntLiteral";
  /** Digits only — no prefix, underscores stripped. */
  readonly value: string;
  readonly base: 10 | 16 | 8 | 2;
  readonly suffix: Option<IntSuffix>;
}

export interface FloatLiteral extends AstNode {
  readonly kind: "FloatLiteral";
  /** Full normalized text, underscores stripped. */
  readonly value: string;
  readonly suffix: Option<FloatSuffix>;
}

export interface BoolLiteral extends AstNode {
  readonly kind: "BoolLiteral";
  readonly value: boolean;
}

export interface CharLiteral extends AstNode {
  readonly kind: "CharLiteral";
  /** Resolved character (after escape decoding). */
  readonly value: string;
}

export interface Path {
  readonly absolute: boolean;
  readonly segments: string[];
}

export type Type = NamedType | UnitType | ReferenceType | ArrayType;

export interface NamedType extends AstNode {
  readonly kind: "NamedType";
  readonly path: Path;
}

export interface UnitType extends AstNode {
  readonly kind: "UnitType";
}

/**
 * `&T` / `&mut T` / `&'a T` / `&'a mut T`. `lifetime` is `none()` only
 * transiently between parsing and the lifetime-elision pass - every
 * `ReferenceType` in a `Program` returned by `parse()` has `some(...)` here,
 * either the source's explicit annotation or a synthesized one.
 */
export interface ReferenceType extends AstNode {
  readonly kind: "ReferenceType";
  readonly mutable: boolean;
  readonly lifetime: Option<Lifetime>;
  readonly referent: Type;
}

/**
 * `[T; N]` - a fixed-size array type. `length` is a general `Expression` per
 * the grammar, though semantic analysis currently accepts only a literal
 * integer (no const-evaluation exists yet). The distinct, semicolon-less
 * slice-type grammar `[T]` is a separate, still-unsupported construct
 * (`parseType`'s own guardrail), not a degenerate case of this type.
 */
export interface ArrayType extends AstNode {
  readonly kind: "ArrayType";
  readonly elementType: Type;
  readonly length: Expression;
}

/** `'a` - bare name, no leading `'`. May be a synthesized name (`_0`, `_1`, ...). */
export interface Lifetime extends AstNode {
  readonly kind: "Lifetime";
  readonly name: string;
}

/** Only lifetime params are parsed in Slice 2; a `<...>` list containing a
 * non-lifetime member still falls through to the Slice-4 generics guardrail. */
export type GenericParam = Lifetime;

export interface PathExpression extends AstNode {
  readonly kind: "PathExpression";
  readonly path: Path;
}

export interface CallExpression extends AstNode {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: Expression[];
}

export interface ReferenceExpression extends AstNode {
  readonly kind: "ReferenceExpression";
  /** `true` for `&mut` (exclusive), `false` for `&` (shared). */
  readonly mutable: boolean;
  readonly operand: Expression;
}

export interface DereferenceExpression extends AstNode {
  readonly kind: "DereferenceExpression";
  readonly operand: Expression;
}

export interface BinaryExpression extends AstNode {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpression extends AstNode {
  readonly kind: "UnaryExpression";
  readonly operator: "Neg" | "Not";
  readonly operand: Expression;
}

export interface AssignExpression extends AstNode {
  readonly kind: "AssignExpression";
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface CompoundAssignExpression extends AstNode {
  readonly kind: "CompoundAssignExpression";
  readonly operator: CompoundAssignOperator;
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface FieldAccessExpression extends AstNode {
  readonly kind: "FieldAccessExpression";
  readonly object: Expression;
  readonly field: Identifier;
}

export interface MethodCallExpression extends AstNode {
  readonly kind: "MethodCallExpression";
  readonly receiver: Expression;
  readonly method: Identifier;
  readonly arguments: Expression[];
}

export interface IndexExpression extends AstNode {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
}

export interface TupleExpression extends AstNode {
  readonly kind: "TupleExpression";
  /** Zero elements = unit `()`. One element with trailing comma = single-element tuple. */
  readonly elements: Expression[];
}

/** `[a, b, c]` - the list form of an array literal (grammar's `ArrayElems`, comma-separated branch). */
export interface ArrayExpression extends AstNode {
  readonly kind: "ArrayExpression";
  readonly elements: Expression[];
}

/** `[value; count]` - the repeat form of an array literal (grammar's `ArrayElems`, `Expression ";" Expression` branch). */
export interface ArrayRepeatExpression extends AstNode {
  readonly kind: "ArrayRepeatExpression";
  readonly value: Expression;
  readonly count: Expression;
}

export interface FieldInit extends AstNode {
  readonly kind: "FieldInit";
  readonly name: Identifier;
  /** `none()` for shorthand `Foo { x }` (value inferred from binding in scope). */
  readonly value: Option<Expression>;
}

export interface StructExpression extends AstNode {
  readonly kind: "StructExpression";
  readonly path: Path;
  readonly fields: FieldInit[];
  /** `some(expr)` for `Foo { x: 1, ..base }` spread. Semantic analysis is deferred. */
  readonly base: Option<Expression>;
}

export interface RangeExpression extends AstNode {
  readonly kind: "RangeExpression";
  readonly start: Option<Expression>;
  readonly end: Option<Expression>;
  readonly inclusive: boolean;
}

export interface IfExpression extends AstNode {
  readonly kind: "IfExpression";
  readonly condition: Expression;
  readonly thenBranch: Block;
  readonly elseBranch: Option<IfExpression | Block>;
}
