import { errorDiagnostic } from "../diagnostics/index.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Path, PathExpression } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  MUT_MESSAGE,
  parseIdentifier,
  pathKeywordAt,
  tokenAt,
  unsupportedPathKeywordMessage,
  type PR,
} from "./parse-utils.js";

/**
 * Parses a path (absolute or relative, one or more `::` separated segments).
 *
 * ```text
 * Path ::= "::"? PathSegment ("::" PathSegment)*
 * ```
 *
 * `allowSelfHead` permits a leading `Self` instead of guardrail-rejecting it:
 * spec 0025's `Type` production allows `Self`, and `Self::Item` is just a
 * `Path` headed by the `Self` segment. `self`/`super` stay rejected either way.
 */
// eslint-disable-next-line complexity -- Result-threading adds an isErr branch per step; extracting helpers would obscure the grammar structure.
function parsePathSegmentsWithSelfHead(
  tokens: readonly Token[],
  pos: number,
  allowSelfHead: boolean,
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

  const firstKeyword = pathKeywordAt(tokens, cursor);
  if (isSome(firstKeyword)) {
    const selfHeadAllowed = allowSelfHead && firstKeyword.value.text === "Self";
    if (!selfHeadAllowed) {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-004",
          unsupportedPathKeywordMessage(firstKeyword.value.text),
          some(firstKeyword.value.span),
        ),
      );
    }
  }

  const segments: string[] = [];
  if (isSome(firstKeyword)) {
    segments.push(firstKeyword.value.text);
    cursor += 1;
  } else {
    const nextResult = parseIdentifier(tokens, cursor);
    if (isErr(nextResult)) {
      return nextResult;
    }
    segments.push(nextResult.value.node.text);
    cursor = nextResult.value.next;
  }

  for (;;) {
    if (tokens[cursor]?.kind !== "path_sep") {
      break;
    }
    if (tokens[cursor + 1]?.kind === "lt") {
      // Turbofish (`::<...>`) - leave the `::` unconsumed for the caller,
      // which is responsible for the actual guardrail diagnostic.
      break;
    }
    cursor += 1; // skip `::`
    const nextToken = tokens[cursor];
    if (nextToken?.kind !== "ident") {
      if (nextToken?.kind === "keyword" && nextToken.text === "mut") {
        return err(
          errorDiagnostic("HEDGE-PARSE-004", MUT_MESSAGE, some(nextToken.span)),
        );
      }
      const keyword = pathKeywordAt(tokens, cursor);
      if (isSome(keyword)) {
        return err(
          errorDiagnostic(
            "HEDGE-PARSE-004",
            unsupportedPathKeywordMessage(keyword.value.text),
            some(keyword.value.span),
          ),
        );
      }
      const foundDesc =
        nextToken === undefined
          ? "eof"
          : nextToken.kind === "keyword"
            ? `keyword "${nextToken.text}"`
            : nextToken.kind;
      const span =
        nextToken !== undefined ? some(nextToken.span) : none<Span>();
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-001",
          `Expected identifier after "::", found ${foundDesc}`,
          span,
        ),
      );
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
 * Parses a path, rejecting `self`/`super`/`Self` as a leading segment. See
 * `parseTypePathSegments` for the type-position variant that allows `Self`.
 */
export function parsePathSegments(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Path>> {
  return parsePathSegmentsWithSelfHead(tokens, pos, false);
}

/** Like `parsePathSegments`, but allows a leading `Self`. Only `type.ts` calls this. */
export function parseTypePathSegments(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Path>> {
  return parsePathSegmentsWithSelfHead(tokens, pos, true);
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
    node: {
      kind: "PathExpression",
      tokenId: pos,
      path: path.node,
      typeArguments: [],
    },
    next: path.next,
  });
}
