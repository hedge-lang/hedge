import { errorDiagnostic } from "../diagnostics/index.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type { Path, PathExpression } from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  parseIdentifier,
  pathKeywordAt,
  tokenAt,
  type PR,
} from "./parse-utils.js";
import { isSelfKeywordAllowed } from "./parse-state.js";

/**
 * Parses a path (absolute or relative, one or more `::` separated segments).
 *
 * ```text
 * Path ::= "::"? PathSegment ("::" PathSegment)*
 * ```
 *
 * `allowSelfHead` permits a leading `Self` instead of guardrail-rejecting it:
 * spec 0025's `Type` production allows `Self`, and `Self::Item` is just a
 * `Path` headed by the `Self` segment. `allowSelfExprHead` additionally permits
 * a leading lowercase `self` - expression position inside a method body, where
 * `self` names the receiver. `super` stays rejected either way.
 */
// eslint-disable-next-line complexity -- Result-threading adds an isErr branch per step; extracting helpers would obscure the grammar structure.
function parsePathSegmentsWithSelfHead(
  tokens: readonly Token[],
  pos: number,
  allowSelfHead: boolean,
  allowSelfExprHead: boolean = false,
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
    const head = firstKeyword.value.text;
    const selfHeadAllowed =
      (allowSelfHead && head === "Self") ||
      (allowSelfExprHead && (head === "self" || head === "Self"));
    if (!selfHeadAllowed) {
      return err(
        errorDiagnostic(
          {
            kind: "ParseKeywordNotSupported",
            keyword: firstKeyword.value.text,
          },
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
          errorDiagnostic(
            { kind: "ParseMutReservedIdentifier" },
            some(nextToken.span),
          ),
        );
      }
      const keyword = pathKeywordAt(tokens, cursor);
      if (isSome(keyword)) {
        return err(
          errorDiagnostic(
            { kind: "ParseKeywordNotSupported", keyword: keyword.value.text },
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
          { kind: "ParseExpectedIdentifierAfterPathSep", found: foundDesc },
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
  const pathResult = parsePathSegmentsWithSelfHead(
    tokens,
    pos,
    false,
    isSelfKeywordAllowed(),
  );
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
