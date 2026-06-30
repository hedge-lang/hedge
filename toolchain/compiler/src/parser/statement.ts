import { assert } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  Attribute,
  BindingPattern,
  Block,
  Expression,
  ExpressionStatement,
  LetStatement,
  Statement,
  Type,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  expectKeyword,
  parseIdentifier,
  type PR,
} from "./parse-utils.js";
import { collectInnerAttributes, collectOuterAttributes } from "./attribute.js";
import { parseExpression } from "./expression.js";
import { parseType } from "./type.js";

/**
 * Wraps an expression as an expression statement.
 *
 * Expression statements are represented explicitly in the AST rather than
 * reusing expression nodes directly.
 */
export function expressionStatement(
  expression: Expression,
): ExpressionStatement {
  return {
    kind: "ExpressionStatement",
    tokenId: expression.tokenId,
    expression,
  };
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
): PR<Parsed<BindingPattern>> {
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
 *   "mut"?
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
 * let mut counter = 0;
 * ```
 */
// eslint-disable-next-line complexity -- Optional clauses (mut, type, initializer) each contribute a branch; the grammar drives the complexity, not poor structure.
export function parseLetStatement(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
): PR<Parsed<LetStatement>> {
  const start = pos;
  const afterLet = expectKeyword(tokens, pos, "let");
  if (isErr(afterLet)) {
    return afterLet;
  }
  let cursor = afterLet.value;

  let mutable = false;
  const maybeMut = tokens[cursor];
  if (
    maybeMut !== undefined &&
    maybeMut.kind === "keyword" &&
    maybeMut.text === "mut"
  ) {
    mutable = true;
    cursor += 1;
  }

  const patternResult = parseBindingPattern(tokens, cursor);
  if (isErr(patternResult)) {
    if (!mutable) {
      return patternResult;
    }
    const bindingPattern = parseBindingPattern(tokens, cursor - 1);
    assert(
      isErr(bindingPattern),
      "parseBindingPattern failed on a token that was already parsed successfully",
    );
    return bindingPattern;
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
    // Assignment expressions are valid let initializers syntactically — they return `()`.
    // TODO: misuse (e.g. `let x: i32 = y = 5`) is not yet validated; will be caught by the type checker.
    const initResult = parseExpression(tokens, diagnostics, cursor + 1);
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
    mutable,
    pattern: pattern.node,
    type: typeAnnotation,
    initializer,
  };
  return ok({ node: letStmt, next: afterSemi.value });
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
export function parseBlock(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Block>> {
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
        diagnostics,
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
    const exprResult = parseExpression(tokens, diagnostics, cursor);
    if (isErr(exprResult)) {
      return exprResult;
    }
    cursor = exprResult.value.next;
    if (tokens[cursor]?.kind === "semi") {
      statements.push(expressionStatement(exprResult.value.node));
      cursor += 1;
      continue;
    }
    // ExpressionWithBlock does not require a semicolon in statement position.
    // Block-like expressions (Block, IfExpression) used before the final position
    // are statements without a trailing `;`
    if (
      (exprResult.value.node.kind === "Block" ||
        exprResult.value.node.kind === "IfExpression") &&
      tokens[cursor]?.kind !== "rbrace"
    ) {
      statements.push(expressionStatement(exprResult.value.node));
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
  const closeTok = tokens[cursor];
  if (closeTok === undefined || closeTok.kind !== "rbrace") {
    return err({
      severity: "error",
      message: `Expected '}' to close block`,
      span: closeTok !== undefined ? some(closeTok.span) : none(),
    });
  }
  return ok({ node: block, next: cursor + 1 });
}
