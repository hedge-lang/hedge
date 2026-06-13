/** Every AST node carries the index of the token that begins it. */
export interface AstNode {
  readonly tokenId: number;
}

export interface Program {
  readonly kind: "Program";
  readonly items: Item[];
}

/** A top-level entry. Slice 1 is lenient and also accepts bare statements. */
export type Item = FunctionDecl | Statement | Expression;

export type Statement = LetStatement | ExpressionStatement;

export type Expression =
  | StringLiteral
  | IntLiteral
  | PathExpression
  | CallExpression
  | ReferenceExpression;

export interface FunctionDecl extends AstNode {
  readonly kind: "Function";
  readonly name: Identifier;
  readonly generics: readonly never[];
  readonly params: readonly never[];
  readonly returnType: null;
  readonly whereClause: null;
  readonly body: Block;
}

export interface Block extends AstNode {
  readonly kind: "Block";
  readonly statements: Statement[];
  readonly trailingExpression: Expression | null;
}

export interface LetStatement extends AstNode {
  readonly kind: "LetStatement";
  readonly bind: boolean;
  readonly write: boolean;
  readonly pattern: BindingPattern;
  readonly type: null;
  readonly initializer: Expression | null;
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
  readonly text: string;
}

export interface Path {
  readonly absolute: boolean;
  readonly segments: string[];
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
