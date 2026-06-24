import type { Token } from "../lexer/token.js";
import { none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  Attribute,
  BindingPattern,
  FunctionDecl,
  Item,
  NamedFieldsBody,
  Param,
  StructBody,
  StructDecl,
  StructField,
  TupleField,
  TupleFieldsBody,
  Type,
  Visibility,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  expectKeyword,
  parseIdentifier,
  type PR,
} from "./parse-utils.js";
import { collectOuterAttributes } from "./attribute.js";
import { parseExpression } from "./expression.js";
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
 * Param  ::= BindingPattern ":" Type
 * ```
 */
// eslint-disable-next-line complexity -- This is too difficult to split up
function parseParams(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<readonly Param[]>> {
  const afterOpen = expect(tokens, pos, "lparen");
  if (isErr(afterOpen)) {
    return afterOpen;
  }
  let cursor = afterOpen.value;
  const params: Param[] = [];

  for (;;) {
    if (tokens[cursor]?.kind === "rparen") {
      break;
    }
    const paramStart = cursor;
    const identResult = parseIdentifier(tokens, cursor);
    if (isErr(identResult)) {
      return identResult;
    }
    const pattern: BindingPattern = {
      kind: "BindingPattern",
      name: identResult.value.node,
    };
    cursor = identResult.value.next;

    if (tokens[cursor]?.kind !== "colon") {
      const token = tokens[cursor];
      return err({
        severity: "error",
        message: `expected ':' after parameter name '${pattern.name.text}'`,
        span: token !== undefined ? some(token.span) : none(),
      });
    }
    cursor += 1;

    const typeResult = parseType(tokens, cursor);
    if (isErr(typeResult)) {
      return typeResult;
    }
    cursor = typeResult.value.next;

    params.push({
      kind: "Param",
      tokenId: paramStart,
      pattern,
      type: typeResult.value.node,
    });

    if (tokens[cursor]?.kind === "comma") {
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
  const paramsResult = parseParams(tokens, nameResult.value.next);
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
  const bodyResult = parseBlock(tokens, cursor);
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
// eslint-disable-next-line complexity -- This is too difficult to split up
function parseNamedFieldsBody(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<NamedFieldsBody>> {
  const afterLbrace = expect(tokens, pos, "lbrace");
  if (isErr(afterLbrace)) {
    return afterLbrace;
  }
  let cursor = afterLbrace.value;
  const fields: StructField[] = [];

  for (;;) {
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }

    const attrResult = collectOuterAttributes(tokens, cursor);
    if (isErr(attrResult)) {
      return attrResult;
    }
    const fieldAttrs = attrResult.value.attributes;
    cursor = attrResult.value.next;

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

    fields.push({
      kind: "StructField",
      tokenId: fieldStart,
      attributes: fieldAttrs,
      visibility: visResult.value.node,
      name: fieldName,
      type: typeResult.value.node,
    });

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
function parseTupleFieldsBody(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<TupleFieldsBody>> {
  const afterLparen = expect(tokens, pos, "lparen");
  if (isErr(afterLparen)) {
    return afterLparen;
  }
  let cursor = afterLparen.value;
  const fields: TupleField[] = [];

  for (;;) {
    if (tokens[cursor]?.kind === "rparen") {
      break;
    }

    const attrResult = collectOuterAttributes(tokens, cursor);
    if (isErr(attrResult)) {
      return attrResult;
    }
    const fieldAttrs = attrResult.value.attributes;
    cursor = attrResult.value.next;

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

    fields.push({
      kind: "TupleField",
      tokenId: fieldStart,
      attributes: fieldAttrs,
      visibility: visResult.value.node,
      type: typeResult.value.node,
    });

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
  let cursor = nameResult.value.next;

  let body: StructBody;
  const bodyToken = tokens[cursor];

  if (bodyToken?.kind === "semi") {
    body = { kind: "Unit" };
    cursor += 1;
  } else if (bodyToken?.kind === "lbrace") {
    const bodyResult = parseNamedFieldsBody(tokens, cursor);
    if (isErr(bodyResult)) {
      return bodyResult;
    }
    body = bodyResult.value.node;
    cursor = bodyResult.value.next;
  } else if (bodyToken?.kind === "lparen") {
    const bodyResult = parseTupleFieldsBody(tokens, cursor);
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

const UNSUPPORTED_SLICE1_KEYWORDS = new Set([
  "enum",
  "export",
  "extern",
  "impl",
  "trait",
]);

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
  pos: number,
): PR<Parsed<Item>> {
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
    const fnResult = parseFunction(tokens, afterVis, attributes, vis.node);
    if (isErr(fnResult)) {
      return fnResult;
    }
    return ok(fnResult.value);
  }
  if (token?.kind === "keyword" && token.text === "struct") {
    const structResult = parseStruct(tokens, afterVis, attributes, vis.node);
    if (isErr(structResult)) {
      return structResult;
    }
    return ok(structResult.value);
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
    const letResult = parseLetStatement(tokens, afterVis, attributes);
    if (isErr(letResult)) {
      return letResult;
    }
    return ok(letResult.value);
  }
  if (
    token?.kind === "keyword" &&
    UNSUPPORTED_SLICE1_KEYWORDS.has(token.text)
  ) {
    return err({
      severity: "error",
      message: `\`${token.text}\` declarations are not supported in Slice 1`,
      span: some(token.span),
    });
  }
  if (afterVis > cursor) {
    const visToken = tokens[cursor];
    return err({
      severity: "error",
      message: "visibility qualifiers are not allowed here",
      span: visToken !== undefined ? some(visToken.span) : none(),
    });
  }
  const exprResult = parseExpression(tokens, cursor);
  if (isErr(exprResult)) {
    return exprResult;
  }
  const parsed = exprResult.value;
  if (tokens[parsed.next]?.kind === "semi") {
    return ok({
      node: expressionStatement(parsed.node),
      next: parsed.next + 1,
    });
  }
  return ok(parsed);
}
