import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
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

/** The result of parsing a token stream: an optional program plus any parse-time diagnostics. */
export interface ParseResult {
  readonly program: Option<Program>;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * @returns `Some(token)` at {@link pos}, or pushes a {@link Diagnostic} and
 * returns `None` if the parser attempts to read beyond the end of the token stream.
 */
function tokenAt(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Token> {
  const token = tokens[pos];
  if (token === undefined) {
    diagnostics.push({
      severity: "error",
      message: `Unexpected end of input at token ${pos}`,
      span: none(),
    });
    return none();
  }
  return some(token);
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
 * @returns `Some(next)` with the index of the next token, or `None` if the
 * token at `pos` is not of the expected kind.
 */
function expect(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  kind: Token["kind"],
): Option<number> {
  const tokenAtResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenAtResult)) {
    return none();
  }
  const token = tokenAtResult.value;
  if (token.kind !== kind) {
    diagnostics.push({
      severity: "error",
      message: `Expected ${kind}, found "${token.kind}" at offset ${token.span.start}`,
      span: some(token.span),
    });
    return none();
  }
  return some(pos + 1);
}

/**
 * Consumes a required keyword token.
 *
 * @returns `Some(next)` with the index after the keyword, or `None` if the
 * expected keyword is not present.
 */
function expectKeyword(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  text: string,
): Option<number> {
  const tokenAtResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenAtResult)) {
    return none();
  }
  const token = tokenAtResult.value;
  if (token.kind !== "keyword" || token.text !== text) {
    const found = token.kind === "keyword" ? token.text : token.kind;
    diagnostics.push({
      severity: "error",
      message: `Expected keyword "${text}", found "${found}" at offset ${token.span.start}`,
      span: some(token.span),
    });
    return none();
  }
  return some(pos + 1);
}

const MUT_MESSAGE: string =
  "The keyword `mut` is reserved and cannot be used as an identifier. If you meant mutability, try `bind` for reassignment and/or `write` for mutation.";

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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Identifier>> {
  const tokenAtResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenAtResult)) {
    return none();
  }
  const token = tokenAtResult.value;
  if (token.kind === "keyword" && token.text === "mut") {
    diagnostics.push({
      severity: "error",
      span: some({ start: token.span.start, end: token.span.end }),
      message: MUT_MESSAGE,
    });
    return none();
  }

  if (token.kind !== "ident") {
    const found =
      token.kind === "keyword" ? `keyword "${token.text}"` : `"${token.kind}"`;
    diagnostics.push({
      severity: "error",
      message: `Expected an identifier, found ${found} at offset ${token.span.start}`,
      span: some(token.span),
    });
    return none();
  }
  const ident: Identifier = {
    kind: "Identifier",
    tokenId: pos,
    text: token.text,
  };
  return some({ node: ident, next: pos + 1 });
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
// eslint-disable-next-line complexity -- isSome-threading adds a branch per step; extracting helpers would obscure the grammar structure.
function parsePathSegments(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Path>> {
  let cursor = pos;
  let absolute = false;

  const tokenResult = tokenAt(tokens, diagnostics, cursor);
  if (!isSome(tokenResult)) {
    return none();
  }
  const token = tokenResult.value;
  if (token.kind === "path_sep") {
    absolute = true;
    cursor += 1;
  }

  const nextResult = parseIdentifier(tokens, diagnostics, cursor);
  if (!isSome(nextResult)) {
    return none();
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
      if (nextToken?.kind === "keyword" && nextToken.text === "mut") {
        diagnostics.push({
          severity: "error",
          message: MUT_MESSAGE,
          span: some(nextToken.span),
        });
        return none();
      }
      const foundDesc =
        nextToken === undefined
          ? "eof"
          : nextToken.kind === "keyword"
            ? `keyword "${nextToken.text}"`
            : nextToken.kind;
      const span =
        nextToken !== undefined ? some(nextToken.span) : none<Span>();
      diagnostics.push({
        severity: "error",
        message: `Expected identifier after "::", found ${foundDesc}`,
        span,
      });
      return none();
    }
    const segmentResult = parseIdentifier(tokens, diagnostics, cursor);
    if (!isSome(segmentResult)) {
      return none();
    }
    const segment = segmentResult.value;
    segments.push(segment.node.text);
    cursor = segment.next;
  }

  return some({ node: { absolute, segments }, next: cursor });
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<PathExpression>> {
  const pathResult = parsePathSegments(tokens, diagnostics, pos);
  if (!isSome(pathResult)) {
    return none();
  }
  const path = pathResult.value;
  return some({
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<ReferenceExpression>> {
  let cursor = pos + 1;
  let mutable = false;
  const aResult = tokenAt(tokens, diagnostics, cursor);
  if (!isSome(aResult)) {
    return none();
  }
  const a = aResult.value;
  if (a.kind === "keyword" && a.text === "mut") {
    diagnostics.push({
      severity: "error",
      span: some({ start: a.span.start, end: a.span.end }),
      message: MUT_MESSAGE,
    });
    return none();
  }

  if (isContextual(a, "write")) {
    mutable = true;
    cursor += 1;
  }
  const operandResult = parsePrimary(tokens, diagnostics, cursor);
  if (!isSome(operandResult)) {
    return none();
  }
  const operand = operandResult.value;
  const reference: ReferenceExpression = {
    kind: "ReferenceExpression",
    tokenId: pos,
    mutable,
    operand: operand.node,
  };
  return some({ node: reference, next: operand.next });
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Expression>> {
  const tokenResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenResult)) {
    return none();
  }
  const token = tokenResult.value;
  if (token.kind === "string") {
    return some({
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    });
  }
  if (token.kind === "int") {
    return some({
      node: {
        kind: "IntLiteral",
        tokenId: pos,
        value: token.text.replaceAll("_", ""),
      },
      next: pos + 1,
    });
  }
  if (token.kind === "ident" || token.kind === "path_sep") {
    return parsePath(tokens, diagnostics, pos);
  }
  if (token.kind === "amp") {
    return parseReference(tokens, diagnostics, pos);
  }

  diagnostics.push({
    severity: "error",
    message: `Expected an expression, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
  });
  return none();
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Expression[]>> {
  const afterLparen = expect(tokens, diagnostics, pos, "lparen");
  if (!isSome(afterLparen)) {
    return none();
  }
  let cursor = afterLparen.value;
  const args: Expression[] = [];
  for (;;) {
    if (tokens[cursor]?.kind === "rparen") {
      break;
    }
    const argResult = parseExpression(tokens, diagnostics, cursor);
    if (!isSome(argResult)) {
      return none();
    }
    args.push(argResult.value.node);
    cursor = argResult.value.next;
    if (tokens[cursor]?.kind !== "comma") {
      break;
    }
    cursor += 1;
  }
  const afterRparen = expect(tokens, diagnostics, cursor, "rparen");
  if (!isSome(afterRparen)) {
    return none();
  }
  return some({ node: args, next: afterRparen.value });
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Expression>> {
  const primaryResult = parsePrimary(tokens, diagnostics, pos);
  if (!isSome(primaryResult)) {
    return none();
  }
  let result = primaryResult.value;
  for (;;) {
    if (tokens[result.next]?.kind !== "lparen") {
      break;
    }
    const argsResult = parseArguments(tokens, diagnostics, result.next);
    if (!isSome(argsResult)) {
      return none();
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
  return some(result);
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Type>> {
  const tokenResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenResult)) {
    return none();
  }
  const token = tokenResult.value;

  if (token.kind === "lparen") {
    const nextResult = tokenAt(tokens, diagnostics, pos + 1);
    if (!isSome(nextResult)) {
      return none();
    }
    const next = nextResult.value;
    if (next.kind === "rparen") {
      const unit: UnitType = { kind: "UnitType", tokenId: pos };
      return some({ node: unit, next: pos + 2 });
    }
    if (next.kind === "eof") {
      diagnostics.push({
        severity: "error",
        message: "expected `)` to close type, found end of input",
        span: some(token.span),
      });
      return none();
    }
    diagnostics.push({
      severity: "error",
      message: "tuple types are not supported in Slice 1",
      span: some(token.span),
    });
    return none();
  }

  if (token.kind === "ident" || token.kind === "path_sep") {
    const pathResult = parsePathSegments(tokens, diagnostics, pos);
    if (!isSome(pathResult)) {
      return none();
    }
    const named: NamedType = {
      kind: "NamedType",
      tokenId: pos,
      path: pathResult.value.node,
    };
    return some({ node: named, next: pathResult.value.next });
  }

  if (token.kind === "amp") {
    diagnostics.push({
      severity: "error",
      message:
        "reference types are not supported in Slice 1; borrows are introduced in Slice 2",
      span: some(token.span),
    });
    return none();
  }

  if (token.kind === "lbracket") {
    diagnostics.push({
      severity: "error",
      message: "slice types ([T]) are not supported in Slice 1",
      span: some(token.span),
    });
    return none();
  }

  if (token.kind === "bang") {
    diagnostics.push({
      severity: "error",
      message: "the never type (!) is not supported in Slice 1",
      span: some(token.span),
    });
    return none();
  }

  diagnostics.push({
    severity: "error",
    message: `type syntax "${token.kind}" is not supported in Slice 1`,
    span: some(token.span),
  });
  return none();
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<BindingPattern>> {
  const identResult = parseIdentifier(tokens, diagnostics, pos);
  if (!isSome(identResult)) {
    return none();
  }
  const ident = identResult.value;
  return some({
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
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
): Option<Parsed<LetStatement>> {
  const start = pos;
  const afterLet = expectKeyword(tokens, diagnostics, pos, "let");
  if (!isSome(afterLet)) {
    return none();
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

  const patternResult = parseBindingPattern(tokens, diagnostics, cursor);
  if (!isSome(patternResult)) {
    return none();
  }
  const pattern = patternResult.value;
  cursor = pattern.next;

  let typeAnnotation: Option<Type> = none();
  if (tokens[cursor]?.kind === "colon") {
    cursor += 1;
    const typeResult = parseType(tokens, diagnostics, cursor);
    if (!isSome(typeResult)) {
      return none();
    }
    typeAnnotation = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }

  let initializer: Option<Expression> = none();
  if (tokens[cursor]?.kind === "eq") {
    const initResult = parseExpression(tokens, diagnostics, cursor + 1);
    if (!isSome(initResult)) {
      return none();
    }
    initializer = some(initResult.value.node);
    cursor = initResult.value.next;
  }

  const afterSemi = expect(tokens, diagnostics, cursor, "semi");
  if (!isSome(afterSemi)) {
    return none();
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
  return some({ node: letStmt, next: afterSemi.value });
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Block>> {
  const start = pos;
  const afterLbrace = expect(tokens, diagnostics, pos, "lbrace");
  if (!isSome(afterLbrace)) {
    return none();
  }
  let cursor = afterLbrace.value;

  // Inner attributes at the start of a block document the enclosing function.
  const innerResult = collectInnerAttributes(tokens, diagnostics, cursor);
  if (!isSome(innerResult)) {
    return none();
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
    const outerResult = collectOuterAttributes(tokens, diagnostics, cursor);
    if (!isSome(outerResult)) {
      return none();
    }
    cursor = outerResult.value.next;
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    const token = tokens[cursor];
    if (token?.kind === "keyword" && token.text === "let") {
      const letResult = parseLetStatement(
        tokens,
        diagnostics,
        cursor,
        outerResult.value.attributes,
      );
      if (!isSome(letResult)) {
        return none();
      }
      statements.push(letResult.value.node);
      cursor = letResult.value.next;
      continue;
    }
    const exprResult = parseExpression(tokens, diagnostics, cursor);
    if (!isSome(exprResult)) {
      return none();
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
  const afterRbrace = expect(tokens, diagnostics, cursor, "rbrace");
  if (!isSome(afterRbrace)) {
    return none();
  }
  return some({ node: block, next: afterRbrace.value });
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<AttributeArg>> {
  const tokenAtResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenAtResult)) {
    return none();
  }
  const token = tokenAtResult.value;
  if (token.kind === "string") {
    const lit: StringLiteral = {
      kind: "StringLiteral",
      tokenId: pos,
      value: token.text,
    };
    return some({ node: { path: none(), literal: some(lit) }, next: pos + 1 });
  }
  if (token.kind === "ident" || token.kind === "path_sep") {
    const pathResult = parsePathSegments(tokens, diagnostics, pos);
    if (!isSome(pathResult)) {
      return none();
    }
    return some({
      node: { path: some(pathResult.value.node), literal: none() },
      next: pathResult.value.next,
    });
  }
  diagnostics.push({
    severity: "error",
    message: `Expected attribute argument, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
  });
  return none();
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<{ node: Attribute; isInner: boolean; next: number }> {
  let cursor = pos + 1; // skip `#`
  let isInner = false;
  if (tokens[cursor]?.kind === "bang") {
    isInner = true;
    cursor += 1; // skip `!`
  }
  cursor += 1; // skip `[`
  const nameResult = parseIdentifier(tokens, diagnostics, cursor);
  if (!isSome(nameResult)) {
    return none();
  }
  const name = nameResult.value;
  cursor = name.next;

  const args: AttributeArg[] = [];
  if (tokens[cursor]?.kind === "lparen") {
    const lparenSpan = tokens[cursor]?.span;
    cursor += 1; // skip `(`
    while (tokens[cursor]?.kind !== "rparen") {
      if (tokens[cursor]?.kind === "eof") {
        diagnostics.push({
          severity: "error",
          message: "unterminated attribute argument list",
          span: lparenSpan !== undefined ? some(lparenSpan) : none(),
        });
        return none();
      }
      const argResult = parseAttributeArg(tokens, diagnostics, cursor);
      if (!isSome(argResult)) {
        return none();
      }
      args.push(argResult.value.node);
      cursor = argResult.value.next;
      if (tokens[cursor]?.kind === "comma") {
        cursor += 1;
      }
    }
    const afterRparen = expect(tokens, diagnostics, cursor, "rparen");
    if (!isSome(afterRparen)) {
      return none();
    }
    cursor = afterRparen.value;
  }
  const afterRbracket = expect(tokens, diagnostics, cursor, "rbracket");
  if (!isSome(afterRbracket)) {
    return none();
  }
  cursor = afterRbracket.value;

  const attr: Attribute = {
    kind: "Attribute",
    name: name.node,
    arguments: args.length > 0 ? some(args) : none(),
  };
  return some({ node: attr, isInner, next: cursor });
}

/**
 * Collects all consecutive outer attributes (`#[...]`) starting at `pos`.
 *
 * @returns `Some` with the collected attributes and the position after the last one.
 */
function collectOuterAttributes(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<{ attributes: Attribute[]; next: number }> {
  const attributes: Attribute[] = [];
  let cursor = pos;
  while (isOuterAttribute(tokens, cursor)) {
    const parsedResult = parseAttribute(tokens, diagnostics, cursor);
    if (!isSome(parsedResult)) {
      return none();
    }
    attributes.push(parsedResult.value.node);
    cursor = parsedResult.value.next;
  }
  return some({ attributes, next: cursor });
}

/**
 * Collects all consecutive inner attributes (`#![...]`) starting at `pos`.
 *
 * @returns `Some` with the collected attributes and the position after the last one.
 */
function collectInnerAttributes(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<{ attributes: Attribute[]; next: number }> {
  const attributes: Attribute[] = [];
  let cursor = pos;
  while (isInnerAttribute(tokens, cursor)) {
    const parsedResult = parseAttribute(tokens, diagnostics, cursor);
    if (!isSome(parsedResult)) {
      return none();
    }
    attributes.push(parsedResult.value.node);
    cursor = parsedResult.value.next;
  }
  return some({ attributes, next: cursor });
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
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): Option<Parsed<FunctionDecl>> {
  const start = pos;
  const afterFn = expectKeyword(tokens, diagnostics, pos, "fn");
  if (!isSome(afterFn)) {
    return none();
  }
  const nameResult = parseIdentifier(tokens, diagnostics, afterFn.value);
  if (!isSome(nameResult)) {
    return none();
  }
  const name = nameResult.value;
  const afterOpen = expect(tokens, diagnostics, name.next, "lparen");
  if (!isSome(afterOpen)) {
    return none();
  }
  const afterClose = expect(tokens, diagnostics, afterOpen.value, "rparen");
  if (!isSome(afterClose)) {
    return none();
  }
  let cursor = afterClose.value;
  let returnType: Option<Type> = none();
  if (tokens[cursor]?.kind === "arrow") {
    cursor += 1;
    const typeResult = parseType(tokens, diagnostics, cursor);
    if (!isSome(typeResult)) {
      return none();
    }
    returnType = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }
  const bodyResult = parseBlock(tokens, diagnostics, cursor);
  if (!isSome(bodyResult)) {
    return none();
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
  return some({ node: fn, next: body.next });
}

/** Parses an optional `pub` or `pub(scope)` visibility prefix. */
function parseVisibility(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Parsed<Option<Visibility>> {
  void diagnostics;
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
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Item>> {
  // Collect outer attributes (#[...]) before the item and attach them to the
  // named declaration that follows (a function or a `let`).
  const outerResult = collectOuterAttributes(tokens, diagnostics, pos);
  if (!isSome(outerResult)) {
    return none();
  }
  const attributes = outerResult.value.attributes;
  const cursor = outerResult.value.next;

  const vis = parseVisibility(tokens, diagnostics, cursor);
  const afterVis = vis.next;
  const token = tokens[afterVis];
  if (token?.kind === "keyword" && token.text === "fn") {
    const fnResult = parseFunction(
      tokens,
      diagnostics,
      afterVis,
      attributes,
      vis.node,
    );
    if (!isSome(fnResult)) {
      return none();
    }
    return some(fnResult.value);
  }
  if (token?.kind === "keyword" && token.text === "let") {
    if (afterVis > cursor) {
      const visToken = tokens[cursor];
      diagnostics.push({
        severity: "error",
        message: "visibility qualifiers are not allowed on let statements",
        span: visToken !== undefined ? some(visToken.span) : none(),
      });
      return none();
    }
    const letResult = parseLetStatement(
      tokens,
      diagnostics,
      afterVis,
      attributes,
    );
    if (!isSome(letResult)) {
      return none();
    }
    return some(letResult.value);
  }
  const exprResult = parseExpression(tokens, diagnostics, cursor);
  if (!isSome(exprResult)) {
    return none();
  }
  const parsed = exprResult.value;
  if (tokens[parsed.next]?.kind === "semi") {
    return some({
      node: expressionStatement(parsed.node),
      next: parsed.next + 1,
    });
  }
  return some(parsed);
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
 */
export function parse(tokens: readonly Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  // Program-level inner attributes (#![...]) apply to the module itself.
  const innerResult = collectInnerAttributes(tokens, diagnostics, cursor);
  if (!isSome(innerResult)) {
    return { program: none(), diagnostics };
  }
  const attributes = innerResult.value.attributes;
  cursor = innerResult.value.next;

  const items: Item[] = [];
  for (;;) {
    const peekResult = tokenAt(tokens, diagnostics, cursor);
    if (!isSome(peekResult)) {
      return { program: none(), diagnostics };
    }
    if (peekResult.value.kind === "eof") {
      break;
    }
    const itemResult = parseItem(tokens, diagnostics, cursor);
    if (!isSome(itemResult)) {
      return { program: none(), diagnostics };
    }
    items.push(itemResult.value.node);
    cursor = itemResult.value.next;
  }
  return { program: some({ kind: "Program", items, attributes }), diagnostics };
}
