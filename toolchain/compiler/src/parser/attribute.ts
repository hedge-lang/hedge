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
      "HEDGE-PARSE-001",
      `Expected attribute argument, found "${token.kind}" at offset ${token.span.start}`,
      some(token.span),
    ),
  );
}

/**
 * Skips an attribute's leading `#`/`#!` sigil and `[`, returning the
 * position of the first token inside the brackets.
 */
function skipAttributeSigil(
  tokens: readonly Token[],
  pos: number,
): { cursor: number; isInner: boolean } {
  let cursor = pos + 1; // skip `#`
  let isInner = false;
  if (tokens[cursor]?.kind === "bang") {
    isInner = true;
    cursor += 1; // skip `!`
  }
  cursor += 1; // skip `[`
  return { cursor, isInner };
}

/**
 * Parses a parenthesized, comma-separated attribute argument list starting
 * at `pos`, which must point at the opening `(`. Fail-fast, matching this
 * file's style: a malformed argument or an unterminated list aborts
 * immediately rather than recovering (contrast `item.ts`'s comma lists,
 * which accumulate diagnostics and resync).
 */
function parseAttributeArgList(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<AttributeArg[]>> {
  const lparenSpan = tokens[pos]?.span;
  let cursor = pos + 1; // skip `(`
  const args: AttributeArg[] = [];
  while (tokens[cursor]?.kind !== "rparen") {
    if (tokens[cursor]?.kind === "eof") {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-002",
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
  return ok({ node: args, next: afterRparen.value });
}

/**
 * Parses a complete attribute token sequence.
 *
 * Outer form: `#[name(arg, arg)]`
 * Inner form: `#![name(arg, arg)]`
 *
 * @returns The parsed Attribute and whether it was an inner attribute.
 */
function parseAttribute(
  tokens: readonly Token[],
  pos: number,
): PR<{ node: Attribute; isInner: boolean; next: number }> {
  const { cursor: afterSigil, isInner } = skipAttributeSigil(tokens, pos);
  const nameResult = parseIdentifier(tokens, afterSigil);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const name = nameResult.value;
  let cursor = name.next;

  let args: AttributeArg[] = [];
  if (tokens[cursor]?.kind === "lparen") {
    const argsResult = parseAttributeArgList(tokens, cursor);
    if (isErr(argsResult)) {
      return argsResult;
    }
    args = argsResult.value.node;
    cursor = argsResult.value.next;
  }
  const afterRbracket = expect(tokens, cursor, "rbracket");
  if (isErr(afterRbracket)) {
    return afterRbracket;
  }

  const attr: Attribute = {
    kind: "Attribute",
    name: name.node,
    arguments: args.length > 0 ? some(args) : none(),
  };
  return ok({ node: attr, isInner, next: afterRbracket.value });
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
