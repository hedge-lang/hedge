import type { Token } from "../lexer/token.js";
import { none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Attribute, FunctionDecl, Item, Type, Visibility } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  expectKeyword,
  parseIdentifier,
  type PR,
} from "./parse-utils.js";
import { collectOuterAttributes } from "./attribute.js";
import { parseExpression } from "./expression.js";
import {
  expressionStatement,
  parseBlock,
  parseLetStatement,
} from "./statement.js";
import { parseType } from "./type.js";

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
): PR<Parsed<FunctionDecl>> {
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
export function parseItem(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Item>> {
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
