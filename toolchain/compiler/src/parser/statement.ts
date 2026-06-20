import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type {
  Attribute,
  BindingPattern,
  Block,
  Expression,
  LetStatement,
  Statement,
  Type,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import { expect, expectKeyword, isContextual } from "./parse-utils.js";
import { collectInnerAttributes, collectOuterAttributes } from "./attribute.js";
import { expressionStatement, parseExpression } from "./expression.js";
import { parseIdentifier } from "./path.js";
import { parseType } from "./type.js";

/**
 * Parses a binding pattern.
 *
 * Slice-1 only supports simple identifier bindings.
 *
 * Grammar:
 *
 * ```text
 * BindingPattern ::= Identifier
 * ```
 */
function parseBindingPattern(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<BindingPattern>> {
  const identResult = parseIdentifier(tokens, diagnostics, pos);
  if (!isSome(identResult)) {
    return none();
  }
  const ident = identResult.value;
  return some({
    node: { kind: "BindingPattern", name: ident.node },
    next: ident.next,
  });
}

/**
 * Parses a `let` statement.
 *
 * Grammar:
 *
 * ```text
 * LetStatement ::=
 *   "let"
 *   "bind"?
 *   "write"?
 *   BindingPattern
 *   ("=" Expression)?
 *   ";"
 * ```
 *
 * Examples:
 *
 * ```hedge
 * let value;
 * let value = 42;
 * let write counter = 0;
 * let bind resource = open();
 * ```
 */
// eslint-disable-next-line complexity -- Multiple optional clauses (bind, write, type, initializer) each contribute a branch; the grammar drives the complexity, not poor structure.
export function parseLetStatement(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  attributes: readonly Attribute[] = [],
): Option<Parsed<LetStatement>> {
  const start = pos;
  const afterLet = expectKeyword(tokens, diagnostics, pos, "let");
  if (!isSome(afterLet)) {
    return none();
  }
  let cursor = afterLet.value;

  let bind = false;
  let write = false;
  const maybeBind = tokens[cursor];
  if (maybeBind !== undefined && isContextual(maybeBind, "bind")) {
    bind = true;
    cursor += 1;
  }
  const maybeWrite = tokens[cursor];
  if (maybeWrite !== undefined && isContextual(maybeWrite, "write")) {
    write = true;
    cursor += 1;
  }

  const patternResult = parseBindingPattern(tokens, diagnostics, cursor);
  if (!isSome(patternResult)) {
    return none();
  }
  const pattern = patternResult.value;
  cursor = pattern.next;

  let typeAnnotation: Option<Type> = none();
  if (tokens[cursor]?.kind === "colon") {
    cursor += 1;
    const typeResult = parseType(tokens, diagnostics, cursor);
    if (!isSome(typeResult)) {
      return none();
    }
    typeAnnotation = some(typeResult.value.node);
    cursor = typeResult.value.next;
  }

  let initializer: Option<Expression> = none();
  if (tokens[cursor]?.kind === "eq") {
    const initResult = parseExpression(tokens, diagnostics, cursor + 1);
    if (!isSome(initResult)) {
      return none();
    }
    initializer = some(initResult.value.node);
    cursor = initResult.value.next;
  }

  const afterSemi = expect(tokens, diagnostics, cursor, "semi");
  if (!isSome(afterSemi)) {
    return none();
  }

  const letStmt: LetStatement = {
    kind: "LetStatement",
    tokenId: start,
    attributes,
    bind,
    write,
    pattern: pattern.node,
    type: typeAnnotation,
    initializer,
  };
  return some({ node: letStmt, next: afterSemi.value });
}

/**
 * Parses a block expression.
 *
 * A block may contain zero or more statements followed by an optional trailing
 * expression whose value becomes the value of the block.
 *
 * Grammar:
 *
 * ```text
 * Block ::= "{"
 *             Statement*
 *             Expression?
 *           "}"
 * ```
 *
 * Example:
 *
 * ```hedge
 * {
 *   let x = 1;
 *   let y = 2;
 *   add(x, y)
 * }
 * ```
 */
// eslint-disable-next-line complexity -- Statement-dispatch loop with attribute collection and trailing-expression detection; splitting would obscure the grammar rule.
export function parseBlock(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Block>> {
  const start = pos;
  const afterLbrace = expect(tokens, diagnostics, pos, "lbrace");
  if (!isSome(afterLbrace)) {
    return none();
  }
  let cursor = afterLbrace.value;

  // Inner attributes at the start of a block document the enclosing function.
  const innerResult = collectInnerAttributes(tokens, diagnostics, cursor);
  if (!isSome(innerResult)) {
    return none();
  }
  const innerAttributes = innerResult.value.attributes;
  cursor = innerResult.value.next;

  const statements: Statement[] = [];
  let trailing: Expression | null = null;
  for (;;) {
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    // Outer attributes (e.g. `/// doc`) before a statement attach to a following
    // `let` — the only named target inside a block. Before anything else they
    // have nothing to document and are discarded.
    const outerResult = collectOuterAttributes(tokens, diagnostics, cursor);
    if (!isSome(outerResult)) {
      return none();
    }
    cursor = outerResult.value.next;
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    const token = tokens[cursor];
    if (token?.kind === "keyword" && token.text === "let") {
      const letResult = parseLetStatement(
        tokens,
        diagnostics,
        cursor,
        outerResult.value.attributes,
      );
      if (!isSome(letResult)) {
        return none();
      }
      statements.push(letResult.value.node);
      cursor = letResult.value.next;
      continue;
    }
    const exprResult = parseExpression(tokens, diagnostics, cursor);
    if (!isSome(exprResult)) {
      return none();
    }
    cursor = exprResult.value.next;
    if (tokens[cursor]?.kind === "semi") {
      statements.push(expressionStatement(exprResult.value.node));
      cursor += 1;
      continue;
    }
    trailing = exprResult.value.node;
    break;
  }
  const block: Block = {
    kind: "Block",
    tokenId: start,
    statements,
    trailingExpression: trailing !== null ? some(trailing) : none(),
    innerAttributes,
  };
  const afterRbrace = expect(tokens, diagnostics, cursor, "rbrace");
  if (!isSome(afterRbrace)) {
    return none();
  }
  return some({ node: block, next: afterRbrace.value });
}
