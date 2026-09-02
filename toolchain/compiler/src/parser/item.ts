import { type Diagnostic, errorDiagnostic } from "../diagnostics/index.js";
import type { Token, TokenKind } from "../lexer/token.js";
import { isSome, none, some, unwrapSomeOr, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import {
  patternBindingName,
  type Attribute,
  type ConstDecl,
  type EnumDecl,
  type Expression,
  type FunctionDef,
  type FunctionSignature,
  type GenericParam,
  type Identifier,
  type ImplDecl,
  type Item,
  type NamedFieldsBody,
  type Param,
  type Receiver,
  type StaticDecl,
  type StructBody,
  type StructDecl,
  type StructField,
  type TraitBound,
  type TraitDecl,
  type TraitItem,
  type TraitRef,
  type TupleField,
  type TupleFieldsBody,
  type Type,
  type TypeAliasDecl,
  type Variant,
  type Visibility,
  type WhereClause,
  type WherePredicate,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  expectKeyword,
  isGuardrailDiagnostic,
  isItemStartKeyword,
  kindAt,
  parseIdentifier,
  skipBalancedAngleList,
  skipToFunctionBody,
  skipToStructBody,
  skipUnsupportedTopLevelItem,
  skipUntilKindBalanced,
  spanAt,
  tokenAt,
  tryCloseAngleList,
  unsupportedAsyncMessage,
  unsupportedPathKeywordMessage,
  type GenericsCursor,
  type PR,
} from "./parse-utils.js";
import { collectOuterAttributes } from "./attribute.js";
import { parseExpression } from "./expression.js";
import { parsePathSegments } from "./path.js";
import { parsePattern } from "./pattern.js";
import {
  expressionStatement,
  parseBlock,
  parseLetStatement,
} from "./statement.js";
import {
  parsePathTraitBound,
  parseType,
  parseTypeArgumentList,
} from "./type.js";

/** Parses an optional `pub` or `pub(scope)` visibility prefix. */
// eslint-disable-next-line complexity -- This is too difficult to split up
function parseVisibility(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Option<Visibility>>> {
  const token = tokens[pos];
  if (token?.kind !== "keyword" || token.text !== "pub") {
    return ok({ node: none(), next: pos });
  }
  // Check for `pub(scope)`.
  const maybeParen = tokens[pos + 1];
  if (maybeParen?.kind === "lparen") {
    const scopeToken = tokens[pos + 2];
    const closeParen = tokens[pos + 3];
    if (
      (scopeToken?.kind === "ident" || scopeToken?.kind === "keyword") &&
      closeParen?.kind === "rparen"
    ) {
      const scope = scopeToken.text;
      if (scope !== "package") {
        return err(
          errorDiagnostic(
            "HEDGE-PARSE-004",
            `\`pub(${scope})\` visibility is not yet supported`,
            some(scopeToken.span),
          ),
        );
      }
      return ok({
        node: some({ kind: "Visibility", scope: some(scope) }),
        next: pos + 4,
      });
    }
  }
  return ok({
    node: some({ kind: "Visibility", scope: none() }),
    next: pos + 1,
  });
}

/**
 * Parses a parameter list.
 *
 * Grammar:
 *
 * ```text
 * Params ::= "(" (Param ("," Param)* ","?)? ")"
 * Param  ::= Pattern ":" Type
 * ```
 */
function parseParam(tokens: readonly Token[], pos: number): PR<Parsed<Param>> {
  const paramStart = pos;
  const patternResult = parsePattern(tokens, pos);
  if (isErr(patternResult)) {
    return patternResult;
  }
  const pattern = patternResult.value.node;
  let cursor = patternResult.value.next;

  if (kindAt(tokens, cursor) !== "colon") {
    const name = unwrapSomeOr(patternBindingName(pattern), "_");
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-001",
        `expected ':' after parameter name '${name}'`,
        spanAt(tokens, cursor),
      ),
    );
  }
  cursor += 1;

  const typeResult = parseType(tokens, cursor);
  if (isErr(typeResult)) {
    return typeResult;
  }
  cursor = typeResult.value.next;

  return ok({
    node: {
      kind: "Param",
      tokenId: paramStart,
      pattern,
      type: typeResult.value.node,
    },
    next: cursor,
  });
}

/**
 * Recognizes a method receiver at `pos` - the grammar's own leading
 * alternative in `Params`, distinct from an ordinary `Param`:
 *
 * ```text
 * Receiver ::= "&"? "mut"? "self"
 * ```
 *
 * Requires the literal `self` keyword to actually follow any `&`/`mut`
 * prefix - `mut x: i32` and `&mut x: i32` are ordinary parameters, not
 * receivers, and must fall through to `parseParam` unchanged.
 */
function parseReceiver(
  tokens: readonly Token[],
  pos: number,
): Option<Parsed<Receiver>> {
  const byRef = tokens[pos]?.kind === "amp";
  const afterAmp = byRef ? pos + 1 : pos;

  const mutToken = tokens[afterAmp];
  const mutable = mutToken?.kind === "keyword" && mutToken.text === "mut";
  const afterMut = mutable ? afterAmp + 1 : afterAmp;

  const selfToken = tokens[afterMut];
  if (selfToken?.kind !== "keyword" || selfToken.text !== "self") {
    return none();
  }

  return some({
    node: { kind: "Receiver", tokenId: pos, byRef, mutable },
    next: afterMut + 1,
  });
}

interface ParamsResult {
  readonly receiver: Option<Receiver>;
  readonly params: readonly Param[];
}

interface LeadingReceiverResult {
  readonly receiver: Option<Receiver>;
  readonly next: number;
}

/**
 * Consumes a leading receiver, if present, along with the comma that must
 * separate it from any following `Param`. Split out of `parseParams` to keep
 * that function under ESLint's complexity ceiling.
 */
function parseLeadingReceiver(
  tokens: readonly Token[],
  pos: number,
): PR<LeadingReceiverResult> {
  const receiverResult = parseReceiver(tokens, pos);
  if (!isSome(receiverResult)) {
    return ok({ receiver: none(), next: pos });
  }
  const { node: receiver, next } = receiverResult.value;
  if (kindAt(tokens, next) === "rparen" || kindAt(tokens, next) === "eof") {
    return ok({ receiver: some(receiver), next });
  }
  if (kindAt(tokens, next) === "comma") {
    return ok({ receiver: some(receiver), next: next + 1 });
  }
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-001",
      "expected ',' or ')' after receiver",
      spanAt(tokens, next),
    ),
  );
}

interface CommaListBody<T> {
  readonly items: readonly T[];
  readonly next: number;
}

/**
 * Parses a comma-separated element list up to (not including) `close` -
 * shared by every declaration's own bracketed element list (params, struct/
 * tuple fields, enum variants). On a malformed element, recovers by
 * skipping to the next comma or `close` and pushing the diagnostic, unless
 * it's a guardrail diagnostic (see `isGuardrailDiagnostic`), which bubbles
 * out fail-fast instead. `pos` is already past the opening delimiter and
 * any construct-specific prefix (e.g. `parseParams`' own leading receiver);
 * the caller still owns consuming/validating `close` itself, since that
 * varies (`parseVariantList`'s own item-start-keyword recovery, for one).
 */
function parseCommaListBody<T>(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  close: TokenKind,
  parseElement: (tokens: readonly Token[], pos: number) => PR<Parsed<T>>,
): PR<CommaListBody<T>> {
  let cursor = pos;
  const items: T[] = [];

  for (;;) {
    // The `eof` check avoids attempting (and separately diagnosing) an
    // element parse when nothing remains - the caller's own `expect(close)`
    // already produces the single, correct "found end of input" diagnostic
    // for a truncated list; without this, both would fire redundantly.
    if (kindAt(tokens, cursor) === close || kindAt(tokens, cursor) === "eof") {
      break;
    }
    const elementStart = cursor;
    const elementResult = parseElement(tokens, elementStart);

    if (isErr(elementResult)) {
      if (isGuardrailDiagnostic(elementResult.error)) {
        return elementResult;
      }
      diagnostics.push(elementResult.error);
      cursor = skipUntilKindBalanced(tokens, elementStart, "comma", close);
      if (kindAt(tokens, cursor) === "comma") {
        cursor += 1;
        continue;
      }
      break;
    }

    items.push(elementResult.value.node);
    cursor = elementResult.value.next;

    if (kindAt(tokens, cursor) === "comma") {
      cursor += 1;
    } else {
      break;
    }
  }

  return ok({ items, next: cursor });
}

function parseParams(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<ParamsResult>> {
  const afterOpen = expect(tokens, pos, "lparen");
  if (isErr(afterOpen)) {
    return afterOpen;
  }

  const leadingReceiver = parseLeadingReceiver(tokens, afterOpen.value);
  if (isErr(leadingReceiver)) {
    return leadingReceiver;
  }
  const { receiver, next: leadingNext } = leadingReceiver.value;

  const bodyResult = parseCommaListBody(
    tokens,
    diagnostics,
    leadingNext,
    "rparen",
    parseParam,
  );
  if (isErr(bodyResult)) {
    return bodyResult;
  }

  const afterClose = expect(tokens, bodyResult.value.next, "rparen");
  if (isErr(afterClose)) {
    return afterClose;
  }
  return ok({
    node: { receiver, params: bodyResult.value.items },
    next: afterClose.value,
  });
}

interface DeclarationGenericsResult {
  readonly generics: readonly GenericParam[];
  readonly next: number;
}

interface TraitBoundResult {
  readonly bound: TraitBound;
  readonly cursor: GenericsCursor;
}

/**
 * Parses one trait bound: `Path Generics?` (`Draw`, `From<U>`) or a bare
 * lifetime (`'a`, e.g. `T: 'a`).
 *
 * Grammar:
 *
 * ```text
 * TraitBound ::= Path Generics? | Lifetime
 * ```
 */
function parseTraitBound(
  tokens: readonly Token[],
  pos: number,
): PR<TraitBoundResult> {
  const token = tokens[pos];
  if (token?.kind === "lifetime") {
    return ok({
      bound: {
        kind: "LifetimeTraitBound",
        tokenId: pos,
        lifetime: { kind: "Lifetime", tokenId: pos, name: token.text },
      },
      cursor: { next: pos + 1, pendingCloseHalf: false },
    });
  }
  const pathBoundResult = parsePathTraitBound(tokens, pos);
  if (isErr(pathBoundResult)) {
    return pathBoundResult;
  }
  return ok({
    bound: pathBoundResult.value.bound,
    cursor: pathBoundResult.value.cursor,
  });
}

interface TraitBoundsResult {
  readonly bounds: readonly TraitBound[];
  readonly cursor: GenericsCursor;
}

/**
 * Parses a `+`-separated trait bound list (`Draw`, `A + B`).
 *
 * Grammar:
 *
 * ```text
 * TraitBounds ::= TraitBound ("+" TraitBound)*
 * ```
 */
function parseTraitBounds(
  tokens: readonly Token[],
  pos: number,
): PR<TraitBoundsResult> {
  const first = parseTraitBound(tokens, pos);
  if (isErr(first)) {
    return first;
  }
  const bounds: TraitBound[] = [first.value.bound];
  let cursor = first.value.cursor;
  while (tokens[cursor.next]?.kind === "plus") {
    const next = parseTraitBound(tokens, cursor.next + 1);
    if (isErr(next)) {
      return next;
    }
    bounds.push(next.value.bound);
    cursor = next.value.cursor;
  }
  return ok({ bounds, cursor });
}

interface GenericParamResult {
  readonly param: GenericParam;
  readonly cursor: GenericsCursor;
}

/**
 * Parses one generic parameter: a lifetime, or an identifier with an
 * optional inline bound list.
 *
 * Grammar:
 *
 * ```text
 * GenericParam ::= Lifetime | Identifier (":" TraitBounds)?
 * ```
 */
function parseGenericParam(
  tokens: readonly Token[],
  pos: number,
): PR<GenericParamResult> {
  const token = tokens[pos];
  if (token?.kind === "lifetime") {
    return ok({
      param: {
        kind: "LifetimeParam",
        tokenId: pos,
        lifetime: { kind: "Lifetime", tokenId: pos, name: token.text },
      },
      cursor: { next: pos + 1, pendingCloseHalf: false },
    });
  }
  const nameResult = parseIdentifier(tokens, pos);
  if (isErr(nameResult)) {
    return nameResult;
  }
  let cursor: GenericsCursor = {
    next: nameResult.value.next,
    pendingCloseHalf: false,
  };
  let bounds: readonly TraitBound[] = [];
  if (tokens[cursor.next]?.kind === "colon") {
    const boundsResult = parseTraitBounds(tokens, cursor.next + 1);
    if (isErr(boundsResult)) {
      return boundsResult;
    }
    bounds = boundsResult.value.bounds;
    cursor = boundsResult.value.cursor;
  }
  return ok({
    param: {
      kind: "TypeParam",
      tokenId: pos,
      name: nameResult.value.node,
      bounds,
    },
    cursor,
  });
}

interface GenericParamListResult {
  readonly generics: readonly GenericParam[];
  readonly cursor: GenericsCursor;
}

/**
 * Parses a full `<...>` generic parameter list, `ltPos` pointing at the
 * opening `<`. At least one parameter is required (no `?` on the first
 * `GenericParam`) - an empty list is a genuine parse error.
 *
 * Grammar:
 *
 * ```text
 * Generics ::= "<" GenericParam ("," GenericParam)* ","? ">"
 * ```
 */
function parseGenericParamList(
  tokens: readonly Token[],
  ltPos: number,
): PR<GenericParamListResult> {
  let cursor = ltPos + 1;
  const generics: GenericParam[] = [];
  for (;;) {
    const paramResult = parseGenericParam(tokens, cursor);
    if (isErr(paramResult)) {
      return paramResult;
    }
    generics.push(paramResult.value.param);
    const afterParam = paramResult.value.cursor;

    if (
      !afterParam.pendingCloseHalf &&
      tokens[afterParam.next]?.kind === "comma"
    ) {
      cursor = afterParam.next + 1;
      const closeAfterComma = tryCloseAngleList(tokens, cursor, false);
      if (closeAfterComma.closed) {
        return ok({ generics, cursor: closeAfterComma.cursor });
      }
      continue;
    }

    const closeResult = tryCloseAngleList(
      tokens,
      afterParam.next,
      afterParam.pendingCloseHalf,
    );
    if (closeResult.closed) {
      return ok({ generics, cursor: closeResult.cursor });
    }
    const badToken = tokens[afterParam.next];
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-001",
        `expected ',' or '>' in generic parameter list, found "${badToken?.kind ?? "end of input"}"`,
        badToken !== undefined ? some(badToken.span) : none(),
      ),
    );
  }
}

/**
 * Parses the generic parameter list (`<...>`) at `pos`, if any. A malformed
 * list pushes the parse-error diagnostic and skips via
 * `skipBalancedAngleList`, recovering with an empty generics array.
 */
function parseDeclarationGenerics(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): DeclarationGenericsResult {
  const token = tokens[pos];
  if (token?.kind !== "lt") {
    return { generics: [], next: pos };
  }
  const listResult = parseGenericParamList(tokens, pos);
  if (isErr(listResult)) {
    diagnostics.push(listResult.error);
    return { generics: [], next: skipBalancedAngleList(tokens, pos).next };
  }
  // At the outermost level there's no enclosing list to hand a half-spent
  // `gt_gt` off to - a stray extra `>` (`fn foo<T>>()`) is malformed input,
  // diagnosed and recovered past, not silently accepted.
  if (listResult.value.cursor.pendingCloseHalf) {
    const strayToken = tokens[listResult.value.cursor.next];
    diagnostics.push(
      errorDiagnostic(
        "HEDGE-PARSE-005",
        "unexpected extra '>' after generic parameter list",
        strayToken !== undefined ? some(strayToken.span) : none(),
      ),
    );
    return {
      generics: listResult.value.generics,
      next: listResult.value.cursor.next + 1,
    };
  }
  return {
    generics: listResult.value.generics,
    next: listResult.value.cursor.next,
  };
}

interface WherePredicateResult {
  readonly predicate: WherePredicate;
  readonly next: number;
}

/**
 * Parses one where-clause predicate.
 *
 * Grammar:
 *
 * ```text
 * WherePredicate ::= Type ":" TraitBounds
 * ```
 */
function parseWherePredicate(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<WherePredicateResult> {
  const typeResult = parseType(tokens, pos);
  if (isErr(typeResult)) {
    return typeResult;
  }
  const colonResult = expect(tokens, typeResult.value.next, "colon");
  if (isErr(colonResult)) {
    return colonResult;
  }
  const boundsResult = parseTraitBounds(tokens, colonResult.value);
  if (isErr(boundsResult)) {
    return boundsResult;
  }
  // A where-clause bound has no enclosing `<...>`, so `pendingCloseHalf`
  // here is always a genuine stray extra `>` (`where T: Foo<Bar>>`) - never
  // a level owed to an enclosing list, unlike `parseDeclarationGenerics`.
  // Diagnose and consume it, matching that function's own precedent.
  let next = boundsResult.value.cursor.next;
  if (boundsResult.value.cursor.pendingCloseHalf) {
    const strayToken = tokens[next];
    diagnostics.push(
      errorDiagnostic(
        "HEDGE-PARSE-005",
        "unexpected extra '>' after trait bound",
        strayToken !== undefined ? some(strayToken.span) : none(),
      ),
    );
    next += 1;
  }
  return ok({
    predicate: {
      kind: "WherePredicate",
      tokenId: pos,
      type: typeResult.value.node,
      bounds: boundsResult.value.bounds,
    },
    next,
  });
}

interface WhereClauseParseResult {
  readonly clause: WhereClause;
  readonly next: number;
}

/**
 * Parses the predicate list of a `where` clause, `pos` just past the
 * `where` keyword. Terminates at the first non-comma token, or after a
 * trailing comma before the body start.
 *
 * Grammar:
 *
 * ```text
 * WhereClause ::= "where" WherePredicate ("," WherePredicate)* ","?
 * ```
 */
function parseWhereClauseBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<WhereClauseParseResult> {
  const first = parseWherePredicate(tokens, diagnostics, pos);
  if (isErr(first)) {
    return first;
  }
  const predicates: WherePredicate[] = [first.value.predicate];
  let cursor = first.value.next;
  for (;;) {
    if (tokens[cursor]?.kind !== "comma") {
      break;
    }
    const afterComma = cursor + 1;
    const next = tokens[afterComma];
    if (
      next === undefined ||
      next.kind === "eof" ||
      next.kind === "lbrace" ||
      next.kind === "lparen" ||
      next.kind === "semi"
    ) {
      cursor = afterComma;
      break;
    }
    const predicateResult = parseWherePredicate(
      tokens,
      diagnostics,
      afterComma,
    );
    if (isErr(predicateResult)) {
      return predicateResult;
    }
    predicates.push(predicateResult.value.predicate);
    cursor = predicateResult.value.next;
  }
  return ok({ clause: { kind: "WhereClause", predicates }, next: cursor });
}

interface WhereClauseResult {
  readonly whereClause: Option<WhereClause>;
  readonly next: number;
}

/**
 * If a `where` clause starts at `pos`, attempts a real parse: `some(...)`
 * and the position past the clause on success. On a genuine parse failure,
 * pushes the diagnostic and falls back to `skip` (which knows the
 * declaration's own body-start shape - `{` for a function, `{`/`(`/`;` for
 * a struct), recovering with `none()`. Returns `none()`/`pos` unchanged
 * when no `where` keyword is present.
 */
function checkWhereClause(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  skip: (tokens: readonly Token[], pos: number) => number,
): WhereClauseResult {
  const whereToken = tokens[pos];
  if (whereToken?.kind !== "keyword" || whereToken.text !== "where") {
    return { whereClause: none(), next: pos };
  }
  const result = parseWhereClauseBody(tokens, diagnostics, pos + 1);
  if (isErr(result)) {
    diagnostics.push(result.error);
    return { whereClause: none(), next: skip(tokens, pos) };
  }
  return { whereClause: some(result.value.clause), next: result.value.next };
}

/**
 * Parses a function declaration.
 *
 * Grammar:
 *
 * ```text
 * FunctionDecl ::= Visibility? "fn" Identifier "(" Params? ")" ("->" Type)? (Block | ";")
 * ```
 */
function parseFunction(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<FunctionDef | FunctionSignature>> {
  const start = pos;
  const afterFn = expectKeyword(tokens, pos, "fn");
  if (isErr(afterFn)) {
    return afterFn;
  }
  const nameResult = parseIdentifier(tokens, afterFn.value);
  if (isErr(nameResult)) {
    return nameResult;
  }

  const genericsResult = parseDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  const paramsResult = parseParams(tokens, diagnostics, genericsResult.next);
  if (isErr(paramsResult)) {
    return paramsResult;
  }
  let cursor = paramsResult.value.next;
  let returnType: Option<Type> = none();
  if (tokens[cursor]?.kind === "arrow") {
    cursor += 1;
    const typeResult = parseType(tokens, cursor);
    if (isErr(typeResult)) {
      return typeResult;
    }
    returnType = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }
  const whereResult = checkWhereClause(
    tokens,
    diagnostics,
    cursor,
    skipToFunctionBody,
  );
  const signature: FunctionSignature = {
    kind: "FunctionSignature",
    tokenId: start,
    visibility,
    name: nameResult.value.node,
    generics: genericsResult.generics,
    receiver: paramsResult.value.node.receiver,
    params: paramsResult.value.node.params,
    returnType,
    whereClause: whereResult.whereClause,
    attributes,
  };
  if (tokens[whereResult.next]?.kind === "semi") {
    return ok({ node: signature, next: whereResult.next + 1 });
  }
  const bodyResult = parseBlock(tokens, diagnostics, whereResult.next);
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const fn: FunctionDef = {
    kind: "Function",
    tokenId: start,
    signature,
    body: bodyResult.value.node,
  };
  return ok({ node: fn, next: bodyResult.value.next });
}

/**
 * Parses the named-field body of a struct.
 *
 * Grammar:
 *
 * ```text
 * NamedFieldsBody ::= "{" (StructField ("," StructField)* ","?)? "}"
 * StructField     ::= Attribute* Visibility? Identifier ":" Type
 * ```
 */
function parseNamedField(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<StructField>> {
  const attrResult = collectOuterAttributes(tokens, pos);
  if (isErr(attrResult)) {
    return attrResult;
  }
  const fieldAttrs = attrResult.value.attributes;
  let cursor = attrResult.value.next;

  const visResult = parseVisibility(tokens, cursor);
  if (isErr(visResult)) {
    return visResult;
  }
  cursor = visResult.value.next;

  const fieldStart = cursor;

  const nameResult = parseIdentifier(tokens, cursor);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const fieldName = nameResult.value.node;
  cursor = nameResult.value.next;

  if (tokens[cursor]?.kind !== "colon") {
    const token = tokens[cursor];
    return err(
      errorDiagnostic(
        "HEDGE-PARSE-001",
        `expected ':' after field name '${fieldName.text}'`,
        token !== undefined ? some(token.span) : none(),
      ),
    );
  }
  cursor += 1;

  const typeResult = parseType(tokens, cursor);
  if (isErr(typeResult)) {
    return typeResult;
  }
  cursor = typeResult.value.next;

  return ok({
    node: {
      kind: "StructField",
      tokenId: fieldStart,
      attributes: fieldAttrs,
      visibility: visResult.value.node,
      name: fieldName,
      type: typeResult.value.node,
    },
    next: cursor,
  });
}

function parseNamedFieldsBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<NamedFieldsBody>> {
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  const bodyResult = parseCommaListBody(
    tokens,
    diagnostics,
    afterLbrace.value,
    "rbrace",
    parseNamedField,
  );
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const afterRbrace = expect(tokens, bodyResult.value.next, "rbrace");
  if (isErr(afterRbrace)) {
    return afterRbrace;
  }
  return ok({
    node: { kind: "NamedFields", fields: bodyResult.value.items },
    next: afterRbrace.value,
  });
}

/**
 * Parses the tuple-field body of a struct.
 *
 * Grammar:
 *
 * ```text
 * TupleFieldsBody ::= "(" (TupleField ("," TupleField)* ","?)? ")"
 * TupleField      ::= Attribute* Visibility? Type
 * ```
 */
function parseTupleField(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<TupleField>> {
  const attrResult = collectOuterAttributes(tokens, pos);
  if (isErr(attrResult)) {
    return attrResult;
  }
  const fieldAttrs = attrResult.value.attributes;
  let cursor = attrResult.value.next;

  const visResult = parseVisibility(tokens, cursor);
  if (isErr(visResult)) {
    return visResult;
  }
  cursor = visResult.value.next;

  const fieldStart = cursor;

  const typeResult = parseType(tokens, cursor);
  if (isErr(typeResult)) {
    return typeResult;
  }
  cursor = typeResult.value.next;

  return ok({
    node: {
      kind: "TupleField",
      tokenId: fieldStart,
      attributes: fieldAttrs,
      visibility: visResult.value.node,
      type: typeResult.value.node,
    },
    next: cursor,
  });
}

function parseTupleFieldsBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<TupleFieldsBody>> {
  const afterLparen = expect(tokens, pos, "lparen");
  if (isErr(afterLparen)) {
    return afterLparen;
  }
  const bodyResult = parseCommaListBody(
    tokens,
    diagnostics,
    afterLparen.value,
    "rparen",
    parseTupleField,
  );
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const afterRparen = expect(tokens, bodyResult.value.next, "rparen");
  if (isErr(afterRparen)) {
    return afterRparen;
  }
  return ok({
    node: { kind: "TupleFields", fields: bodyResult.value.items },
    next: afterRparen.value,
  });
}

/**
 * Parses a struct's body: `;` (unit), `{...}` (named fields), or `(...)`
 * followed by its own required trailing `;` (tuple fields -
 * `parseTupleFieldsBody` only consumes through the closing `)`).
 */
function parseStructBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<StructBody>> {
  const bodyToken = tokens[pos];
  if (bodyToken?.kind === "semi") {
    return ok({ node: { kind: "Unit" }, next: pos + 1 });
  }
  if (bodyToken?.kind === "lbrace") {
    return parseNamedFieldsBody(tokens, diagnostics, pos);
  }
  if (bodyToken?.kind === "lparen") {
    const bodyResult = parseTupleFieldsBody(tokens, diagnostics, pos);
    if (isErr(bodyResult)) {
      return bodyResult;
    }
    const afterSemi = expect(tokens, bodyResult.value.next, "semi");
    if (isErr(afterSemi)) {
      return afterSemi;
    }
    return ok({ node: bodyResult.value.node, next: afterSemi.value });
  }
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-001",
      `expected struct body (\`{\`, \`(\`, or \`;\`), found "${bodyToken?.kind ?? "end of input"}"`,
      bodyToken !== undefined ? some(bodyToken.span) : none(),
    ),
  );
}

/**
 * Parses a struct declaration.
 *
 * Grammar:
 *
 * ```text
 * StructDecl ::= Visibility? "struct" Identifier (NamedFieldsBody | TupleFieldsBody ";" | ";")
 * ```
 */
function parseStruct(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<StructDecl>> {
  const start = pos;
  const afterStruct = expectKeyword(tokens, pos, "struct");
  if (isErr(afterStruct)) {
    return afterStruct;
  }
  const nameResult = parseIdentifier(tokens, afterStruct.value);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const genericsResult = parseDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  const whereResult = checkWhereClause(
    tokens,
    diagnostics,
    genericsResult.next,
    skipToStructBody,
  );

  const bodyResult = parseStructBody(tokens, diagnostics, whereResult.next);
  if (isErr(bodyResult)) {
    return bodyResult;
  }

  const decl: StructDecl = {
    kind: "Struct",
    tokenId: start,
    visibility,
    name: nameResult.value.node,
    generics: genericsResult.generics,
    whereClause: whereResult.whereClause,
    body: bodyResult.value.node,
    attributes,
  };
  return ok({ node: decl, next: bodyResult.value.next });
}

/**
 * Parses a single enum variant.
 *
 * Grammar:
 *
 * ```text
 * Variant ::= Attribute* Identifier (NamedFieldsBody | TupleFieldsBody)?
 * ```
 */
function parseVariant(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Variant>> {
  const attrResult = collectOuterAttributes(tokens, pos);
  if (isErr(attrResult)) {
    return attrResult;
  }
  const attributes = attrResult.value.attributes;
  const cursor = attrResult.value.next;

  const variantStart = cursor;
  const nameResult = parseIdentifier(tokens, cursor);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const name = nameResult.value.node;
  let next = nameResult.value.next;

  let body: Option<NamedFieldsBody | TupleFieldsBody> = none();
  const bodyToken = tokens[next];
  if (bodyToken?.kind === "lbrace") {
    const bodyResult = parseNamedFieldsBody(tokens, diagnostics, next);
    if (isErr(bodyResult)) {
      return bodyResult;
    }
    body = some(bodyResult.value.node);
    next = bodyResult.value.next;
  } else if (bodyToken?.kind === "lparen") {
    const bodyResult = parseTupleFieldsBody(tokens, diagnostics, next);
    if (isErr(bodyResult)) {
      return bodyResult;
    }
    body = some(bodyResult.value.node);
    next = bodyResult.value.next;
  }

  return ok({
    node: { kind: "Variant", tokenId: variantStart, attributes, name, body },
    next,
  });
}

/**
 * Parses the brace-delimited variant list of an enum.
 *
 * Grammar:
 *
 * ```text
 * "{" (Variant ("," Variant)* ","?)? "}"
 * ```
 */
function parseVariantList(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<readonly Variant[]>> {
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  const bodyResult = parseCommaListBody(
    tokens,
    diagnostics,
    afterLbrace.value,
    "rbrace",
    (elementTokens, elementPos) =>
      parseVariant(elementTokens, diagnostics, elementPos),
  );
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const { items: variants, next: cursor } = bodyResult.value;

  const afterRbrace = expect(tokens, cursor, "rbrace");
  if (isErr(afterRbrace)) {
    // Recover only when an item-start keyword follows - the one signal that
    // the enum's body actually ended here. Any other token, including EOF,
    // stays fail-fast.
    const token = tokens[cursor];
    if (token !== undefined && isItemStartKeyword(token)) {
      diagnostics.push(afterRbrace.error);
      return ok({ node: variants, next: cursor });
    }
    return afterRbrace;
  }
  return ok({ node: variants, next: afterRbrace.value });
}

/**
 * Parses an enum declaration.
 *
 * Grammar:
 *
 * ```text
 * EnumDecl ::= Visibility? "enum" Identifier Generics? WhereClause?
 *              "{" (Variant ("," Variant)* ","?)? "}"
 * ```
 */
function parseEnum(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<EnumDecl>> {
  const start = pos;
  const afterEnum = expectKeyword(tokens, pos, "enum");
  if (isErr(afterEnum)) {
    return afterEnum;
  }
  const nameResult = parseIdentifier(tokens, afterEnum.value);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const genericsResult = parseDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  const whereResult = checkWhereClause(
    tokens,
    diagnostics,
    genericsResult.next,
    skipToStructBody,
  );

  const variantsResult = parseVariantList(
    tokens,
    diagnostics,
    whereResult.next,
  );
  if (isErr(variantsResult)) {
    return variantsResult;
  }

  const decl: EnumDecl = {
    kind: "Enum",
    tokenId: start,
    visibility,
    name: nameResult.value.node,
    generics: genericsResult.generics,
    whereClause: whereResult.whereClause,
    variants: variantsResult.value.node,
    attributes,
  };
  return ok({ node: decl, next: variantsResult.value.next });
}

/**
 * Parses a `const` or `static` declaration.
 *
 * Grammar:
 *
 * ```text
 * Const  ::= "const" Identifier ":" Type "=" Expression ";"
 * Static ::= "static" Identifier ":" Type "=" Expression ";"
 * ```
 */
interface ConstOrStaticBody {
  readonly name: Identifier;
  readonly type: Type;
  readonly value: Expression;
  readonly next: number;
}

/**
 * The shared body of a `const`/`static` declaration, from just past the
 * leading keyword through the trailing `;` - the two declarations differ
 * only in that keyword and their own AST `kind` discriminant.
 */
function parseConstOrStaticBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  afterKeyword: number,
): PR<ConstOrStaticBody> {
  const nameResult = parseIdentifier(tokens, afterKeyword);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const name = nameResult.value.node;

  const afterColon = expect(tokens, nameResult.value.next, "colon");
  if (isErr(afterColon)) {
    return afterColon;
  }

  const typeResult = parseType(tokens, afterColon.value);
  if (isErr(typeResult)) {
    return typeResult;
  }
  const type = typeResult.value.node;

  const afterEq = expect(tokens, typeResult.value.next, "eq");
  if (isErr(afterEq)) {
    return afterEq;
  }

  const valueResult = parseExpression(tokens, diagnostics, afterEq.value);
  if (isErr(valueResult)) {
    return valueResult;
  }
  const value = valueResult.value.node;

  const afterSemi = expect(tokens, valueResult.value.next, "semi");
  if (isErr(afterSemi)) {
    return afterSemi;
  }

  return ok({ name, type, value, next: afterSemi.value });
}

/**
 * Parses a `const` declaration.
 *
 * Grammar:
 *
 * ```text
 * Const ::= "const" Identifier ":" Type "=" Expression ";"
 * ```
 */
function parseConst(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<ConstDecl>> {
  const start = pos;
  const afterKeyword = expectKeyword(tokens, pos, "const");
  if (isErr(afterKeyword)) {
    return afterKeyword;
  }
  const bodyResult = parseConstOrStaticBody(
    tokens,
    diagnostics,
    afterKeyword.value,
  );
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const { name, type, value, next } = bodyResult.value;
  return ok({
    node: {
      kind: "Const",
      tokenId: start,
      visibility,
      name,
      type,
      value,
      attributes,
    },
    next,
  });
}

/**
 * Parses a `static` declaration.
 *
 * Grammar:
 *
 * ```text
 * Static ::= "static" Identifier ":" Type "=" Expression ";"
 * ```
 */
function parseStatic(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<StaticDecl>> {
  const start = pos;
  const afterKeyword = expectKeyword(tokens, pos, "static");
  if (isErr(afterKeyword)) {
    return afterKeyword;
  }
  const bodyResult = parseConstOrStaticBody(
    tokens,
    diagnostics,
    afterKeyword.value,
  );
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const { name, type, value, next } = bodyResult.value;
  return ok({
    node: {
      kind: "Static",
      tokenId: start,
      visibility,
      name,
      type,
      value,
      attributes,
    },
    next,
  });
}

/**
 * Parses a type alias / associated type declaration.
 *
 * Grammar:
 *
 * ```text
 * TypeAlias ::= "type" Identifier Generics? ("=" Type)? ";"
 * ```
 */
function parseTypeAlias(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
): PR<Parsed<TypeAliasDecl>> {
  const start = pos;
  const afterType = expectKeyword(tokens, pos, "type");
  if (isErr(afterType)) {
    return afterType;
  }
  const nameResult = parseIdentifier(tokens, afterType.value);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const genericsResult = parseDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  let cursor = genericsResult.next;
  let value: Option<Type> = none();
  if (tokens[cursor]?.kind === "eq") {
    const typeResult = parseType(tokens, cursor + 1);
    if (isErr(typeResult)) {
      return typeResult;
    }
    value = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }
  const afterSemi = expect(tokens, cursor, "semi");
  if (isErr(afterSemi)) {
    return afterSemi;
  }
  return ok({
    node: {
      kind: "TypeAlias",
      tokenId: start,
      name: nameResult.value.node,
      generics: genericsResult.generics,
      value,
      attributes,
    },
    next: afterSemi.value,
  });
}

/**
 * Parses one trait item.
 *
 * Grammar:
 *
 * ```text
 * TraitItem ::= Attribute* (Function | TypeAlias | Const)
 * ```
 */
function parseTraitItem(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<TraitItem>> {
  const attrResult = collectOuterAttributes(tokens, pos);
  if (isErr(attrResult)) {
    return attrResult;
  }
  const attributes = attrResult.value.attributes;
  const cursor = attrResult.value.next;

  const tokenResult = tokenAt(tokens, cursor);
  if (isErr(tokenResult)) {
    return tokenResult;
  }
  const token = tokenResult.value;
  if (token.kind === "keyword" && token.text === "fn") {
    return parseFunction(tokens, diagnostics, cursor, attributes);
  }
  if (token.kind === "keyword" && token.text === "type") {
    return parseTypeAlias(tokens, diagnostics, cursor, attributes);
  }
  if (token.kind === "keyword" && token.text === "const") {
    return parseConst(tokens, diagnostics, cursor, attributes);
  }
  const found =
    token.kind === "keyword" ? `keyword "${token.text}"` : `"${token.kind}"`;
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-001",
      `expected a function, associated type, or const in trait body, found ${found}`,
      some(token.span),
    ),
  );
}

/**
 * Parses the brace-delimited item list of a trait body. Unlike a struct's
 * field list or an enum's variant list, items here are not comma-separated -
 * each one self-terminates (`;` for a signature/type alias/const, a block
 * for a bodied function), matching the top-level item sequence's own shape.
 */
function parseTraitItemList(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<readonly TraitItem[]>> {
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  let cursor = afterLbrace.value;
  const items: TraitItem[] = [];
  for (;;) {
    if (
      kindAt(tokens, cursor) === "rbrace" ||
      kindAt(tokens, cursor) === "eof"
    ) {
      break;
    }
    const itemResult = parseTraitItem(tokens, diagnostics, cursor);
    if (isErr(itemResult)) {
      return itemResult;
    }
    items.push(itemResult.value.node);
    cursor = itemResult.value.next;
  }
  const afterRbrace = expect(tokens, cursor, "rbrace");
  if (isErr(afterRbrace)) {
    return afterRbrace;
  }
  return ok({ node: items, next: afterRbrace.value });
}

/**
 * Parses a trait declaration.
 *
 * Grammar:
 *
 * ```text
 * Trait ::= "trait" Identifier Generics? (":" TraitBounds)? WhereClause? "{" TraitItem* "}"
 * ```
 */
function parseTrait(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<TraitDecl>> {
  const start = pos;
  const afterTrait = expectKeyword(tokens, pos, "trait");
  if (isErr(afterTrait)) {
    return afterTrait;
  }
  const nameResult = parseIdentifier(tokens, afterTrait.value);
  if (isErr(nameResult)) {
    return nameResult;
  }
  const genericsResult = parseDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  let cursor = genericsResult.next;
  let supertraits: readonly TraitBound[] = [];
  if (tokens[cursor]?.kind === "colon") {
    const boundsResult = parseTraitBounds(tokens, cursor + 1);
    if (isErr(boundsResult)) {
      return boundsResult;
    }
    supertraits = boundsResult.value.bounds;
    cursor = boundsResult.value.cursor.next;
    // A supertrait bound list has no enclosing `<...>` of its own to hand a
    // leftover half off to, so a pending close here is always a genuine
    // stray extra `>` (`trait Ord: Eq<T>> {}`) - same treatment
    // `parseWherePredicate` gives its own trailing bound overflow.
    if (boundsResult.value.cursor.pendingCloseHalf) {
      const strayToken = tokens[cursor];
      diagnostics.push(
        errorDiagnostic(
          "HEDGE-PARSE-005",
          "unexpected extra '>' after supertrait bound",
          strayToken !== undefined ? some(strayToken.span) : none(),
        ),
      );
      cursor += 1;
    }
  }
  const whereResult = checkWhereClause(
    tokens,
    diagnostics,
    cursor,
    skipToStructBody,
  );
  const itemsResult = parseTraitItemList(tokens, diagnostics, whereResult.next);
  if (isErr(itemsResult)) {
    return itemsResult;
  }
  const decl: TraitDecl = {
    kind: "Trait",
    tokenId: start,
    visibility,
    name: nameResult.value.node,
    generics: genericsResult.generics,
    supertraits,
    whereClause: whereResult.whereClause,
    items: itemsResult.value.node,
    attributes,
  };
  return ok({ node: decl, next: itemsResult.value.next });
}

/**
 * `Impl`'s own `Item*` production means an `ItemKind` declaration, never
 * the `let`/bare-expression leniency `parseItem` also accepts at the
 * top level and in block position - that leniency is a Slice-1 carve-out
 * for those two positions specifically, not part of `ItemKind` itself.
 */
const IMPL_ITEM_KINDS: ReadonlySet<string> = new Set([
  "Function",
  "FunctionSignature",
  "Struct",
  "Enum",
  "Trait",
  "Impl",
  "TypeAlias",
  "Const",
  "Static",
]);

/**
 * `err(...)` naming `node`'s own kind if it falls outside `IMPL_ITEM_KINDS`,
 * `ok(node)` otherwise - split out of `parseItemList`'s loop so that loop
 * only has to handle raw parsing, not this semantic gate too.
 */
function validateImplBodyItem(tokens: readonly Token[], node: Item): PR<Item> {
  if (IMPL_ITEM_KINDS.has(node.kind)) {
    return ok(node);
  }
  const token = tokens[node.tokenId];
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-006",
      `unexpected item kind '${node.kind}' in impl body`,
      token !== undefined ? some(token.span) : none(),
    ),
  );
}

/**
 * Parses the brace-delimited item list of an impl body - the grammar's own
 * general `Item*`, unlike a trait body's narrower `TraitItem` set. Reuses
 * `parseItem`, the same top-level item dispatch `parser.ts`'s own loop
 * calls, including its lone-`;` skip, validating each returned node via
 * {@link validateImplBodyItem}.
 */
function parseItemList(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<readonly Item[]>> {
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  let cursor = afterLbrace.value;
  const items: Item[] = [];
  for (;;) {
    if (
      kindAt(tokens, cursor) === "rbrace" ||
      kindAt(tokens, cursor) === "eof"
    ) {
      break;
    }
    if (kindAt(tokens, cursor) === "semi") {
      cursor += 1;
      continue;
    }
    const itemResult = parseItem(tokens, diagnostics, cursor);
    if (isErr(itemResult)) {
      return itemResult;
    }
    cursor = itemResult.value.next;
    if (isSome(itemResult.value.node)) {
      const validated = validateImplBodyItem(
        tokens,
        itemResult.value.node.value,
      );
      if (isErr(validated)) {
        return validated;
      }
      items.push(validated.value);
    }
  }
  const afterRbrace = expect(tokens, cursor, "rbrace");
  if (isErr(afterRbrace)) {
    return afterRbrace;
  }
  return ok({ node: items, next: afterRbrace.value });
}

/**
 * True for a token that can only ever start a `Type`, never a `Path` -
 * `TraitRef` is strictly `Path Generics?`, so a leading `&`/`[`/`(`/`!`/
 * `fn`/`dyn` rules out the `TraitRef "for"` alternative entirely and the
 * target must be an ordinary (non-path-led) `Type`.
 */
function isNonPathTypeLead(token: Token | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  if (
    token.kind === "amp" ||
    token.kind === "lbracket" ||
    token.kind === "lparen" ||
    token.kind === "bang"
  ) {
    return true;
  }
  return (
    token.kind === "keyword" && (token.text === "fn" || token.text === "dyn")
  );
}

interface ImplTargetResult {
  readonly traitRef: Option<TraitRef>;
  readonly type: Type;
  readonly next: number;
}

/** The target is definitely not `TraitRef "for"` - parse it as an ordinary `Type`. */
function parseNonPathImplTarget(
  tokens: readonly Token[],
  pos: number,
): PR<ImplTargetResult> {
  const typeResult = parseType(tokens, pos);
  if (isErr(typeResult)) {
    return typeResult;
  }
  return ok({
    traitRef: none(),
    type: typeResult.value.node,
    next: typeResult.value.next,
  });
}

/**
 * Parses a `Path Generics?` (the shared shape of both a `TraitRef` and a
 * bare `NamedType`) and disambiguates the grammar's `(TraitRef "for")? Type`
 * by checking for `for` only after parsing it - when present, the
 * already-parsed path becomes the `TraitRef` and a fresh `Type` follows;
 * otherwise that same path/generics pair is reinterpreted directly as the
 * inherent impl's own `NamedType` target, with no re-parse needed.
 */
function parsePathLedImplTarget(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<ImplTargetResult> {
  const pathStart = pos;
  const pathResult = parsePathSegments(tokens, pathStart);
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

  const forToken = tokens[cursor.next];
  if (
    !cursor.pendingCloseHalf &&
    forToken?.kind === "keyword" &&
    forToken.text === "for"
  ) {
    const typeResult = parseType(tokens, cursor.next + 1);
    if (isErr(typeResult)) {
      return typeResult;
    }
    return ok({
      traitRef: some({
        kind: "TraitRef",
        tokenId: pathStart,
        path: pathResult.value.node,
        typeArguments,
      }),
      type: typeResult.value.node,
      next: typeResult.value.next,
    });
  }

  // A trait ref's own `<...>` list has no enclosing list to hand a leftover
  // half off to, so a pending close here is always a genuine stray extra
  // `>` (`impl Foo<T>> {}`) - same treatment `parseWherePredicate` gives its
  // own trailing bound overflow.
  let next = cursor.next;
  if (cursor.pendingCloseHalf) {
    const strayToken = tokens[next];
    diagnostics.push(
      errorDiagnostic(
        "HEDGE-PARSE-005",
        "unexpected extra '>' after impl target type",
        strayToken !== undefined ? some(strayToken.span) : none(),
      ),
    );
    next += 1;
  }
  return ok({
    traitRef: none(),
    type: {
      kind: "NamedType",
      tokenId: pathStart,
      path: pathResult.value.node,
      typeArguments,
    },
    next,
  });
}

/**
 * Parses the impl target. A leading token that can't possibly start a
 * `Path` (`&T`, `[T; N]`, ...) means `TraitRef` never applied in the first
 * place, so it goes straight to {@link parseNonPathImplTarget}; everything
 * else needs {@link parsePathLedImplTarget}'s `TraitRef "for"` lookahead.
 */
function parseImplTarget(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<ImplTargetResult> {
  return isNonPathTypeLead(tokens[pos])
    ? parseNonPathImplTarget(tokens, pos)
    : parsePathLedImplTarget(tokens, diagnostics, pos);
}

/**
 * Parses an impl declaration.
 *
 * Grammar:
 *
 * ```text
 * Impl     ::= "impl" Generics? (TraitRef "for")? Type WhereClause? "{" Item* "}"
 * TraitRef ::= Path Generics?
 * ```
 */
function parseImpl(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
): PR<Parsed<ImplDecl>> {
  const start = pos;
  const afterImpl = expectKeyword(tokens, pos, "impl");
  if (isErr(afterImpl)) {
    return afterImpl;
  }
  const genericsResult = parseDeclarationGenerics(
    tokens,
    diagnostics,
    afterImpl.value,
  );
  const targetResult = parseImplTarget(
    tokens,
    diagnostics,
    genericsResult.next,
  );
  if (isErr(targetResult)) {
    return targetResult;
  }
  const whereResult = checkWhereClause(
    tokens,
    diagnostics,
    targetResult.value.next,
    skipToStructBody,
  );
  const itemsResult = parseItemList(tokens, diagnostics, whereResult.next);
  if (isErr(itemsResult)) {
    return itemsResult;
  }
  const decl: ImplDecl = {
    kind: "Impl",
    tokenId: start,
    generics: genericsResult.generics,
    traitRef: targetResult.value.traitRef,
    type: targetResult.value.type,
    whereClause: whereResult.whereClause,
    items: itemsResult.value.node,
    attributes,
  };
  return ok({ node: decl, next: itemsResult.value.next });
}

const UNSUPPORTED_TOP_LEVEL_KEYWORD_MESSAGES: ReadonlyMap<string, string> =
  new Map([
    ["export", "`export` declarations are not yet supported"],
    ["extern", "`extern` declarations are not yet supported"],
    ["use", unsupportedPathKeywordMessage("use")],
    ["mod", unsupportedPathKeywordMessage("mod")],
    ["async", unsupportedAsyncMessage()],
  ]);

/**
 * @returns the guardrail diagnostic message for a rejected top-level
 * declaration keyword, or `none()` if `keyword` isn't one of them.
 */
function unsupportedTopLevelKeywordMessage(keyword: string): Option<string> {
  const messageFor = UNSUPPORTED_TOP_LEVEL_KEYWORD_MESSAGES.get(keyword);
  return messageFor === undefined ? none() : some(messageFor);
}

/** Bubbles a per-element parse's own error, or wraps its success as the `Option<Item>` shape every branch below needs. */
function wrapItemResult(result: PR<Parsed<Item>>): PR<Parsed<Option<Item>>> {
  if (isErr(result)) {
    return result;
  }
  return ok({ node: some(result.value.node), next: result.value.next });
}

/**
 * `err(...)` if a visibility qualifier was actually consumed between
 * `cursor` and `afterVis` (i.e. `afterVis > cursor`), `ok(undefined)`
 * otherwise - shared by every item kind that rejects a leading `pub`
 * outright rather than accepting it.
 */
function rejectVisibility(
  tokens: readonly Token[],
  cursor: number,
  afterVis: number,
  message: string,
): PR<undefined> {
  if (afterVis <= cursor) {
    return ok(undefined);
  }
  const visToken = tokens[cursor];
  return err(
    errorDiagnostic(
      "HEDGE-PARSE-006",
      message,
      visToken !== undefined ? some(visToken.span) : none(),
    ),
  );
}

type VisibleDeclarationParser = (
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[],
  visibility: Option<Visibility>,
) => PR<Parsed<Item>>;

/** The top-level keywords that accept a leading `pub` uniformly. */
const VISIBLE_DECLARATION_PARSERS = new Map<string, VisibleDeclarationParser>([
  ["fn", parseFunction],
  ["struct", parseStruct],
  ["enum", parseEnum],
  ["trait", parseTrait],
  ["const", parseConst],
  ["static", parseStatic],
]);

/**
 * Dispatches via {@link VISIBLE_DECLARATION_PARSERS}. `none()` means `token`
 * isn't one of them, so the caller should try the next candidate.
 */
function parseVisibleDeclarationItem(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  afterVis: number,
  attributes: readonly Attribute[],
  visibility: Option<Visibility>,
  token: Token,
): Option<PR<Parsed<Option<Item>>>> {
  if (token.kind !== "keyword") {
    return none();
  }
  const parseDeclaration = VISIBLE_DECLARATION_PARSERS.get(token.text);
  if (parseDeclaration === undefined) {
    return none();
  }
  return some(
    wrapItemResult(
      parseDeclaration(tokens, diagnostics, afterVis, attributes, visibility),
    ),
  );
}

type NoVisibilityParser = (
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[],
) => PR<Parsed<Item>>;

interface NoVisibilityEntry {
  readonly rejectionMessage: string;
  readonly parse: NoVisibilityParser;
}

/** The top-level keywords that reject a leading `pub` outright. */
const NO_VISIBILITY_PARSERS = new Map<string, NoVisibilityEntry>([
  [
    "type",
    {
      rejectionMessage: "visibility qualifiers are not allowed on a type alias",
      parse: parseTypeAlias,
    },
  ],
  [
    "impl",
    {
      rejectionMessage: "visibility qualifiers are not allowed on impl blocks",
      parse: parseImpl,
    },
  ],
  [
    "let",
    {
      rejectionMessage:
        "visibility qualifiers are not allowed on let statements",
      parse: parseLetStatement,
    },
  ],
]);

/**
 * Dispatches via {@link NO_VISIBILITY_PARSERS}. `none()` means `token` isn't
 * one of them, so the caller should try the next candidate.
 */
function parseNoVisibilityItem(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  cursor: number,
  afterVis: number,
  attributes: readonly Attribute[],
  token: Token,
): Option<PR<Parsed<Option<Item>>>> {
  if (token.kind !== "keyword") {
    return none();
  }
  const entry = NO_VISIBILITY_PARSERS.get(token.text);
  if (entry === undefined) {
    return none();
  }
  const rejected = rejectVisibility(
    tokens,
    cursor,
    afterVis,
    entry.rejectionMessage,
  );
  return some(
    isErr(rejected)
      ? rejected
      : wrapItemResult(entry.parse(tokens, diagnostics, afterVis, attributes)),
  );
}

/**
 * Falls through to an unsupported top-level keyword (skipped, diagnosed,
 * recovered), a stray `pub` on none of the above, or a bare expression -
 * the tail of `parseItem`'s own dispatch once no declaration keyword matched.
 */
function parseUnsupportedOrExpressionItem(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  cursor: number,
  afterVis: number,
  token: Token | undefined,
): PR<Parsed<Option<Item>>> {
  if (token?.kind === "keyword") {
    const message = unsupportedTopLevelKeywordMessage(token.text);
    if (isSome(message)) {
      const skipResult = skipUnsupportedTopLevelItem(
        tokens,
        token,
        afterVis,
        message.value,
      );
      if (isErr(skipResult)) {
        return skipResult;
      }
      diagnostics.push(skipResult.value.diagnostic);
      return ok({ node: none(), next: skipResult.value.next });
    }
  }
  const rejected = rejectVisibility(
    tokens,
    cursor,
    afterVis,
    "visibility qualifiers are not allowed here",
  );
  if (isErr(rejected)) {
    return rejected;
  }
  const exprResult = parseExpression(tokens, diagnostics, cursor);
  if (isErr(exprResult)) {
    return exprResult;
  }
  const parsed = exprResult.value;
  if (tokens[parsed.next]?.kind === "semi") {
    return ok({
      node: some(expressionStatement(parsed.node)),
      next: parsed.next + 1,
    });
  }
  return ok({ node: some(parsed.node), next: parsed.next });
}

/**
 * Parses a top-level item.
 *
 * Supported slice-1 items:
 *
 * - Function declarations
 * - Struct declarations (named-field, tuple, and unit forms)
 * - Let statements
 * - Expression statements
 * - Bare expressions
 */
export function parseItem(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Option<Item>>> {
  // Collect outer attributes (#[...]) before the item and attach them to the
  // named declaration that follows (a function, struct, or `let`).
  const outerResult = collectOuterAttributes(tokens, pos);
  if (isErr(outerResult)) {
    return outerResult;
  }
  const attributes = outerResult.value.attributes;
  const cursor = outerResult.value.next;

  const visResult = parseVisibility(tokens, cursor);
  if (isErr(visResult)) {
    return visResult;
  }
  const vis = visResult.value;
  const afterVis = vis.next;
  const token = tokens[afterVis];

  if (token !== undefined) {
    const declarationResult = parseVisibleDeclarationItem(
      tokens,
      diagnostics,
      afterVis,
      attributes,
      vis.node,
      token,
    );
    if (isSome(declarationResult)) {
      return declarationResult.value;
    }
    const noVisibilityResult = parseNoVisibilityItem(
      tokens,
      diagnostics,
      cursor,
      afterVis,
      attributes,
      token,
    );
    if (isSome(noVisibilityResult)) {
      return noVisibilityResult.value;
    }
  }

  return parseUnsupportedOrExpressionItem(
    tokens,
    diagnostics,
    cursor,
    afterVis,
    token,
  );
}
