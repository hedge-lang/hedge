import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, unwrapSomeOr, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import {
  patternBindingName,
  type Attribute,
  type FunctionDecl,
  type Item,
  type NamedFieldsBody,
  type Param,
  type StructBody,
  type StructDecl,
  type StructField,
  type TupleField,
  type TupleFieldsBody,
  type Type,
  type Visibility,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  expectKeyword,
  isGuardrailDiagnostic,
  isLifetimeGenericsStart,
  kindAt,
  parseIdentifier,
  skipBalancedAngleList,
  skipToFunctionBody,
  skipToStructBody,
  skipUnsupportedTopLevelItem,
  skipUntilKindBalanced,
  spanAt,
  unsupportedAsyncMessage,
  unsupportedGenericsMessage,
  unsupportedLifetimeMessage,
  unsupportedPathKeywordMessage,
  type PR,
} from "./parse-utils.js";
import { collectOuterAttributes } from "./attribute.js";
import { parseExpression } from "./expression.js";
import { parsePattern } from "./pattern.js";
import {
  expressionStatement,
  parseBlock,
  parseLetStatement,
} from "./statement.js";
import { parseType } from "./type.js";

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
        return err({
          severity: "error",
          message: `pub(${scope}) is not supported in Slice 1`,
          span: some(scopeToken.span),
        });
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
    return err({
      severity: "error",
      message: `expected ':' after parameter name '${name}'`,
      span: spanAt(tokens, cursor),
    });
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

function parseParams(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<readonly Param[]>> {
  const afterOpen = expect(tokens, pos, "lparen");
  if (isErr(afterOpen)) {
    return afterOpen;
  }
  let cursor = afterOpen.value;
  const params: Param[] = [];

  for (;;) {
    // The `eof` check avoids attempting (and separately diagnosing) an
    // element parse when nothing remains — the outer `expect(rparen)` below
    // already produces the single, correct "found end of input" diagnostic
    // for a truncated list; without this, both would fire redundantly.
    if (
      kindAt(tokens, cursor) === "rparen" ||
      kindAt(tokens, cursor) === "eof"
    ) {
      break;
    }
    const paramStart = cursor;
    const paramResult = parseParam(tokens, cursor);

    if (isErr(paramResult)) {
      if (isGuardrailDiagnostic(paramResult.error)) {
        return paramResult;
      }
      diagnostics.push(paramResult.error);
      cursor = skipUntilKindBalanced(tokens, paramStart, "comma", "rparen");
      if (kindAt(tokens, cursor) === "comma") {
        cursor += 1;
        continue;
      }
      break;
    }

    params.push(paramResult.value.node);
    cursor = paramResult.value.next;

    if (kindAt(tokens, cursor) === "comma") {
      cursor += 1;
    } else {
      break;
    }
  }

  const afterClose = expect(tokens, cursor, "rparen");
  if (isErr(afterClose)) {
    return afterClose;
  }
  return ok({ node: params, next: afterClose.value });
}

/**
 * @returns A Slice-1 diagnostic if the generic parameter list (`<...>`) starts
 * at `pos`; Otherwise returns `pos` unchanged.
 */
function skipDeclarationGenerics(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): number {
  const token = tokens[pos];
  if (token?.kind !== "lt") {
    return pos;
  }
  const message = isLifetimeGenericsStart(tokens, pos)
    ? unsupportedLifetimeMessage("lifetime parameters")
    : unsupportedGenericsMessage("generic parameter lists");
  diagnostics.push({
    severity: "error",
    message,
    span: some(token.span),
  });
  return skipBalancedAngleList(tokens, pos).next;
}

/**
 * If a `where` clause starts at `pos`, pushes a Slice-1 diagnostic and skips
 * it via `skip` (which knows the declaration kind's own body-start shape —
 * a function's body is always `{`, a struct's can be `{`/`(`/`;`). Otherwise
 * returns `pos` unchanged.
 */
function checkWhereClause(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  skip: (tokens: readonly Token[], pos: number) => number,
): number {
  const whereToken = tokens[pos];
  if (whereToken?.kind !== "keyword" || whereToken.text !== "where") {
    return pos;
  }
  diagnostics.push({
    severity: "error",
    message: unsupportedGenericsMessage("`where` clauses"),
    span: some(whereToken.span),
  });
  return skip(tokens, pos);
}

/**
 * Parses a function declaration.
 *
 * Grammar:
 *
 * ```text
 * FunctionDecl ::= Visibility? "fn" Identifier "(" Params? ")" ("->" Type)? Block
 * ```
 */
function parseFunction(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
  visibility: Option<Visibility> = none(),
): PR<Parsed<FunctionDecl>> {
  const start = pos;
  const afterFn = expectKeyword(tokens, pos, "fn");
  if (isErr(afterFn)) {
    return afterFn;
  }
  const nameResult = parseIdentifier(tokens, afterFn.value);
  if (isErr(nameResult)) {
    return nameResult;
  }

  // TODO: Actually parse generics, later.
  const afterGenerics = skipDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  const paramsResult = parseParams(tokens, diagnostics, afterGenerics);
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
  cursor = checkWhereClause(tokens, diagnostics, cursor, skipToFunctionBody);
  const bodyResult = parseBlock(tokens, diagnostics, cursor);
  if (isErr(bodyResult)) {
    return bodyResult;
  }
  const body = bodyResult.value;
  const fn: FunctionDecl = {
    kind: "Function",
    tokenId: start,
    visibility,
    name: nameResult.value.node,
    generics: [],
    params: paramsResult.value.node,
    returnType,
    whereClause: none(),
    attributes,
    body: body.node,
  };
  return ok({ node: fn, next: body.next });
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
    return err({
      severity: "error",
      message: `expected ':' after field name '${fieldName.text}'`,
      span: token !== undefined ? some(token.span) : none(),
    });
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

// eslint-disable-next-line complexity -- List-recovery loop with a guardrail/EOF branch each; splitting would obscure the control flow.
function parseNamedFieldsBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<NamedFieldsBody>> {
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  let cursor = afterLbrace.value;
  const fields: StructField[] = [];

  for (;;) {
    // See parseParams' matching check: avoids a redundant second diagnostic
    // when the list is truncated with nothing left to try parsing.
    if (tokens[cursor]?.kind === "rbrace" || tokens[cursor]?.kind === "eof") {
      break;
    }

    const fieldStart = cursor;
    const fieldResult = parseNamedField(tokens, cursor);

    if (isErr(fieldResult)) {
      if (isGuardrailDiagnostic(fieldResult.error)) {
        return fieldResult;
      }
      diagnostics.push(fieldResult.error);
      cursor = skipUntilKindBalanced(tokens, fieldStart, "comma", "rbrace");
      if (tokens[cursor]?.kind === "comma") {
        cursor += 1;
        continue;
      }
      break;
    }

    fields.push(fieldResult.value.node);
    cursor = fieldResult.value.next;

    if (tokens[cursor]?.kind === "comma") {
      cursor += 1;
    } else {
      break;
    }
  }

  const afterRbrace = expect(tokens, cursor, "rbrace");
  if (isErr(afterRbrace)) {
    return afterRbrace;
  }
  return ok({ node: { kind: "NamedFields", fields }, next: afterRbrace.value });
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

// eslint-disable-next-line complexity -- List-recovery loop with a guardrail/EOF branch each; splitting would obscure the control flow.
function parseTupleFieldsBody(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<TupleFieldsBody>> {
  const afterLparen = expect(tokens, pos, "lparen");
  if (isErr(afterLparen)) {
    return afterLparen;
  }
  let cursor = afterLparen.value;
  const fields: TupleField[] = [];

  for (;;) {
    // See parseParams' matching check: avoids a redundant second diagnostic
    // when the list is truncated with nothing left to try parsing.
    if (tokens[cursor]?.kind === "rparen" || tokens[cursor]?.kind === "eof") {
      break;
    }

    const fieldStart = cursor;
    const fieldResult = parseTupleField(tokens, cursor);

    if (isErr(fieldResult)) {
      if (isGuardrailDiagnostic(fieldResult.error)) {
        return fieldResult;
      }
      diagnostics.push(fieldResult.error);
      cursor = skipUntilKindBalanced(tokens, fieldStart, "comma", "rparen");
      if (tokens[cursor]?.kind === "comma") {
        cursor += 1;
        continue;
      }
      break;
    }

    fields.push(fieldResult.value.node);
    cursor = fieldResult.value.next;

    if (tokens[cursor]?.kind === "comma") {
      cursor += 1;
    } else {
      break;
    }
  }

  const afterRparen = expect(tokens, cursor, "rparen");
  if (isErr(afterRparen)) {
    return afterRparen;
  }
  return ok({ node: { kind: "TupleFields", fields }, next: afterRparen.value });
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
// eslint-disable-next-line complexity -- This is too difficult to split up
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
  let cursor = skipDeclarationGenerics(
    tokens,
    diagnostics,
    nameResult.value.next,
  );
  cursor = checkWhereClause(tokens, diagnostics, cursor, skipToStructBody);

  let body: StructBody;
  const bodyToken = tokens[cursor];

  if (bodyToken?.kind === "semi") {
    body = { kind: "Unit" };
    cursor += 1;
  } else if (bodyToken?.kind === "lbrace") {
    const bodyResult = parseNamedFieldsBody(tokens, diagnostics, cursor);
    if (isErr(bodyResult)) {
      return bodyResult;
    }
    body = bodyResult.value.node;
    cursor = bodyResult.value.next;
  } else if (bodyToken?.kind === "lparen") {
    const bodyResult = parseTupleFieldsBody(tokens, diagnostics, cursor);
    if (isErr(bodyResult)) {
      return bodyResult;
    }
    body = bodyResult.value.node;
    cursor = bodyResult.value.next;
    const afterSemi = expect(tokens, cursor, "semi");
    if (isErr(afterSemi)) {
      return afterSemi;
    }
    cursor = afterSemi.value;
  } else {
    return err({
      severity: "error",
      message: `expected struct body (\`{\`, \`(\`, or \`;\`), found "${bodyToken?.kind ?? "end of input"}"`,
      span: bodyToken !== undefined ? some(bodyToken.span) : none(),
    });
  }

  const decl: StructDecl = {
    kind: "Struct",
    tokenId: start,
    visibility,
    name: nameResult.value.node,
    body,
    attributes,
  };
  return ok({ node: decl, next: cursor });
}

const UNSUPPORTED_TOP_LEVEL_KEYWORD_MESSAGES: ReadonlyMap<string, string> =
  new Map([
    ["enum", "`enum` declarations are not supported in Slice 1"],
    ["export", "`export` declarations are not supported in Slice 1"],
    ["extern", "`extern` declarations are not supported in Slice 1"],
    ["impl", "`impl` declarations are not supported in Slice 1"],
    ["trait", "`trait` declarations are not supported in Slice 1"],
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
// eslint-disable-next-line complexity -- Top-level item dispatch with visibility/attribute prefix; each item kind is a necessary branch.
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
  if (token?.kind === "keyword" && token.text === "fn") {
    const fnResult = parseFunction(
      tokens,
      diagnostics,
      afterVis,
      attributes,
      vis.node,
    );
    if (isErr(fnResult)) {
      return fnResult;
    }
    return ok({ node: some(fnResult.value.node), next: fnResult.value.next });
  }
  if (token?.kind === "keyword" && token.text === "struct") {
    const structResult = parseStruct(
      tokens,
      diagnostics,
      afterVis,
      attributes,
      vis.node,
    );
    if (isErr(structResult)) {
      return structResult;
    }
    return ok({
      node: some(structResult.value.node),
      next: structResult.value.next,
    });
  }
  if (token?.kind === "keyword" && token.text === "let") {
    if (afterVis > cursor) {
      const visToken = tokens[cursor];
      return err({
        severity: "error",
        message: "visibility qualifiers are not allowed on let statements",
        span: visToken !== undefined ? some(visToken.span) : none(),
      });
    }
    const letResult = parseLetStatement(
      tokens,
      diagnostics,
      afterVis,
      attributes,
    );
    if (isErr(letResult)) {
      return letResult;
    }
    return ok({
      node: some(letResult.value.node),
      next: letResult.value.next,
    });
  }
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
  if (afterVis > cursor) {
    const visToken = tokens[cursor];
    return err({
      severity: "error",
      message: "visibility qualifiers are not allowed here",
      span: visToken !== undefined ? some(visToken.span) : none(),
    });
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
