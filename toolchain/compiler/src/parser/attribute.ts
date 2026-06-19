import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type { Attribute, IntLiteral, Path, StringLiteral } from "./ast.js";
import type { Parsed } from "./parse.js";
import { expect, tokenAt } from "./parse-utils.js";
import { parseIdentifier, parsePathSegments } from "./path.js";

type AttributeArg = {
  path: Option<Path>;
  literal: Option<StringLiteral | IntLiteral>;
};

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
export function collectOuterAttributes(
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
export function collectInnerAttributes(
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
