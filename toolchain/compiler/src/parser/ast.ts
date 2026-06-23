import type { Option } from "../option.js";
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
export type Item = FunctionDecl | StructDecl | Statement | Expression;

export type Statement = LetStatement | ExpressionStatement;

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
  | BinaryExpression
  | UnaryExpression
  | AssignExpression
  | CompoundAssignExpression
  | FieldAccessExpression;

export interface Visibility {
  readonly kind: "Visibility";
  /** `none()` for bare `pub`; `some("package")` for `pub(package)`, etc. */
  readonly scope: Option<string>;
}

export interface Param extends AstNode {
  readonly kind: "Param";
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

export interface StructDecl extends AstNode {
  readonly kind: "Struct";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly body: StructBody;
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
  readonly bind: boolean;
  readonly write: boolean;
  readonly pattern: BindingPattern;
  readonly type: Option<Type>;
  readonly initializer: Option<Expression>;
}

export interface BindingPattern {
  readonly kind: "BindingPattern";
  readonly name: Identifier;
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

export type Type = NamedType | UnitType;

export interface NamedType extends AstNode {
  readonly kind: "NamedType";
  readonly path: Path;
}

export interface UnitType extends AstNode {
  readonly kind: "UnitType";
}

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
  /** `true` for `&write` (exclusive), `false` for `&` (shared). */
  readonly mutable: boolean;
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
