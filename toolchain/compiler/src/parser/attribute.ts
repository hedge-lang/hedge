import { errorDiagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Attribute, IntLiteral, Path, StringLiteral } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  parseIdentifier,
  parseIntLiteral,
  tokenAt,
  type PR,
} from "./parse-utils.js";
import { parsePathSegments } from "./path.js";

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
 * AttributeArg ::= StringLiteral | IntLiteral | Identifier
 * ```
 */
function parseAttributeArg(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<AttributeArg>> {
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
  if (token.kind === "int") {
    return ok({
      node: { path: none(), literal: some(parseIntLiteral(pos, token).node) },
      next: pos + 1,
    });
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
  return err(
    errorDiagnostic(
      some("HEDGE-PARSE-001"),
      `Expected attribute argument, found "${token.kind}" at offset ${token.span.start}`,
      some(token.span),
    ),
  );
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
): PR<{ node: Attribute; isInner: boolean; next: number }> {
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
        return err(
          errorDiagnostic(
            some("HEDGE-PARSE-002"),
            "unterminated attribute argument list",
            lparenSpan !== undefined ? some(lparenSpan) : none(),
          ),
        );
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
export function collectOuterAttributes(
  tokens: readonly Token[],
  pos: number,
): PR<{ attributes: Attribute[]; next: number }> {
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
export function collectInnerAttributes(
  tokens: readonly Token[],
  pos: number,
): PR<{ attributes: Attribute[]; next: number }> {
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
