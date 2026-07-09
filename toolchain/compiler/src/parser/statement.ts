import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  Attribute,
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
  loopKeywordAt,
  skipBalancedBraceBlock,
  unsupportedLoopMessage,
  type LoopKeywordMatch,
  type PR,
} from "./parse-utils.js";
import { collectInnerAttributes, collectOuterAttributes } from "./attribute.js";
import { parseExpression } from "./expression.js";
import { parseItem } from "./item.js";
import { parsePattern } from "./pattern.js";
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
 * Skips past a loop's condition/pattern (if any) to find the body's opening
 * `{`. Struct literals aren't allowed bare in condition position, so the
 * first `{` at paren/bracket depth 0 is unambiguously the body.
 */
function findLoopBodyOpenBrace(
  tokens: readonly Token[],
  afterKeyword: number,
): PR<number> {
  let cursor = afterKeyword;
  let condDepth = 0;
  for (;;) {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof") {
      return err({
        severity: "error",
        message: "expected `{` to open loop body, found end of input",
        span: none(),
      });
    }
    if (condDepth === 0 && tok.kind === "lbrace") {
      return ok(cursor);
    }
    if (tok.kind === "lparen" || tok.kind === "lbracket") {
      condDepth += 1;
    }
    if (tok.kind === "rparen" || tok.kind === "rbracket") {
      condDepth = Math.max(0, condDepth - 1);
    }
    cursor += 1;
  }
}

/**
 * Recovers from a rejected `loop`/`while`/`for` statement: builds the
 * "not supported until Slice 6" diagnostic for the matched keyword, then
 * skips the whole construct as an opaque, brace-balanced token span so the
 * block's statement loop can resume at the next statement boundary.
 *
 * Anything unsupported nested inside the skipped body (e.g. a `loop` inside
 * a rejected `loop`) is swallowed silently — recovery only reports the
 * outermost construct.
 */
function skipUnsupportedLoopConstruct(
  tokens: readonly Token[],
  match: LoopKeywordMatch,
): PR<{ diagnostic: Diagnostic; next: number }> {
  const diagnostic: Diagnostic = {
    severity: "error",
    message: unsupportedLoopMessage(match.token.text),
    span: some(match.token.span),
  };

  const openBraceResult = findLoopBodyOpenBrace(tokens, match.pos + 1);
  if (isErr(openBraceResult)) {
    return openBraceResult;
  }
  const nextResult = skipBalancedBraceBlock(tokens, openBraceResult.value);
  if (isErr(nextResult)) {
    return nextResult;
  }
  return ok({ diagnostic, next: nextResult.value });
}

/**
 * Parses a `let` statement.
 *
 * Grammar:
 *
 * ```text
 * LetStatement ::=
 *   "let"
 *   Pattern
 *   (":" Type)?
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
 * let _ = 42;
 * ```
 */
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

  const patternResult = parsePattern(tokens, cursor);
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
    // Empty statement — lone `;` carries no semantic content; skip silently.
    if (tokens[cursor]?.kind === "semi") {
      cursor += 1;
      continue;
    }
    // Save position before attributes so `parseItem` can re-collect them.
    const preAttrCursor = cursor;
    const outerResult = collectOuterAttributes(tokens, cursor);
    if (isErr(outerResult)) {
      return outerResult;
    }
    cursor = outerResult.value.next;
    // Attributes followed by `;` — still an empty statement; discard the attributes.
    if (tokens[cursor]?.kind === "semi") {
      cursor += 1;
      continue;
    }
    if (tokens[cursor]?.kind === "eof") {
      return err({
        severity: "error",
        message: "expected `}` to close block, found end of input",
        span: none(),
      });
    }
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    const token = tokens[cursor];
    // Item declarations (fn, struct, or pub-prefixed variants) in block position.
    if (
      token?.kind === "keyword" &&
      (token.text === "fn" || token.text === "struct" || token.text === "pub")
    ) {
      const itemResult = parseItem(tokens, diagnostics, preAttrCursor);
      if (isErr(itemResult)) {
        return itemResult;
      }
      cursor = itemResult.value.next;
      const item = itemResult.value.node;
      if (!isSome(item)) {
        continue;
      }
      if (item.value.kind !== "Function" && item.value.kind !== "Struct") {
        return err({
          severity: "error",
          message: `unexpected item kind '${item.value.kind}' in block position`,
          span: some(tokens[item.value.tokenId].span),
        });
      }
      statements.push(item.value);
      continue;
    }
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
    // `loop`/`while`/`for` statements, optionally label-prefixed, are not
    // supported until Slice 6 — reject with a diagnostic and recover by
    // skipping the whole construct so later statements still parse.
    const loopKeyword = loopKeywordAt(tokens, cursor);
    if (isSome(loopKeyword)) {
      const skipResult = skipUnsupportedLoopConstruct(
        tokens,
        loopKeyword.value,
      );
      if (isErr(skipResult)) {
        return skipResult;
      }
      diagnostics.push(skipResult.value.diagnostic);
      cursor = skipResult.value.next;
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
