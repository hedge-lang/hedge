import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type { Identifier, Path, PathExpression } from "./ast.js";
import type { Parsed } from "./parse.js";
import { tokenAt } from "./parse-utils.js";

export const MUT_MESSAGE: string =
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
export function parseIdentifier(
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
export function parsePathSegments(
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
export function parsePath(
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
