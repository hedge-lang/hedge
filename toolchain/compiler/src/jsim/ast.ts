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

export type Statement = LetStatement | Expression;

export interface LetStatement {
  readonly kind: "LetStatement";
  readonly name: string;
  readonly mutable: boolean;
  readonly value: Option<Expression>;
}

export type Expression =
  | StringLiteral
  | NumberLiteral
  | PathExpression
  | CallExpression;

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

interface FunctionParam {
  readonly kind: "FunctionParam";
  readonly name: string;
  readonly type: Type;
}

type Type = PrimitiveType;
interface PrimitiveType {
  readonly kind: "PrimitiveType";
  readonly value: "string" | "number" | "boolean" | "null";
}
