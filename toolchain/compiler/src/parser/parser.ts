import type { Token } from "../lexer/token.js";
import type {
  BindingPattern,
  Block,
  CallExpression,
  Expression,
  ExpressionStatement,
  FunctionDecl,
  Identifier,
  Item,
  LetStatement,
  PathExpression,
  Program,
  ReferenceExpression,
  Statement,
} from "./ast.js";

/**
 * Result of a successful parse operation.
 *
 * Parsers are implemented as pure functions that consume tokens starting at a
 * given position and return both the parsed AST node and the index of the next
 * unconsumed token.
 */
interface Parsed<T> {
  readonly node: T;
  readonly next: number;
}

/**
 * @returns the token at {@link pos}.
 *
 * @throws if the parser attempts to read beyond the end of the token stream.
 */
function tokenAt(tokens: readonly Token[], pos: number): Token {
  const token = tokens[pos];
  if (token === undefined) {
    throw new SyntaxError(`Unexpected end of input at token ${pos}`);
  }
  return token;
}

/**
 * @returns `true` if the token is the given punctuation token.
 */
function isPunct(token: Token, text: string): boolean {
  return token.kind === "punct" && token.text === text;
}

/**
 * Contextual keywords are lexed as identifiers and interpreted by the parser.
 *
 * @returns `true` if the token is an identifier whose text matches a contextual keyword.
 */
function isContextual(token: Token, text: string): boolean {
  return token.kind === "ident" && token.text === text;
}

/**
 * Consumes a required punctuation token.
 *
 * @returns Index of the next token after the punctuation.
 * @throws SyntaxError if the expected punctuation is not present.
 */
function expectPunct(
  tokens: readonly Token[],
  pos: number,
  text: string,
): number {
  const token = tokenAt(tokens, pos);
  if (!isPunct(token, text)) {
    throw new SyntaxError(
      `Expected "${text}", found "${token.text}" at offset ${token.span.start}`,
    );
  }
  return pos + 1;
}

/**
 * Consumes a required keyword token.
 *
 * @returns Index of the next token after the keyword.
 * @throws SyntaxError if the expected keyword is not present.
 */
function expectKeyword(
  tokens: readonly Token[],
  pos: number,
  text: string,
): number {
  const token = tokenAt(tokens, pos);
  if (token.kind !== "keyword" || token.text !== text) {
    throw new SyntaxError(
      `Expected "${text}", found "${token.text}" at offset ${token.span.start}`,
    );
  }
  return pos + 1;
}

/**
 * Parses an identifier expression.
 *
 * Grammar:
 *
 * ```text
 * Identifier ::= IDENT
 * ```
 */
function parseIdentifier(
  tokens: readonly Token[],
  pos: number,
): Parsed<Identifier> {
  const token = tokenAt(tokens, pos);
  if (token.kind !== "ident") {
    throw new SyntaxError(
      `Expected an identifier, found "${token.text}" at offset ${token.span.start}`,
    );
  }
  const ident: Identifier = {
    kind: "Identifier",
    tokenId: pos,
    text: token.text,
  };
  return { node: ident, next: pos + 1 };
}

/**
 * Parses a path expression.
 *
 * Grammar:
 *
 * ```text
 * PathExpression ::= Identifier
 * ```
 */
function parsePath(
  tokens: readonly Token[],
  pos: number,
): Parsed<PathExpression> {
  // Single-segment paths only in slice 1; `::` segments come later.
  const ident = parseIdentifier(tokens, pos);
  const pathExpr: PathExpression = {
    kind: "PathExpression",
    tokenId: pos,
    path: { absolute: false, segments: [ident.node.text] },
  };
  return { node: pathExpr, next: ident.next };
}

/**
 * Parses a reference expression.
 *
 * Grammar:
 *
 * ```text
 * ReferenceExpression ::= "&" "write"? PrimaryExpression
 * ```
 *
 * Examples:
 *
 * ```hedge
 * &value
 * &write counter
 * ```
 */
function parseReference(
  tokens: readonly Token[],
  pos: number,
): Parsed<ReferenceExpression> {
  let cursor = pos + 1;
  let mutable = false;
  if (isContextual(tokenAt(tokens, cursor), "write")) {
    mutable = true;
    cursor += 1;
  }
  const operand = parsePrimary(tokens, cursor);
  const reference: ReferenceExpression = {
    kind: "ReferenceExpression",
    tokenId: pos,
    mutable,
    operand: operand.node,
  };
  return { node: reference, next: operand.next };
}

/**
 * Parses a primary expression.
 *
 * Supported slice-1 forms:
 *
 * - String literals
 * - Integer literals
 * - Path expressions
 * - Reference expressions
 *
 * Grammar:
 *
 * ```text
 * PrimaryExpression ::=
 *     StringLiteral
 *   | IntLiteral
 *   | PathExpression
 *   | ReferenceExpression
 * ```
 */
function parsePrimary(
  tokens: readonly Token[],
  pos: number,
): Parsed<Expression> {
  const token = tokenAt(tokens, pos);
  if (token.kind === "string") {
    return {
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    };
  }
  if (token.kind === "int") {
    return {
      node: { kind: "IntLiteral", tokenId: pos, text: token.text },
      next: pos + 1,
    };
  }
  if (token.kind === "ident") {
    return parsePath(tokens, pos);
  }
  if (token.kind === "punct" && token.text === "&") {
    return parseReference(tokens, pos);
  }
  throw new SyntaxError(
    `Expected an expression, found "${token.text}" at offset ${token.span.start}`,
  );
}

/**
 * Parses a parenthesized argument list.
 *
 * Grammar:
 *
 * ```text
 * Arguments ::= "(" (Expression ("," Expression)*)? ")"
 * ```
 */
function parseArguments(
  tokens: readonly Token[],
  pos: number,
): Parsed<Expression[]> {
  let cursor = expectPunct(tokens, pos, "(");
  const args: Expression[] = [];
  while (!isPunct(tokenAt(tokens, cursor), ")")) {
    const arg = parseExpression(tokens, cursor);
    args.push(arg.node);
    cursor = arg.next;
    if (!isPunct(tokenAt(tokens, cursor), ",")) {
      break;
    }
    cursor += 1;
  }
  return { node: args, next: expectPunct(tokens, cursor, ")") };
}

/**
 * Parses an expression.
 *
 * Slice-1 supports postfix call chaining on top of primary expressions.
 *
 * Grammar:
 *
 * ```text
 * Expression ::= PrimaryExpression ("(" Arguments? ")")*
 * ```
 *
 * Examples:
 *
 * ```hedge
 * print()
 * print(name)
 * foo()(bar)
 * ```
 */
function parseExpression(
  tokens: readonly Token[],
  pos: number,
): Parsed<Expression> {
  let result = parsePrimary(tokens, pos);
  while (isPunct(tokenAt(tokens, result.next), "(")) {
    const args = parseArguments(tokens, result.next);
    const call: CallExpression = {
      kind: "CallExpression",
      tokenId: result.node.tokenId,
      callee: result.node,
      arguments: args.node,
    };
    result = { node: call, next: args.next };
  }
  return result;
}

/**
 * Parses a binding pattern.
 *
 * Slice-1 only supports simple identifier bindings.
 *
 * Grammar:
 *
 * ```text
 * BindingPattern ::= Identifier
 * ```
 */
function parseBindingPattern(
  tokens: readonly Token[],
  pos: number,
): Parsed<BindingPattern> {
  const ident = parseIdentifier(tokens, pos);
  return {
    node: { kind: "BindingPattern", name: ident.node },
    next: ident.next,
  };
}

/**
 * Parses a `let` statement.
 *
 * Grammar:
 *
 * ```text
 * LetStatement ::=
 *   "let"
 *   "bind"?
 *   "write"?
 *   BindingPattern
 *   ("=" Expression)?
 *   ";"
 * ```
 *
 * Examples:
 *
 * ```hedge
 * let value;
 * let value = 42;
 * let write counter = 0;
 * let bind resource = open();
 * ```
 */
function parseLetStatement(
  tokens: readonly Token[],
  pos: number,
): Parsed<LetStatement> {
  const start = pos;
  let cursor = expectKeyword(tokens, pos, "let");
  let bind = false;
  let write = false;
  if (isContextual(tokenAt(tokens, cursor), "bind")) {
    bind = true;
    cursor += 1;
  }
  if (isContextual(tokenAt(tokens, cursor), "write")) {
    write = true;
    cursor += 1;
  }
  const pattern = parseBindingPattern(tokens, cursor);
  cursor = pattern.next;
  let initializer: Expression | null = null;
  if (isPunct(tokenAt(tokens, cursor), "=")) {
    const init = parseExpression(tokens, cursor + 1);
    initializer = init.node;
    cursor = init.next;
  }
  cursor = expectPunct(tokens, cursor, ";");
  const letStmt: LetStatement = {
    kind: "LetStatement",
    tokenId: start,
    bind,
    write,
    pattern: pattern.node,
    type: null,
    initializer,
  };
  return { node: letStmt, next: cursor };
}

/**
 * Wraps an expression as an expression statement.
 *
 * Expression statements are represented explicitly in the AST rather than
 * reusing expression nodes directly.
 */
function expressionStatement(expression: Expression): ExpressionStatement {
  return {
    kind: "ExpressionStatement",
    tokenId: expression.tokenId,
    expression,
  };
}

/**
 * Parses a block expression.
 *
 * A block may contain zero or more statements followed by an optional trailing
 * expression whose value becomes the value of the block.
 *
 * Grammar:
 *
 * ```text
 * Block ::= "{"
 *             Statement*
 *             Expression?
 *           "}"
 * ```
 *
 * Example:
 *
 * ```hedge
 * {
 *   let x = 1;
 *   let y = 2;
 *   add(x, y)
 * }
 * ```
 */
function parseBlock(tokens: readonly Token[], pos: number): Parsed<Block> {
  const start = pos;
  let cursor = expectPunct(tokens, pos, "{");
  const statements: Statement[] = [];
  let trailing: Expression | null = null;
  while (!isPunct(tokenAt(tokens, cursor), "}")) {
    const token = tokenAt(tokens, cursor);
    if (token.kind === "keyword" && token.text === "let") {
      const letParsed = parseLetStatement(tokens, cursor);
      statements.push(letParsed.node);
      cursor = letParsed.next;
      continue;
    }
    const parsed = parseExpression(tokens, cursor);
    cursor = parsed.next;
    if (isPunct(tokenAt(tokens, cursor), ";")) {
      statements.push(expressionStatement(parsed.node));
      cursor += 1;
      continue;
    }
    trailing = parsed.node;
    break;
  }
  const block: Block = {
    kind: "Block",
    tokenId: start,
    statements,
    trailingExpression: trailing,
  };
  return { node: block, next: expectPunct(tokens, cursor, "}") };
}

/**
 * Parses a function declaration.
 *
 * Slice-1 supports only:
 *
 * - No parameters
 * - No generics
 * - No return type
 * - A required block body
 *
 * Grammar:
 *
 * ```text
 * FunctionDecl ::= "fn" Identifier "(" ")" Block
 * ```
 */
function parseFunction(
  tokens: readonly Token[],
  pos: number,
): Parsed<FunctionDecl> {
  const start = pos;
  const afterFn = expectKeyword(tokens, pos, "fn");
  const name = parseIdentifier(tokens, afterFn);
  const afterOpen = expectPunct(tokens, name.next, "(");
  const afterClose = expectPunct(tokens, afterOpen, ")");
  const body = parseBlock(tokens, afterClose);
  const fn: FunctionDecl = {
    kind: "Function",
    tokenId: start,
    name: name.node,
    generics: [],
    params: [],
    returnType: null,
    whereClause: null,
    body: body.node,
  };
  return { node: fn, next: body.next };
}

/**
 * Parses a top-level item.
 *
 * Supported slice-1 items:
 *
 * - Function declarations
 * - Let statements
 * - Expression statements
 * - Bare expressions
 */
function parseItem(tokens: readonly Token[], pos: number): Parsed<Item> {
  const token = tokenAt(tokens, pos);
  if (token.kind === "keyword" && token.text === "fn") {
    return parseFunction(tokens, pos);
  }
  if (token.kind === "keyword" && token.text === "let") {
    return parseLetStatement(tokens, pos);
  }
  const parsed = parseExpression(tokens, pos);
  if (isPunct(tokenAt(tokens, parsed.next), ";")) {
    return { node: expressionStatement(parsed.node), next: parsed.next + 1 };
  }
  return parsed;
}

/**
 * Parse a token stream into a {@link Program}.
 *
 * Current slice support:
 *
 * - Function declarations
 * - Let statements
 * - Blocks
 * - Path expressions
 * - Call expressions
 * - Reference expressions
 * - String literals
 * - Integer literals
 *
 * The parser is intentionally implemented as a small recursive-descent parser
 * that grows incrementally toward the complete grammar defined in
 * `specification/0025-grammar.md`.
 *
 * @throws SyntaxError if the token stream does not conform to the supported
 * grammar.
 */
export function parse(tokens: readonly Token[]): Program {
  const items: Item[] = [];
  let cursor = 0;
  while (tokenAt(tokens, cursor).kind !== "eof") {
    const item = parseItem(tokens, cursor);
    items.push(item.node);
    cursor = item.next;
  }
  return { kind: "Program", items };
}
