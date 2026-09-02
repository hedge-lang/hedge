import { errorDiagnostic } from "../diagnostics/index.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  ArrayType,
  DynType,
  Lifetime,
  NamedType,
  PathTraitBound,
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
import { parsePathSegments, parseTypePathSegments } from "./path.js";

/**
 * Result of `parseTypeWithCloseState`: a parsed `Type` plus whether it ended
 * on a `gt_gt` token that only had its first `>` spent - see that function's
 * own doc comment.
 */
interface TypeParseResult extends Parsed<Type> {
  readonly pendingCloseHalf: boolean;
}

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
 * Type ::= "()" | Path Generics? | "&" Lifetime? "mut"? Type
 * ```
 *
 * `(Type)` (tuple syntax) is recognized and produces a guardrail diagnostic;
 * tuple types are not yet supported.
 */
export function parseType(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Type>> {
  const result = parseTypeWithCloseState(tokens, pos);
  if (isErr(result)) {
    return result;
  }
  return ok({ node: result.value.node, next: result.value.next });
}

/**
 * Real implementation behind `parseType`, additionally reporting whether the
 * parsed type ended by spending only the first half of a `gt_gt` token (see
 * `tryCloseAngleList`). A bare top-level `parseType` call never needs this -
 * it always fully resolves internally, since there is no enclosing `<...>`
 * list to hand a leftover half off to. It matters only when a `Type` is
 * itself a generic argument (`parseTypeArgumentList`'s own loop): `Foo<Foo<T>>`'s
 * inner `Foo<T>` spends the first `>` of the shared `>>`, and the outer
 * `Foo<...>` list must close using the second half rather than re-reading the
 * same `gt_gt` as fresh. `ReferenceType`'s own referent recursion propagates
 * this too, since a referent can itself be the argument left half-closed
 * (`Container<&Foo<T>>`); `ArrayType`'s element recursion never needs to,
 * since its own close is the unambiguous `]`, never a shared `>`.
 */
function parseTypeWithCloseState(
  tokens: readonly Token[],
  pos: number,
): PR<TypeParseResult> {
  const tokenResult = tokenAt(tokens, pos);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;

  if (token.kind === "lparen") {
    return parseUnitOrTupleType(tokens, pos, token);
  }

  if (isNamedTypeLead(tokens, pos, token)) {
    return parseNamedTypeWithCloseState(tokens, pos);
  }

  if (token.kind === "lt") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-004",
        unsupportedGenericsMessage("generic type arguments"),
        some(token.span),
      ),
    );
  }

  if (token.kind === "amp") {
    return parseReferenceTypeWithCloseState(tokens, pos);
  }

  if (token.kind === "lbracket") {
    return parseArrayType(tokens, pos, token);
  }

  if (token.kind === "bang") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-004",
        "the never type (`!`) is not yet supported",
        some(token.span),
      ),
    );
  }

  if (token.kind === "lifetime") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-004",
        unsupportedLifetimeMessage("lifetime annotations"),
        some(token.span),
      ),
    );
  }

  if (token.kind === "keyword" && token.text === "dyn") {
    return parseDynTypeWithCloseState(tokens, pos);
  }

  return err(
    errorDiagnostic(
      "HEDGE-PARSE-004",
      `expected a type, found \`${token.kind}\``,
      some(token.span),
    ),
  );
}

/**
 * Parses `(` at `pos` (already confirmed by the caller, also passed as
 * `openParen` for its span): the unit type `()`, or a guardrail rejection
 * for tuple syntax `(Type, ...)` - tuple types are not yet supported.
 */
function parseUnitOrTupleType(
  tokens: readonly Token[],
  pos: number,
  openParen: Token,
): PR<TypeParseResult> {
  const nextResult = tokenAt(tokens, pos + 1);
  if (isErr(nextResult)) {
    return nextResult;
  }
  const next = nextResult.value;
  if (next.kind === "rparen") {
    const unit: UnitType = { kind: "UnitType", tokenId: pos };
    return ok({ node: unit, next: pos + 2, pendingCloseHalf: false });
  }
  if (next.kind === "eof") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-002",
        "expected `)` to close type, found end of input",
        some(openParen.span),
      ),
    );
  }
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-004",
      "tuple types are not yet supported",
      some(openParen.span),
    ),
  );
}

/**
 * Parses a `dyn` type at `pos` (the `dyn` keyword token already confirmed by
 * the caller): `dyn Path Generics?`, naming the trait it stands for. Unlike
 * a bound list's own `TraitBound`, `dyn` never accepts the bare-lifetime
 * alternative (`dyn 'a`), since a dyn type must name a trait.
 */
function parseDynTypeWithCloseState(
  tokens: readonly Token[],
  pos: number,
): PR<TypeParseResult> {
  const afterDyn = pos + 1;
  const nextToken = tokens[afterDyn];
  if (nextToken?.kind === "lifetime") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-004",
        "`dyn` must name a trait, not a lifetime",
        some(nextToken.span),
      ),
    );
  }
  const boundResult = parsePathTraitBound(tokens, afterDyn);
  if (isErr(boundResult)) {
    return boundResult;
  }
  const dynType: DynType = {
    kind: "DynType",
    tokenId: pos,
    bound: boundResult.value.bound,
  };
  return ok({
    node: dynType,
    next: boundResult.value.cursor.next,
    pendingCloseHalf: boundResult.value.cursor.pendingCloseHalf,
  });
}

export interface PathTraitBoundResult {
  readonly bound: PathTraitBound;
  readonly cursor: GenericsCursor;
}

/**
 * Parses `Path Generics?` as a trait bound naming a single trait - the
 * shared tail of a `TraitBound`'s two grammar alternatives, and the only
 * form `dyn` accepts. `item.ts`'s `parseTraitBound` (bound lists, which
 * also allow a bare lifetime) delegates here for its own non-lifetime case.
 */
export function parsePathTraitBound(
  tokens: readonly Token[],
  pos: number,
): PR<PathTraitBoundResult> {
  const pathResult = parsePathSegments(tokens, pos);
  if (isErr(pathResult)) {
    return pathResult;
  }
  let cursor: GenericsCursor = {
    next: pathResult.value.next,
    pendingCloseHalf: false,
  };
  let typeArguments: readonly Type[] = [];
  if (tokens[cursor.next]?.kind === "lt") {
    const argsResult = parseTypeArgumentList(tokens, cursor.next);
    if (isErr(argsResult)) {
      return argsResult;
    }
    typeArguments = argsResult.value.typeArguments;
    cursor = argsResult.value.cursor;
  }
  return ok({
    bound: {
      kind: "PathTraitBound",
      tokenId: pos,
      path: pathResult.value.node,
      typeArguments,
    },
    cursor,
  });
}

/** True when `token` can start a named type: an identifier, a leading `::`,
 * or a path keyword (`Self`, ...). */
function isNamedTypeLead(
  tokens: readonly Token[],
  pos: number,
  token: Token,
): boolean {
  return (
    token.kind === "ident" ||
    token.kind === "path_sep" ||
    isSome(pathKeywordAt(tokens, pos))
  );
}

/**
 * Parses a path-rooted type at `pos` (an `ident`/`path_sep`/path-keyword
 * token already confirmed by the caller): a bare `NamedType`, one with a
 * `<...>` type-argument list, or a guardrail rejection for `::<...>`/`<...>`
 * lifetime arguments.
 */
function parseNamedTypeWithCloseState(
  tokens: readonly Token[],
  pos: number,
): PR<TypeParseResult> {
  const pathResult = parseTypePathSegments(tokens, pos);
  if (isErr(pathResult)) {
    return pathResult;
  }
  const genericToken = tokens[pathResult.value.next];
  if (genericToken?.kind === "lt") {
    if (isLifetimeGenericsStart(tokens, pathResult.value.next)) {
      return err(
        errorDiagnostic(
          "HEDGE-PARSE-004",
          unsupportedLifetimeMessage("lifetime arguments"),
          some(genericToken.span),
        ),
      );
    }
    const argsResult = parseTypeArgumentList(tokens, pathResult.value.next);
    if (isErr(argsResult)) {
      return argsResult;
    }
    const named: NamedType = {
      kind: "NamedType",
      tokenId: pos,
      path: pathResult.value.node,
      typeArguments: argsResult.value.typeArguments,
    };
    return ok({
      node: named,
      next: argsResult.value.cursor.next,
      pendingCloseHalf: argsResult.value.cursor.pendingCloseHalf,
    });
  }
  const pathSepMatch = pathSepBeforeLt(tokens, pathResult.value.next);
  if (isSome(pathSepMatch)) {
    const message = isLifetimeGenericsStart(tokens, pathResult.value.next + 1)
      ? unsupportedLifetimeMessage("lifetime arguments")
      : unsupportedGenericsMessage("generic type arguments");
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-004",
        message,
        some(pathSepMatch.value.span),
      ),
    );
  }
  const named: NamedType = {
    kind: "NamedType",
    tokenId: pos,
    path: pathResult.value.node,
    typeArguments: [],
  };
  return ok({
    node: named,
    next: pathResult.value.next,
    pendingCloseHalf: false,
  });
}

/**
 * Parses a reference type at `pos` (the `&` token already confirmed by the
 * caller): an optional lifetime, an optional `mut`, then the referent type
 * via a recursive `parseTypeWithCloseState` call.
 */
function parseReferenceTypeWithCloseState(
  tokens: readonly Token[],
  pos: number,
): PR<TypeParseResult> {
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
  const referentResult = parseTypeWithCloseState(tokens, cursor);
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
  return ok({
    node: reference,
    next: referentResult.value.next,
    pendingCloseHalf: referentResult.value.pendingCloseHalf,
  });
}

/**
 * Parses an array type at `pos` (the `[` token already confirmed by the
 * caller, also passed as `openBracket` for its span): element type, `;`,
 * length expression, closing `]`. A bare `[T]` (no `;`) is the still-rejected
 * slice-type guardrail, not a parse error.
 */
function parseArrayType(
  tokens: readonly Token[],
  pos: number,
  openBracket: Token,
): PR<TypeParseResult> {
  const elementResult = parseType(tokens, pos + 1);
  if (isErr(elementResult)) {
    return elementResult;
  }
  const afterElement = elementResult.value.next;
  const afterElementToken = tokens[afterElement];
  if (afterElementToken?.kind === "rbracket") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-004",
        "slice types (`[T]`) are not yet supported",
        some(openBracket.span),
      ),
    );
  }
  if (afterElementToken?.kind !== "semi") {
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-001",
        `expected ';' or ']' in array type, found "${afterElementToken?.kind ?? "eof"}"`,
        afterElementToken !== undefined
          ? some(afterElementToken.span)
          : some(openBracket.span),
      ),
    );
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
  return ok({
    node: array,
    next: closeResult.value,
    pendingCloseHalf: false,
  });
}

export interface TypeArgumentListResult {
  readonly typeArguments: readonly Type[];
  readonly cursor: GenericsCursor;
}

/**
 * Parses a `<...>` type-argument list, `ltPos` at the opening `<` (the
 * caller has already confirmed it's there). Shared by a turbofish
 * (`first::<i32>`), a trait bound's own arguments (`Foo<Bar>`), and a
 * `NamedType`'s own arguments in type position (`Vec<T>`) - all three are a
 * plain comma-separated `Type` list closed by `>`, differing only in how the
 * caller detects the opening `<` and what it does with the returned
 * `pendingCloseHalf`: a trait bound's caller (`item.ts`'s
 * `parseGenericParamList`/`parseTraitBound` family) is already
 * `GenericsCursor`-aware throughout and threads it on unchanged, while a
 * turbofish has no enclosing `<...>` list of its own to hand a leftover half
 * off to, so its caller (`expression.ts`'s `parseTurbofishTypeArguments`)
 * must resolve it immediately instead.
 *
 * Each argument is parsed via `parseTypeWithCloseState` rather than the
 * public `parseType`, since a `Type` argument can itself be a generic
 * `NamedType` (`Foo<Bar<Baz>>`) ending on a `gt_gt` it only half-closed -
 * that `pendingCloseHalf` is threaded into this list's own close checks
 * below instead of being re-treated as a fresh, unclaimed `gt_gt`.
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
  let pendingCloseHalf = false;
  for (;;) {
    const typeResult = parseTypeWithCloseState(tokens, cursor);
    if (isErr(typeResult)) {
      return typeResult;
    }
    typeArguments.push(typeResult.value.node);
    cursor = typeResult.value.next;
    pendingCloseHalf = typeResult.value.pendingCloseHalf;
    if (!pendingCloseHalf && tokens[cursor]?.kind === "comma") {
      cursor += 1;
      const closeAfterComma = tryCloseAngleList(tokens, cursor, false);
      if (closeAfterComma.closed) {
        return ok({ typeArguments, cursor: closeAfterComma.cursor });
      }
      continue;
    }
    break;
  }
  const closeResult = tryCloseAngleList(tokens, cursor, pendingCloseHalf);
  if (closeResult.closed) {
    return ok({ typeArguments, cursor: closeResult.cursor });
  }
  const badToken = tokens[cursor];
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-001",
      `expected ',' or '>' in type argument list, found "${badToken?.kind ?? "end of input"}"`,
      badToken !== undefined ? some(badToken.span) : none(),
    ),
  );
}
