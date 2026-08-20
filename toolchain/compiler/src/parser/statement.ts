import { type Diagnostic, errorDiagnostic } from "../diagnostics.js";
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
  isWhileLetAt,
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
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-002",
          "expected `{` to open loop body, found end of input",
          none(),
        ),
      );
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
 * a rejected `loop`) is swallowed silently - recovery only reports the
 * outermost construct.
 */
function skipUnsupportedLoopConstruct(
  tokens: readonly Token[],
  match: LoopKeywordMatch,
): PR<{ diagnostic: Diagnostic; next: number }> {
  const diagnostic: Diagnostic = errorDiagnostic(
    "HEDGE-PARSE-004",
    unsupportedLoopMessage(match.token.text),
    some(match.token.span),
  );

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
    // Syntactically valid here; an assignment returns `()`.
    // TODO(Hedge-239): `let x: i32 = y = 5` is not rejected anywhere.
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
 * Parses an item declaration (fn, struct, const, static, or pub-prefixed
 * variant) in block position, given the loop has already confirmed one
 * starts at `pos`. `node: none()` means the item was discarded (an
 * unsupported top-level kind `parseItem` itself already recovered from) -
 * the caller should advance past it without pushing a statement. Kinds not
 * yet valid in block position (`static` chief among them - see the caller's
 * own comment on why a local `static` isn't supported) are rejected here.
 */
function parseBlockItemStatement(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Option<Statement>>> {
  const itemResult = parseItem(tokens, diagnostics, pos);
  if (isErr(itemResult)) {
    return itemResult;
  }
  const { next, node: item } = itemResult.value;
  if (!isSome(item)) {
    return ok({ node: none(), next });
  }
  if (
    item.value.kind !== "Function" &&
    item.value.kind !== "FunctionSignature" &&
    item.value.kind !== "Struct" &&
    item.value.kind !== "Enum" &&
    item.value.kind !== "Const"
  ) {
    const token = tokens[item.value.tokenId];
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-006",
        `unexpected item kind '${item.value.kind}' in block position`,
        token === undefined ? none() : some(token.span),
      ),
    );
  }
  return ok({ node: some(item.value), next });
}

type ExpressionStatementResult =
  | {
      readonly kind: "statement";
      readonly statement: Statement;
      readonly next: number;
    }
  | {
      readonly kind: "trailing";
      readonly expression: Expression;
      readonly next: number;
    };

/**
 * Parses an expression in statement position and decides whether it becomes
 * an ordinary statement or the block's own trailing expression: `;`-
 * terminated, or an `ExpressionWithBlock` (`Block`/`IfExpression`/
 * `MatchExpression`/`WhileExpression`) not immediately followed by the
 * closing `}`, both need no semicolon and are statements; anything else is
 * the trailing expression, and the caller stops the statement loop there.
 */
function parseExpressionStatementOrTrailing(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<ExpressionStatementResult> {
  const exprResult = parseExpression(tokens, diagnostics, pos);
  if (isErr(exprResult)) {
    return exprResult;
  }
  const next = exprResult.value.next;
  if (tokens[next]?.kind === "semi") {
    return ok({
      kind: "statement",
      statement: expressionStatement(exprResult.value.node),
      next: next + 1,
    });
  }
  if (
    (exprResult.value.node.kind === "Block" ||
      exprResult.value.node.kind === "IfExpression" ||
      exprResult.value.node.kind === "MatchExpression" ||
      exprResult.value.node.kind === "WhileExpression") &&
    tokens[next]?.kind !== "rbrace"
  ) {
    return ok({
      kind: "statement",
      statement: expressionStatement(exprResult.value.node),
      next,
    });
  }
  return ok({ kind: "trailing", expression: exprResult.value.node, next });
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
    // Empty statement - lone `;` carries no semantic content; skip silently.
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
    // Attributes followed by `;` - still an empty statement; discard the attributes.
    if (tokens[cursor]?.kind === "semi") {
      cursor += 1;
      continue;
    }
    if (tokens[cursor]?.kind === "eof") {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-002",
          "expected `}` to close block, found end of input",
          none(),
        ),
      );
    }
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    const token = tokens[cursor];
    // Item declarations (fn, struct, const, static, or pub-prefixed variants) in block position.
    // `static` is recognized here (so it gets this function's clear
    // "unexpected item kind" diagnostic) but deliberately excluded from the
    // allowed-kind check below: a local static's initializer could
    // otherwise reference an enclosing function's local variable/parameter,
    // but the static only ever initializes once - there's no sound "which
    // call's value" answer, so local `static` isn't supported yet (unlike
    // local `const`, whose initializer can only ever reference other
    // consts/literals and has no such ambiguity).
    if (
      token?.kind === "keyword" &&
      (token.text === "fn" ||
        token.text === "struct" ||
        token.text === "enum" ||
        token.text === "const" ||
        token.text === "static" ||
        token.text === "pub")
    ) {
      const itemStmtResult = parseBlockItemStatement(
        tokens,
        diagnostics,
        preAttrCursor,
      );
      if (isErr(itemStmtResult)) {
        return itemStmtResult;
      }
      cursor = itemStmtResult.value.next;
      if (isSome(itemStmtResult.value.node)) {
        statements.push(itemStmtResult.value.node.value);
      }
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
    // supported until Slice 6 - reject with a diagnostic and recover by
    // skipping the whole construct so later statements still parse. The
    // exact unlabeled `while` `let` sequence is the one exception: it falls
    // through to the ordinary expression path below, which routes
    // to a real `WhileExpression` via `parseExpression`/`parsePrimary`.
    const loopKeyword: Option<LoopKeywordMatch> = isWhileLetAt(tokens, cursor)
      ? none()
      : loopKeywordAt(tokens, cursor);
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
    const exprStmtResult = parseExpressionStatementOrTrailing(
      tokens,
      diagnostics,
      cursor,
    );
    if (isErr(exprStmtResult)) {
      return exprStmtResult;
    }
    cursor = exprStmtResult.value.next;
    if (exprStmtResult.value.kind === "trailing") {
      trailing = exprStmtResult.value.expression;
      break;
    }
    statements.push(exprStmtResult.value.statement);
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
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-001",
        `Expected '}' to close block`,
        closeTok !== undefined ? some(closeTok.span) : none(),
      ),
    );
  }
  return ok({ node: block, next: cursor + 1 });
}
