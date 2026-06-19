import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type { Attribute, FunctionDecl, Item, Type, Visibility } from "./ast.js";
import type { Parsed } from "./parse.js";
import { expect, expectKeyword } from "./parse-utils.js";
import { collectOuterAttributes } from "./attribute.js";
import { expressionStatement, parseExpression } from "./expression.js";
import { parseIdentifier } from "./path.js";
import { parseLetStatement, parseBlock } from "./statement.js";
import { parseType } from "./type.js";

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
export function parseItem(
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
