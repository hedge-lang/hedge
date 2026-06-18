import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { none, some, type Option } from "../option.js";
import { err, isErr, ok, type Result } from "../result.js";
import type {
  Attribute,
  BindingPattern,
  Block,
  CallExpression,
  Expression,
  ExpressionStatement,
  FunctionDecl,
  Identifier,
  IntLiteral,
  Item,
  LetStatement,
  NamedType,
  Path,
  PathExpression,
  Program,
  ReferenceExpression,
  Statement,
  StringLiteral,
  Type,
  UnitType,
  Visibility,
} from "./ast.js";
import type { Parsed } from "./parse.js";

type ParseResult<T> = Result<T, Diagnostic>;

/**
 * @returns the token at {@link pos}, or else a {@link Diagnostic} if the
 * parser attempts to read beyond the end of the token stream.
 */
function tokenAt(tokens: readonly Token[], pos: number): ParseResult<Token> {
  const token = tokens[pos];
  if (token === undefined) {
    return err({
      severity: "error",
      message: `Unexpected end of input at token ${pos}`,
      span: none(),
    });
  }
  return ok(token);
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
 * Consumes a required token of the given kind.
 *
 * @returns Index of the next token, or `Err` if the token at `pos` is not of the expected kind.
 */
function expect(
  tokens: readonly Token[],
  pos: number,
  kind: Token["kind"],
): ParseResult<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== kind) {
    return err({
      severity: "error",
      message: `Expected ${kind}, found "${token.kind}" at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  return ok(pos + 1);
}

/**
 * Consumes a required keyword token.
 *
 * @returns Index of the next token after the keyword, or `Err` if the expected keyword is not present.
 */
function expectKeyword(
  tokens: readonly Token[],
  pos: number,
  text: string,
): ParseResult<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== "keyword" || token.text !== text) {
    const found = token.kind === "keyword" ? token.text : token.kind;
    return err({
      severity: "error",
      message: `Expected keyword "${text}", found "${found}" at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  return ok(pos + 1);
}

const MUT_MESSAGE: string = "The keyword `mut` is reserved and cannot be used as an identifier. If you meant mutability, try `bind` for reassignment and/or `write` for mutation.";

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
): ParseResult<Parsed<Identifier>> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind === "keyword" && token.text === "mut") {
    return err({
      severity: "error",
      span: some({ start: token.span.start, end: token.span.end }),
      message: MUT_MESSAGE,
    });
  }

  if (token.kind !== "ident") {
    return err({
      severity: "error",
      message: `Expected an identifier, found "${token.kind}" at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  const ident: Identifier = {
    kind: "Identifier",
    tokenId: pos,
    text: token.text,
  };
  return ok({ node: ident, next: pos + 1 });
}

/**
 * Parses a path (absolute or relative, one or more `::` separated segments).
 *
 * Grammar:
 *
 * ```text
 * Path ::= "::"? Identifier ("::" Identifier)*
 * ```
 */
// eslint-disable-next-line complexity -- Result-threading adds an isErr branch per step; extracting helpers would obscure the grammar structure.
function parsePathSegments(
  tokens: readonly Token[],
  pos: number,
): ParseResult<Parsed<Path>> {
  let cursor = pos;
  let absolute = false;

  const tokenResult = tokenAt(tokens, cursor);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;
  if (token.kind === "path_sep") {
    absolute = true;
    cursor += 1;
  }

  const nextResult = parseIdentifier(tokens, cursor);
  if (isErr(nextResult)) {
    return nextResult;
  }
  const first = nextResult.value;
  const segments: string[] = [first.node.text];
  cursor = first.next;

  for (;;) {
    if (tokens[cursor]?.kind !== "path_sep") {
      break;
    }
    cursor += 1; // skip `::`
    const nextToken = tokens[cursor];
    if (nextToken === undefined || nextToken.kind !== "ident") {
      const kind = nextToken?.kind ?? "eof";
      const span =
        nextToken !== undefined ? some(nextToken.span) : none<Span>();
      return err({
        severity: "error",
        message: `Expected identifier after "::", found "${kind}"`,
        span,
      });
    }
    const segmentResult = parseIdentifier(tokens, cursor);
    if (isErr(segmentResult)) {
      return segmentResult;
    }
    const segment = segmentResult.value;
    segments.push(segment.node.text);
    cursor = segment.next;
  }

  return ok({ node: { absolute, segments }, next: cursor });
}

/**
 * Parses a path expression.
 *
 * Grammar:
 *
 * ```text
 * PathExpression ::= Path
 * ```
 */
function parsePath(
  tokens: readonly Token[],
  pos: number,
): ParseResult<Parsed<PathExpression>> {
  const pathResult = parsePathSegments(tokens, pos);
  if (isErr(pathResult)) {
    return pathResult;
  }
  const path = pathResult.value;
  return ok({
    node: { kind: "PathExpression", tokenId: pos, path: path.node },
    next: path.next,
  });
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
): ParseResult<Parsed<ReferenceExpression>> {
  let cursor = pos + 1;
  let mutable = false;
  const aResult = tokenAt(tokens, cursor);
  if (isErr(aResult)) {
    return aResult;
  }
  const a = aResult.value;
  if (a.kind === "keyword" && a.text === "mut") {
    return err({
      severity: "error",
      span: some({ start: a.span.start, end: a.span.end }),
      message: MUT_MESSAGE,
    });
  }

  if (isContextual(a, "write")) {
    mutable = true;
    cursor += 1;
  }
  const operandResult = parsePrimary(tokens, cursor);
  if (isErr(operandResult)) {
    return operandResult;
  }
  const operand = operandResult.value;
  const reference: ReferenceExpression = {
    kind: "ReferenceExpression",
    tokenId: pos,
    mutable,
    operand: operand.node,
  };
  return ok({ node: reference, next: operand.next });
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
): ParseResult<Parsed<Expression>> {
  const tokenResult = tokenAt(tokens, pos);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;
  if (token.kind === "string") {
    return ok({
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    });
  }
  if (token.kind === "int") {
    return ok({
      node: {
        kind: "IntLiteral",
        tokenId: pos,
        value: token.text.replaceAll("_", ""),
      },
      next: pos + 1,
    });
  }
  if (token.kind === "ident" || token.kind === "path_sep") {
    return parsePath(tokens, pos);
  }
  if (token.kind === "amp") {
    return parseReference(tokens, pos);
  }

  return err({
    severity: "error",
    message: `Expected an expression, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
  });
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
): ParseResult<Parsed<Expression[]>> {
  const afterLparen = expect(tokens, pos, "lparen");
  if (isErr(afterLparen)) {
    return afterLparen;
  }
  let cursor = afterLparen.value;
  const args: Expression[] = [];
  for (;;) {
    if (tokens[cursor]?.kind === "rparen") {
      break;
    }
    const argResult = parseExpression(tokens, cursor);
    if (isErr(argResult)) {
      return argResult;
    }
    args.push(argResult.value.node);
    cursor = argResult.value.next;
    if (tokens[cursor]?.kind !== "comma") {
      break;
    }
    cursor += 1;
  }
  const afterRparen = expect(tokens, cursor, "rparen");
  if (isErr(afterRparen)) {
    return afterRparen;
  }
  return ok({ node: args, next: afterRparen.value });
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
): ParseResult<Parsed<Expression>> {
  const resultResult = parsePrimary(tokens, pos);
  if (isErr(resultResult)) {
    return resultResult;
  }
  let result = resultResult.value;
  for (;;) {
    if (tokens[result.next]?.kind !== "lparen") {
      break;
    }
    const argsResult = parseArguments(tokens, result.next);
    if (isErr(argsResult)) {
      return argsResult;
    }
    const args = argsResult.value;
    const call: CallExpression = {
      kind: "CallExpression",
      tokenId: result.node.tokenId,
      callee: result.node,
      arguments: args.node,
    };
    result = { node: call, next: args.next };
  }
  return ok(result);
}

/**
 * Parses a type.
 *
 * Slice-1 supports named types (path types) and the unit type `()`.
 * The forms `&T`, `&write T`, `[T]`, and `!` are recognized and produce
 * specific guardrail errors; all other unsupported type syntax produces a
 * generic guardrail error.
 *
 * Grammar:
 *
 * ```text
 * Type ::= "()" | Path
 * ```
 *
 * `(Type)` (tuple syntax) is recognized and produces a guardrail diagnostic;
 * tuple types are not supported in Slice 1.
 */
function parseType(
  tokens: readonly Token[],
  pos: number,
): ParseResult<Parsed<Type>> {
  const tokenResult = tokenAt(tokens, pos);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;

  if (token.kind === "lparen") {
    const nextResult = tokenAt(tokens, pos + 1);
    if (isErr(nextResult)) {
      return nextResult;
    }
    const next = nextResult.value;
    if (next.kind === "rparen") {
      const unit: UnitType = { kind: "UnitType", tokenId: pos };
      return ok({ node: unit, next: pos + 2 });
    }
    if (next.kind === "eof") {
      return err({
        severity: "error",
        message: "expected `)` to close type, found end of input",
        span: some(token.span),
      });
    }
    return err({
      severity: "error",
      message: "tuple types are not supported in Slice 1",
      span: some(token.span),
    });
  }

  if (token.kind === "ident" || token.kind === "path_sep") {
    const pathResult = parsePathSegments(tokens, pos);
    if (isErr(pathResult)) {
      return pathResult;
    }
    const named: NamedType = {
      kind: "NamedType",
      tokenId: pos,
      path: pathResult.value.node,
    };
    return ok({ node: named, next: pathResult.value.next });
  }

  if (token.kind === "amp") {
    return err({
      severity: "error",
      message:
        "reference types are not supported in Slice 1; borrows are introduced in Slice 2",
      span: some(token.span),
    });
  }

  if (token.kind === "lbracket") {
    return err({
      severity: "error",
      message: "slice types ([T]) are not supported in Slice 1",
      span: some(token.span),
    });
  }

  if (token.kind === "bang") {
    return err({
      severity: "error",
      message: "the never type (!) is not supported in Slice 1",
      span: some(token.span),
    });
  }

  return err({
    severity: "error",
    message: `type syntax "${token.kind}" is not supported in Slice 1`,
    span: some(token.span),
  });
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
): ParseResult<Parsed<BindingPattern>> {
  const identResult = parseIdentifier(tokens, pos);
  if (isErr(identResult)) {
    return identResult;
  }
  const ident = identResult.value;
  return ok({
    node: { kind: "BindingPattern", name: ident.node },
    next: ident.next,
  });
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
// eslint-disable-next-line complexity -- Multiple optional clauses (bind, write, type, initializer) each contribute a branch; the grammar drives the complexity, not poor structure.
function parseLetStatement(
  tokens: readonly Token[],
  pos: number,
  attributes: readonly Attribute[] = [],
): ParseResult<Parsed<LetStatement>> {
  const start = pos;
  const afterLet = expectKeyword(tokens, pos, "let");
  if (isErr(afterLet)) {
    return afterLet;
  }
  let cursor = afterLet.value;

  let bind = false;
  let write = false;
  const maybeBind = tokens[cursor];
  if (maybeBind !== undefined && isContextual(maybeBind, "bind")) {
    bind = true;
    cursor += 1;
  }
  const maybeWrite = tokens[cursor];
  if (maybeWrite !== undefined && isContextual(maybeWrite, "write")) {
    write = true;
    cursor += 1;
  }

  const patternResult = parseBindingPattern(tokens, cursor);
  if (isErr(patternResult)) {
    return patternResult;
  }
  const pattern = patternResult.value;
  cursor = pattern.next;

  let typeAnnotation: Option<Type> = none();
  if (tokens[cursor]?.kind === "colon") {
    cursor += 1;
    const typeResult = parseType(tokens, cursor);
    if (isErr(typeResult)) {
      return typeResult;
    }
    typeAnnotation = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }

  let initializer: Option<Expression> = none();
  if (tokens[cursor]?.kind === "eq") {
    const initResult = parseExpression(tokens, cursor + 1);
    if (isErr(initResult)) {
      return initResult;
    }
    initializer = some(initResult.value.node);
    cursor = initResult.value.next;
  }

  const afterSemi = expect(tokens, cursor, "semi");
  if (isErr(afterSemi)) {
    return afterSemi;
  }

  const letStmt: LetStatement = {
    kind: "LetStatement",
    tokenId: start,
    attributes,
    bind,
    write,
    pattern: pattern.node,
    type: typeAnnotation,
    initializer,
  };
  return ok({ node: letStmt, next: afterSemi.value });
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
// eslint-disable-next-line complexity -- Statement-dispatch loop with attribute collection and trailing-expression detection; splitting would obscure the grammar rule.
function parseBlock(
  tokens: readonly Token[],
  pos: number,
): ParseResult<Parsed<Block>> {
  const start = pos;
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  let cursor = afterLbrace.value;

  // Inner attributes at the start of a block document the enclosing function.
  const innerResult = collectInnerAttributes(tokens, cursor);
  if (isErr(innerResult)) {
    return innerResult;
  }
  const innerAttributes = innerResult.value.attributes;
  cursor = innerResult.value.next;

  const statements: Statement[] = [];
  let trailing: Expression | null = null;
  for (;;) {
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    // Outer attributes (e.g. `/// doc`) before a statement attach to a following
    // `let` — the only named target inside a block. Before anything else they
    // have nothing to document and are discarded.
    const outerResult = collectOuterAttributes(tokens, cursor);
    if (isErr(outerResult)) {
      return outerResult;
    }
    cursor = outerResult.value.next;
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    const token = tokens[cursor];
    if (token?.kind === "keyword" && token.text === "let") {
      const letResult = parseLetStatement(
        tokens,
        cursor,
        outerResult.value.attributes,
      );
      if (isErr(letResult)) {
        return letResult;
      }
      statements.push(letResult.value.node);
      cursor = letResult.value.next;
      continue;
    }
    const exprResult = parseExpression(tokens, cursor);
    if (isErr(exprResult)) {
      return exprResult;
    }
    cursor = exprResult.value.next;
    if (tokens[cursor]?.kind === "semi") {
      statements.push(expressionStatement(exprResult.value.node));
      cursor += 1;
      continue;
    }
    trailing = exprResult.value.node;
    break;
  }
  const block: Block = {
    kind: "Block",
    tokenId: start,
    statements,
    trailingExpression: trailing !== null ? some(trailing) : none(),
    innerAttributes,
  };
  const afterRbrace = expect(tokens, cursor, "rbrace");
  if (isErr(afterRbrace)) {
    return afterRbrace;
  }
  return ok({ node: block, next: afterRbrace.value });
}

/**
 * Checks if the tokens at `pos` start an outer attribute (`#[`).
 */
function isOuterAttribute(tokens: readonly Token[], pos: number): boolean {
  return tokens[pos]?.kind === "hash" && tokens[pos + 1]?.kind === "lbracket";
}

/**
 * Checks if the tokens at `pos` start an inner attribute (`#![`).
 */
function isInnerAttribute(tokens: readonly Token[], pos: number): boolean {
  return (
    tokens[pos]?.kind === "hash" &&
    tokens[pos + 1]?.kind === "bang" &&
    tokens[pos + 2]?.kind === "lbracket"
  );
}

type AttributeArg = {
  path: Option<Path>;
  literal: Option<StringLiteral | IntLiteral>;
};

/**
 * Parses a single attribute argument: either a string literal or a path.
 *
 * Grammar:
 *
 * ```text
 * AttributeArg ::= StringLiteral | Identifier
 * ```
 */
function parseAttributeArg(
  tokens: readonly Token[],
  pos: number,
): ParseResult<Parsed<AttributeArg>> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind === "string") {
    const lit: StringLiteral = {
      kind: "StringLiteral",
      tokenId: pos,
      value: token.text,
    };
    return ok({ node: { path: none(), literal: some(lit) }, next: pos + 1 });
  }
  if (token.kind === "ident" || token.kind === "path_sep") {
    const pathResult = parsePathSegments(tokens, pos);
    if (isErr(pathResult)) {
      return pathResult;
    }
    return ok({
      node: { path: some(pathResult.value.node), literal: none() },
      next: pathResult.value.next,
    });
  }
  return err({
    severity: "error",
    message: `Expected attribute argument, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
  });
}

/**
 * Parses a complete attribute token sequence.
 *
 * Outer form: `#[name(arg, arg)]`
 * Inner form: `#![name(arg, arg)]`
 *
 * @returns The parsed Attribute and whether it was an inner attribute.
 */
// eslint-disable-next-line complexity -- Attribute parsing requires delimiter validation that adds necessary branches.
function parseAttribute(
  tokens: readonly Token[],
  pos: number,
): ParseResult<{ node: Attribute; isInner: boolean; next: number }> {
  let cursor = pos + 1; // skip `#`
  let isInner = false;
  if (tokens[cursor]?.kind === "bang") {
    isInner = true;
    cursor += 1; // skip `!`
  }
  cursor += 1; // skip `[`
  const nameResult = parseIdentifier(tokens, cursor);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const name = nameResult.value;
  cursor = name.next;

  const args: AttributeArg[] = [];
  if (tokens[cursor]?.kind === "lparen") {
    const lparenSpan = tokens[cursor]?.span;
    cursor += 1; // skip `(`
    while (tokens[cursor]?.kind !== "rparen") {
      if (tokens[cursor]?.kind === "eof") {
        return err({
          severity: "error",
          message: "unterminated attribute argument list",
          span: lparenSpan !== undefined ? some(lparenSpan) : none(),
        });
      }
      const argResult = parseAttributeArg(tokens, cursor);
      if (isErr(argResult)) {
        return argResult;
      }
      args.push(argResult.value.node);
      cursor = argResult.value.next;
      if (tokens[cursor]?.kind === "comma") {
        cursor += 1;
      }
    }
    const afterRparen = expect(tokens, cursor, "rparen");
    if (isErr(afterRparen)) {
      return afterRparen;
    }
    cursor = afterRparen.value;
  }
  const afterRbracket = expect(tokens, cursor, "rbracket");
  if (isErr(afterRbracket)) {
    return afterRbracket;
  }
  cursor = afterRbracket.value;

  const attr: Attribute = {
    kind: "Attribute",
    name: name.node,
    arguments: args.length > 0 ? some(args) : none(),
  };
  return ok({ node: attr, isInner, next: cursor });
}

/**
 * Collects all consecutive outer attributes (`#[...]`) starting at `pos`.
 *
 * @returns The collected attributes and the position after the last one.
 */
function collectOuterAttributes(
  tokens: readonly Token[],
  pos: number,
): ParseResult<{ attributes: Attribute[]; next: number }> {
  const attributes: Attribute[] = [];
  let cursor = pos;
  while (isOuterAttribute(tokens, cursor)) {
    const parsedResult = parseAttribute(tokens, cursor);
    if (isErr(parsedResult)) {
      return parsedResult;
    }
    attributes.push(parsedResult.value.node);
    cursor = parsedResult.value.next;
  }
  return ok({ attributes, next: cursor });
}

/**
 * Collects all consecutive inner attributes (`#![...]`) starting at `pos`.
 *
 * @returns The collected attributes and the position after the last one.
 */
function collectInnerAttributes(
  tokens: readonly Token[],
  pos: number,
): ParseResult<{ attributes: Attribute[]; next: number }> {
  const attributes: Attribute[] = [];
  let cursor = pos;
  while (isInnerAttribute(tokens, cursor)) {
    const parsedResult = parseAttribute(tokens, cursor);
    if (isErr(parsedResult)) {
      return parsedResult;
    }
    attributes.push(parsedResult.value.node);
    cursor = parsedResult.value.next;
  }
  return ok({ attributes, next: cursor });
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
 * FunctionDecl ::= ["pub"] "fn" Identifier "(" ")" Block
 * ```
 */
function parseFunction(
  tokens: readonly Token[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): ParseResult<Parsed<FunctionDecl>> {
  const start = pos;
  const afterFn = expectKeyword(tokens, pos, "fn");
  if (isErr(afterFn)) {
    return afterFn;
  }
  const nameResult = parseIdentifier(tokens, afterFn.value);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const name = nameResult.value;
  const afterOpen = expect(tokens, name.next, "lparen");
  if (isErr(afterOpen)) {
    return afterOpen;
  }
  const afterClose = expect(tokens, afterOpen.value, "rparen");
  if (isErr(afterClose)) {
    return afterClose;
  }
  let cursor = afterClose.value;
  let returnType: Option<Type> = none();
  if (tokens[cursor]?.kind === "arrow") {
    cursor += 1;
    const typeResult = parseType(tokens, cursor);
    if (isErr(typeResult)) {
      return typeResult;
    }
    returnType = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }
  const bodyResult = parseBlock(tokens, cursor);
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const body = bodyResult.value;
  const fn: FunctionDecl = {
    kind: "Function",
    tokenId: start,
    visibility,
    name: name.node,
    generics: [],
    params: [],
    returnType,
    whereClause: none(),
    attributes,
    body: body.node,
  };
  return ok({ node: fn, next: body.next });
}

/** Parses an optional `pub` or `pub(scope)` visibility prefix. */
function parseVisibility(
  tokens: readonly Token[],
  pos: number,
): Parsed<Option<Visibility>> {
  const token = tokens[pos];
  if (token?.kind !== "keyword" || token.text !== "pub") {
    return { node: none(), next: pos };
  }
  // Check for `pub(scope)`.
  const maybeParen = tokens[pos + 1];
  if (maybeParen?.kind === "lparen") {
    const scopeToken = tokens[pos + 2];
    const closeParen = tokens[pos + 3];
    if (scopeToken?.kind === "ident" && closeParen?.kind === "rparen") {
      return {
        node: some({ kind: "Visibility", scope: some(scopeToken.text) }),
        next: pos + 4,
      };
    }
  }
  return { node: some({ kind: "Visibility", scope: none() }), next: pos + 1 };
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
// eslint-disable-next-line complexity -- Top-level item dispatch with visibility/attribute prefix; each item kind is a necessary branch.
function parseItem(
  tokens: readonly Token[],
  pos: number,
): ParseResult<Parsed<Item>> {
  // Collect outer attributes (#[...]) before the item and attach them to the
  // named declaration that follows (a function or a `let`).
  const outerResult = collectOuterAttributes(tokens, pos);
  if (isErr(outerResult)) {
    return outerResult;
  }
  const attributes = outerResult.value.attributes;
  const cursor = outerResult.value.next;

  const vis = parseVisibility(tokens, cursor);
  const afterVis = vis.next;
  const token = tokens[afterVis];
  if (token?.kind === "keyword" && token.text === "fn") {
    const fnResult = parseFunction(tokens, afterVis, attributes, vis.node);
    if (isErr(fnResult)) {
      return fnResult;
    }
    return ok(fnResult.value);
  }
  if (token?.kind === "keyword" && token.text === "let") {
    if (afterVis > cursor) {
      const visToken = tokens[cursor];
      return err({
        severity: "error",
        message: "visibility qualifiers are not allowed on let statements",
        span: visToken !== undefined ? some(visToken.span) : none(),
      });
    }
    const letResult = parseLetStatement(tokens, afterVis, attributes);
    if (isErr(letResult)) {
      return letResult;
    }
    return ok(letResult.value);
  }
  const exprResult = parseExpression(tokens, cursor);
  if (isErr(exprResult)) {
    return exprResult;
  }
  const parsed = exprResult.value;
  if (tokens[parsed.next]?.kind === "semi") {
    return ok({
      node: expressionStatement(parsed.node),
      next: parsed.next + 1,
    });
  }
  return ok(parsed);
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
 * @returns `Ok(Program)` on success, or `Err(ParserError)` if the token stream
 * does not conform to the supported grammar.
 */
export function parse(tokens: readonly Token[]): ParseResult<Program> {
  let cursor = 0;

  // Program-level inner attributes (#![...]) apply to the module itself.
  const innerResult = collectInnerAttributes(tokens, cursor);
  if (isErr(innerResult)) {
    return innerResult;
  }
  const attributes = innerResult.value.attributes;
  cursor = innerResult.value.next;

  const items: Item[] = [];
  for (;;) {
    const peekResult = tokenAt(tokens, cursor);
    if (isErr(peekResult)) {
      return peekResult;
    }
    if (peekResult.value.kind === "eof") {
      break;
    }
    const itemResult = parseItem(tokens, cursor);
    if (isErr(itemResult)) {
      return itemResult;
    }
    items.push(itemResult.value.node);
    cursor = itemResult.value.next;
  }
  return ok({ kind: "Program", items, attributes });
}
