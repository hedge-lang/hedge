import type { Option } from "../option.js";

export interface Program {
  readonly kind: "Program";
  readonly items: readonly Item[];
  readonly docComment: Option<DocComment>;
}

export type Item = FunctionDecl | Statement;

export interface DocComment {
  readonly kind: "DocComment";
  readonly text: string;
}

export interface FunctionDecl {
  readonly kind: "FunctionDecl";
  /** `none()` = module-private; `some("public")` = `pub`; `some("package")` = `pub(package)`. */
  readonly scope: Option<"public" | "package">;
  readonly name: string;
  readonly params: readonly FunctionParam[];
  readonly returnType: Option<Type>;
  readonly body: readonly Statement[];
  readonly docComment: Option<DocComment>;
}

export type Statement =
  LetStatement | BlockStatement | IfStatement | ReturnStatement | Expression;

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
}

export interface IfStatement {
  readonly kind: "IfStatement";
  readonly condition: Expression;
  readonly thenBranch: readonly Statement[];
  readonly elseBranch: Option<readonly Statement[]>;
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
  | StructExpression;

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
  readonly type: Type;
}

type Type = PrimitiveType;
interface PrimitiveType {
  readonly kind: "PrimitiveType";
  readonly value: "string" | "number" | "bigint" | "boolean" | "null";
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

/** How the JS backend should wrap/truncate the result of a numeric binary operation. */
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
  /** Present for arithmetic operators on numeric types; `none()` for comparisons and logical ops. */
  readonly numericKind: Option<NumericKind>;
}

export type UnaryOperator = "Neg" | "Not";
interface UnaryExpression {
  readonly kind: "UnaryExpression";
  readonly operator: UnaryOperator;
  readonly operand: Expression;
  /** Present for `Neg` on numeric types; `none()` for `Not` and unit operands. */
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
interface AssignExpression {
  readonly kind: "AssignExpression";
  readonly operator: AssignOperator;
  readonly lhs: Expression;
  readonly rhs: Expression;
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

interface IndexExpression {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
}

interface TupleExpression {
  readonly kind: "TupleExpression";
  readonly elements: readonly Expression[];
}

interface StructExpression {
  readonly kind: "StructExpression";
  readonly fields: readonly StructExpressionField[];
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
