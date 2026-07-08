import type { Span, Token } from "../lexer/token.js";
import { none, some } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Path, PathExpression } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  MUT_MESSAGE,
  parseIdentifier,
  tokenAt,
  type PR,
} from "./parse-utils.js";

/**
 * Parses a path (absolute or relative, one or more `::` separated segments).
 *
 * Grammar:
 *
 * ```text
 * Path ::= "::"? Identifier ("::" Identifier)*
 * ```
 */
// eslint-disable-next-line complexity -- Result-threading adds an isErr branch per step; extracting helpers would obscure the grammar structure.
export function parsePathSegments(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Path>> {
  let cursor = pos;
  let absolute = false;

  const tokenResult = tokenAt(tokens, cursor);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;
  if (token.kind === "path_sep") {
    absolute = true;
    cursor += 1;
  }

  const nextResult = parseIdentifier(tokens, cursor);
  if (isErr(nextResult)) {
    return nextResult;
  }
  const first = nextResult.value;
  const segments: string[] = [first.node.text];
  cursor = first.next;

  for (;;) {
    if (tokens[cursor]?.kind !== "path_sep") {
      break;
    }
    if (tokens[cursor + 1]?.kind === "lt") {
      // Turbofish (`::<...>`) — leave the `::` unconsumed for the caller,
      // which is responsible for the actual guardrail diagnostic.
      break;
    }
    cursor += 1; // skip `::`
    const nextToken = tokens[cursor];
    if (nextToken === undefined || nextToken.kind !== "ident") {
      if (nextToken?.kind === "keyword" && nextToken.text === "mut") {
        return err({
          severity: "error",
          message: MUT_MESSAGE,
          span: some(nextToken.span),
        });
      }
      const foundDesc =
        nextToken === undefined
          ? "eof"
          : nextToken.kind === "keyword"
            ? `keyword "${nextToken.text}"`
            : nextToken.kind;
      const span =
        nextToken !== undefined ? some(nextToken.span) : none<Span>();
      return err({
        severity: "error",
        message: `Expected identifier after "::", found ${foundDesc}`,
        span,
      });
    }
    const segmentResult = parseIdentifier(tokens, cursor);
    if (isErr(segmentResult)) {
      return segmentResult;
    }
    const segment = segmentResult.value;
    segments.push(segment.node.text);
    cursor = segment.next;
  }

  return ok({ node: { absolute, segments }, next: cursor });
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
  pos: number,
): PR<Parsed<PathExpression>> {
  const pathResult = parsePathSegments(tokens, pos);
  if (isErr(pathResult)) {
    return pathResult;
  }
  const path = pathResult.value;
  return ok({
    node: { kind: "PathExpression", tokenId: pos, path: path.node },
    next: path.next,
  });
}
