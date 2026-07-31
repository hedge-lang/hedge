import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  ArrayType,
  Lifetime,
  NamedType,
  ReferenceType,
  Type,
  UnitType,
} from "./ast.js";
import { parseExpression } from "./expression.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  isLifetimeGenericsStart,
  pathKeywordAt,
  pathSepBeforeLt,
  tokenAt,
  tryCloseAngleList,
  unsupportedGenericsMessage,
  unsupportedLifetimeMessage,
  type GenericsCursor,
  type PR,
} from "./parse-utils.js";
import { parsePathSegments } from "./path.js";

/**
 * Parses a type.
 *
 * Slice-1 supports named types (path types) and the unit type `()`. Slice-2
 * adds reference types (`&T`, `&mut T`, `&'a T`, `&'a mut T`) - the lifetime
 * is left unresolved (`none()`) here; the elision pass fills it in as a
 * separate step over the whole `Program`, since resolution needs the full
 * signature (all reference parameters + the return type) in view at once.
 * The forms `[T]` and `!` are recognized and produce specific guardrail
 * errors; a bare `'a` in type position (no leading `&`) also still
 * guardrails, since a lifetime alone is never a valid type. All other
 * unsupported type syntax produces a generic guardrail error.
 *
 * Grammar:
 *
 * ```text
 * Type ::= "()" | Path | "&" Lifetime? "mut"? Type
 * ```
 *
 * `(Type)` (tuple syntax) is recognized and produces a guardrail diagnostic;
 * tuple types are not supported in Slice 1.
 */
// eslint-disable-next-line complexity -- Guardrail cluster; each unsupported-syntax branch is a necessary, independent case.
export function parseType(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Type>> {
  const tokenResult = tokenAt(tokens, pos);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;

  if (token.kind === "lparen") {
    const nextResult = tokenAt(tokens, pos + 1);
    if (isErr(nextResult)) {
      return nextResult;
    }
    const next = nextResult.value;
    if (next.kind === "rparen") {
      const unit: UnitType = { kind: "UnitType", tokenId: pos };
      return ok({ node: unit, next: pos + 2 });
    }
    if (next.kind === "eof") {
      return err({
        severity: "error",
        message: "expected `)` to close type, found end of input",
        span: some(token.span),
        code: none(),
        relatedSpans: [],
      });
    }
    return err({
      severity: "error",
      message: "tuple types are not supported in Slice 1",
      span: some(token.span),
      code: none(),
      relatedSpans: [],
    });
  }

  if (
    token.kind === "ident" ||
    token.kind === "path_sep" ||
    isSome(pathKeywordAt(tokens, pos))
  ) {
    const pathResult = parsePathSegments(tokens, pos);
    if (isErr(pathResult)) {
      return pathResult;
    }
    const genericToken = tokens[pathResult.value.next];
    if (genericToken?.kind === "lt") {
      const message = isLifetimeGenericsStart(tokens, pathResult.value.next)
        ? unsupportedLifetimeMessage("lifetime arguments")
        : unsupportedGenericsMessage("generic type arguments");
      return err({
        severity: "error",
        message,
        span: some(genericToken.span),
        code: none(),
        relatedSpans: [],
      });
    }
    const pathSepMatch = pathSepBeforeLt(tokens, pathResult.value.next);
    if (isSome(pathSepMatch)) {
      const message = isLifetimeGenericsStart(tokens, pathResult.value.next + 1)
        ? unsupportedLifetimeMessage("lifetime arguments")
        : unsupportedGenericsMessage("generic type arguments");
      return err({
        severity: "error",
        message,
        span: some(pathSepMatch.value.span),
        code: none(),
        relatedSpans: [],
      });
    }
    const named: NamedType = {
      kind: "NamedType",
      tokenId: pos,
      path: pathResult.value.node,
    };
    return ok({ node: named, next: pathResult.value.next });
  }

  if (token.kind === "lt") {
    return err({
      severity: "error",
      message: unsupportedGenericsMessage("generic type arguments"),
      span: some(token.span),
      code: none(),
      relatedSpans: [],
    });
  }

  if (token.kind === "amp") {
    let cursor = pos + 1;
    let lifetime: Option<Lifetime> = none();
    const lifetimeToken = tokens[cursor];
    if (lifetimeToken?.kind === "lifetime") {
      lifetime = some({
        kind: "Lifetime",
        tokenId: cursor,
        name: lifetimeToken.text,
      });
      cursor += 1;
    }
    let mutable = false;
    const mutToken = tokens[cursor];
    if (mutToken?.kind === "keyword" && mutToken.text === "mut") {
      mutable = true;
      cursor += 1;
    }
    const referentResult = parseType(tokens, cursor);
    if (isErr(referentResult)) {
      return referentResult;
    }
    const reference: ReferenceType = {
      kind: "ReferenceType",
      tokenId: pos,
      mutable,
      lifetime,
      referent: referentResult.value.node,
    };
    return ok({ node: reference, next: referentResult.value.next });
  }

  if (token.kind === "lbracket") {
    const elementResult = parseType(tokens, pos + 1);
    if (isErr(elementResult)) {
      return elementResult;
    }
    const afterElement = elementResult.value.next;
    const afterElementToken = tokens[afterElement];
    if (afterElementToken?.kind === "rbracket") {
      return err({
        severity: "error",
        message: "slice types ([T]) are not supported in Slice 1",
        span: some(token.span),
        code: none(),
        relatedSpans: [],
      });
    }
    if (afterElementToken?.kind !== "semi") {
      return err({
        severity: "error",
        message: `expected ';' or ']' in array type, found "${afterElementToken?.kind ?? "eof"}"`,
        span:
          afterElementToken !== undefined
            ? some(afterElementToken.span)
            : some(token.span),
        code: none(),
        relatedSpans: [],
      });
    }
    const lengthPos = afterElement + 1;
    // Any expression is accepted syntactically here - semantic analysis
    // (`validateSlice1Type`'s `ArrayType` case) requires it to const-fold to
    // a known integer, but that is a semantic property, not a grammar one.
    // A malformed length still fails fast, matching the rest of type
    // position; recovery diagnostics from a construct like a rejected
    // `loop`/`while` inside the length position are discarded rather than
    // propagated, since recovering mid-type would leave the enclosing
    // declaration in an inconsistent state.
    const lengthResult = parseExpression(tokens, [], lengthPos);
    if (isErr(lengthResult)) {
      return lengthResult;
    }
    const closeResult = expect(tokens, lengthResult.value.next, "rbracket");
    if (isErr(closeResult)) {
      return closeResult;
    }
    const array: ArrayType = {
      kind: "ArrayType",
      tokenId: pos,
      elementType: elementResult.value.node,
      length: lengthResult.value.node,
    };
    return ok({ node: array, next: closeResult.value });
  }

  if (token.kind === "bang") {
    return err({
      severity: "error",
      message: "the never type (!) is not supported in Slice 1",
      span: some(token.span),
      code: none(),
      relatedSpans: [],
    });
  }

  if (token.kind === "lifetime") {
    return err({
      severity: "error",
      message: unsupportedLifetimeMessage("lifetime annotations"),
      span: some(token.span),
      code: none(),
      relatedSpans: [],
    });
  }

  return err({
    severity: "error",
    message: `type syntax "${token.kind}" is not supported in Slice 1`,
    span: some(token.span),
    code: none(),
    relatedSpans: [],
  });
}

export interface TypeArgumentListResult {
  readonly typeArguments: readonly Type[];
  readonly cursor: GenericsCursor;
}

/**
 * Parses a `<...>` type-argument list, `ltPos` at the opening `<` (the
 * caller has already confirmed it's there). Shared by a turbofish
 * (`first::<i32>`) and a trait bound's own arguments (`Foo<Bar>`) - both are
 * a plain comma-separated `Type` list closed by `>`, differing only in how
 * the caller detects the opening `<` and whether it needs the returned
 * `pendingCloseHalf` (a turbofish argument that's itself generic hits the
 * Type-position guardrail before any `>>`-splitting could matter, so a
 * turbofish caller can safely discard it).
 */
export function parseTypeArgumentList(
  tokens: readonly Token[],
  ltPos: number,
): PR<TypeArgumentListResult> {
  let cursor = ltPos + 1;
  // An empty list (`<>`) still needs the `>>`-aware close check, not a bare
  // `kind === "gt"` peek - `Foo<>>` closes the empty list and an enclosing
  // one off the same `gt_gt` token, exactly like a non-empty list's own
  // close below.
  const immediateClose = tryCloseAngleList(tokens, cursor, false);
  if (immediateClose.closed) {
    return ok({ typeArguments: [], cursor: immediateClose.cursor });
  }
  const typeArguments: Type[] = [];
  for (;;) {
    const typeResult = parseType(tokens, cursor);
    if (isErr(typeResult)) {
      return typeResult;
    }
    typeArguments.push(typeResult.value.node);
    cursor = typeResult.value.next;
    if (tokens[cursor]?.kind === "comma") {
      cursor += 1;
      const closeAfterComma = tryCloseAngleList(tokens, cursor, false);
      if (closeAfterComma.closed) {
        return ok({ typeArguments, cursor: closeAfterComma.cursor });
      }
      continue;
    }
    break;
  }
  const closeResult = tryCloseAngleList(tokens, cursor, false);
  if (closeResult.closed) {
    return ok({ typeArguments, cursor: closeResult.cursor });
  }
  const badToken = tokens[cursor];
  return err({
    severity: "error",
    message: `expected ',' or '>' in type argument list, found "${badToken?.kind ?? "end of input"}"`,
    span: badToken !== undefined ? some(badToken.span) : none(),
    code: none(),
    relatedSpans: [],
  });
}
