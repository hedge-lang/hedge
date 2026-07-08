import { assert, assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import { resolveEscape } from "../lexer/escape.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  BinaryExpression,
  BinaryOperator,
  CompoundAssignOperator,
  Expression,
  FieldInit,
  FloatLiteral,
  IfExpression,
  IndexExpression,
  IntLiteral,
  MethodCallExpression,
  PathExpression,
  ReferenceExpression,
  StructExpression,
  TupleExpression,
  UnaryExpression,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  isLifetimeGenericsStart,
  loopKeywordAt,
  parseIdentifier,
  pathSepBeforeLt,
  stripPrefix,
  stripUnderscores,
  tokenAt,
  unsupportedGenericsMessage,
  unsupportedLifetimeMessage,
  unsupportedLoopMessage,
  type PR,
} from "./parse-utils.js";
import { parsePath } from "./path.js";
import { parseBlock } from "./statement.js";

export function parseIntLiteral(
  pos: number,
  token: Extract<Token, { kind: "int" }>,
): Parsed<IntLiteral> {
  const rawDigits = stripPrefix(token.text, token.radix);
  const digits = isSome(token.suffix)
    ? rawDigits.slice(0, -token.suffix.value.length)
    : rawDigits;
  const value = stripUnderscores(digits);
  return {
    node: {
      kind: "IntLiteral",
      tokenId: pos,
      value,
      base: token.radix,
      suffix: token.suffix,
    },
    next: pos + 1,
  };
}

function parseFloatLiteral(
  pos: number,
  token: Extract<Token, { kind: "float" }>,
): Parsed<FloatLiteral> {
  const floatText = isSome(token.suffix)
    ? token.text.slice(0, -token.suffix.value.length)
    : token.text;
  const value = stripUnderscores(floatText);
  return {
    node: { kind: "FloatLiteral", tokenId: pos, value, suffix: token.suffix },
    next: pos + 1,
  };
}

type InfixEntry =
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperator;
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    }
  | {
      readonly kind: "assign";
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    }
  | {
      readonly kind: "compound-assign";
      readonly operator: CompoundAssignOperator;
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    }
  | { readonly kind: "postfix-call"; readonly leftBp: number }
  | { readonly kind: "postfix-field"; readonly leftBp: number }
  | { readonly kind: "postfix-index"; readonly leftBp: number };

// eslint-disable-next-line complexity -- dispatch table; more readable than alternatives
function infixOp(token: Token): InfixEntry | null {
  switch (token.kind) {
    // Prec 1 — postfix (bp 26, left-to-right)
    case "lparen":
      return { kind: "postfix-call", leftBp: 26 };
    case "dot":
      return { kind: "postfix-field", leftBp: 26 };
    case "lbracket":
      return { kind: "postfix-index", leftBp: 26 };
    // Prec 3 — multiplicative (bp 22, left-assoc)
    case "star":
      return {
        kind: "binary",
        operator: "Mul",
        leftBp: 22,
        rightBp: 23,
        nonAssoc: false,
        sigil: "*",
      };
    case "slash":
      return {
        kind: "binary",
        operator: "Div",
        leftBp: 22,
        rightBp: 23,
        nonAssoc: false,
        sigil: "/",
      };
    case "percent":
      return {
        kind: "binary",
        operator: "Rem",
        leftBp: 22,
        rightBp: 23,
        nonAssoc: false,
        sigil: "%",
      };
    // Prec 4 — additive (bp 20, left-assoc)
    case "plus":
      return {
        kind: "binary",
        operator: "Add",
        leftBp: 20,
        rightBp: 21,
        nonAssoc: false,
        sigil: "+",
      };
    case "minus":
      return {
        kind: "binary",
        operator: "Sub",
        leftBp: 20,
        rightBp: 21,
        nonAssoc: false,
        sigil: "-",
      };
    // Prec 5 — bitshift (bp 18, left-assoc)
    case "lt_lt":
      return {
        kind: "binary",
        operator: "Shl",
        leftBp: 18,
        rightBp: 19,
        nonAssoc: false,
        sigil: "<<",
      };
    case "gt_gt":
      return {
        kind: "binary",
        operator: "Shr",
        leftBp: 18,
        rightBp: 19,
        nonAssoc: false,
        sigil: ">>",
      };
    // Prec 6 — bit-and (bp 16, left-assoc); infix position only — prefix & is ReferenceExpression
    case "amp":
      return {
        kind: "binary",
        operator: "BitAnd",
        leftBp: 16,
        rightBp: 17,
        nonAssoc: false,
        sigil: "&",
      };
    // Prec 7 — bit-xor (bp 14, left-assoc)
    case "caret":
      return {
        kind: "binary",
        operator: "BitXor",
        leftBp: 14,
        rightBp: 15,
        nonAssoc: false,
        sigil: "^",
      };
    // Prec 8 — bit-or (bp 12, left-assoc)
    case "pipe":
      return {
        kind: "binary",
        operator: "BitOr",
        leftBp: 12,
        rightBp: 13,
        nonAssoc: false,
        sigil: "|",
      };
    // Prec 9 — comparison (bp 10, non-associative)
    case "eq_eq":
      return {
        kind: "binary",
        operator: "Eq",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "==",
      };
    case "bang_eq":
      return {
        kind: "binary",
        operator: "Ne",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "!=",
      };
    case "lt":
      return {
        kind: "binary",
        operator: "Lt",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "<",
      };
    case "gt":
      return {
        kind: "binary",
        operator: "Gt",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: ">",
      };
    case "lt_eq":
      return {
        kind: "binary",
        operator: "Le",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: "<=",
      };
    case "gt_eq":
      return {
        kind: "binary",
        operator: "Ge",
        leftBp: 10,
        rightBp: 11,
        nonAssoc: true,
        sigil: ">=",
      };
    // Prec 10 — logical-and (bp 8, left-assoc)
    case "amp_amp":
      return {
        kind: "binary",
        operator: "And",
        leftBp: 8,
        rightBp: 9,
        nonAssoc: false,
        sigil: "&&",
      };
    // Prec 11 — logical-or (bp 6, left-assoc)
    case "pipe_pipe":
      return {
        kind: "binary",
        operator: "Or",
        leftBp: 6,
        rightBp: 7,
        nonAssoc: false,
        sigil: "||",
      };
    // Prec 13 — assignment (bp 2, right-assoc: rightBp < leftBp)
    case "eq":
      return {
        kind: "assign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "=",
      };
    case "plus_eq":
      return {
        kind: "compound-assign",
        operator: "AddAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "+=",
      };
    case "minus_eq":
      return {
        kind: "compound-assign",
        operator: "SubAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "-=",
      };
    case "star_eq":
      return {
        kind: "compound-assign",
        operator: "MulAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "*=",
      };
    case "slash_eq":
      return {
        kind: "compound-assign",
        operator: "DivAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "/=",
      };
    case "percent_eq":
      return {
        kind: "compound-assign",
        operator: "RemAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "%=",
      };
    case "amp_eq":
      return {
        kind: "compound-assign",
        operator: "BitAndAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "&=",
      };
    case "pipe_eq":
      return {
        kind: "compound-assign",
        operator: "BitOrAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "|=",
      };
    case "caret_eq":
      return {
        kind: "compound-assign",
        operator: "BitXorAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "^=",
      };
    case "lt_lt_eq":
      return {
        kind: "compound-assign",
        operator: "ShlAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: "<<=",
      };
    case "gt_gt_eq":
      return {
        kind: "compound-assign",
        operator: "ShrAssign",
        leftBp: 2,
        rightBp: 1,
        nonAssoc: false,
        sigil: ">>=",
      };
    default:
      return null;
  }
}

/**
 * Parses a reference expression.
 *
 * Grammar:
 *
 * ```text
 * ReferenceExpression ::= "&" "mut"? PrimaryExpression
 * ```
 *
 * Examples:
 *
 * ```hedge
 * &value
 * &mut counter
 * ```
 */
function parseReference(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  allowStruct: boolean,
): PR<Parsed<ReferenceExpression>> {
  let cursor = pos + 1;
  let mutable = false;
  const aResult = tokenAt(tokens, cursor);
  if (isErr(aResult)) {
    return aResult;
  }
  const a = aResult.value;
  if (a.kind === "keyword" && a.text === "mut") {
    mutable = true;
    cursor += 1;
  }
  // Parse the operand at unary precedence (24) so postfix ops like . and () bind to
  // the operand rather than the surrounding expression: &a.b ⟹ &(a.b), &f() ⟹ &(f())
  const operandResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    24,
    allowStruct,
  );
  if (isErr(operandResult)) return operandResult;
  const operand = operandResult.value;
  const reference: ReferenceExpression = {
    kind: "ReferenceExpression",
    tokenId: pos,
    mutable,
    operand: operand.node,
  };
  return ok({ node: reference, next: operand.next });
}

/** Parses `()`, `(expr)` (grouping), or `(a, b, ...)` (tuple). */
// eslint-disable-next-line complexity
function parseTupleOrGroup(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Expression>> {
  const start = pos;
  let cursor = pos + 1; // skip `(`

  // Unit: ()
  if (tokens[cursor]?.kind === "rparen") {
    const tuple: TupleExpression = {
      kind: "TupleExpression",
      tokenId: start,
      elements: [],
    };
    return ok({ node: tuple, next: cursor + 1 });
  }

  // Parse the first element; tuple elements are always in struct-ok position
  const firstResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    0,
    true,
  );
  if (isErr(firstResult)) return firstResult;
  cursor = firstResult.value.next;

  // No comma → transparent grouping (passes allowStruct through; no new node)
  if (tokens[cursor]?.kind === "rparen") {
    return ok({ node: firstResult.value.node, next: cursor + 1 });
  }

  if (tokens[cursor]?.kind !== "comma") {
    const tok = tokens[cursor];
    return err({
      severity: "error",
      message: `Expected ',' or ')' after expression in parentheses`,
      span: tok !== undefined ? some(tok.span) : none(),
    });
  }

  // Collect remaining tuple elements
  const elements: Expression[] = [firstResult.value.node];
  while (tokens[cursor]?.kind === "comma") {
    cursor += 1; // skip comma
    if (tokens[cursor]?.kind === "rparen") break; // trailing comma
    const elemResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      cursor,
      0,
      true,
    );
    if (isErr(elemResult)) return elemResult;
    elements.push(elemResult.value.node);
    cursor = elemResult.value.next;
  }

  const closeResult = expect(tokens, cursor, "rparen");
  if (isErr(closeResult)) return closeResult;

  const tuple: TupleExpression = {
    kind: "TupleExpression",
    tokenId: start,
    elements,
  };
  return ok({ node: tuple, next: closeResult.value });
}

/** Parses `if cond { then } (else (if ... | { else }))?`. */
// eslint-disable-next-line complexity -- This is mostly a routing function
function parseIfExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<IfExpression>> {
  const start = pos;
  // Token at pos is the `if` keyword — advance past it
  const afterIf = pos + 1;

  // Condition is ExpressionNoStruct — `{` always starts the then-block, never a struct literal
  const condResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    afterIf,
    0,
    false,
  );
  if (isErr(condResult)) return condResult;

  const thenTok = tokens[condResult.value.next];
  if (thenTok === undefined || thenTok.kind !== "lbrace") {
    return err({
      severity: "error",
      message: `Expected '{' to start if body`,
      span: thenTok !== undefined ? some(thenTok.span) : none(),
    });
  }
  const thenResult = parseBlock(tokens, diagnostics, condResult.value.next);
  if (isErr(thenResult)) return thenResult;

  let cursor = thenResult.value.next;
  let elseBranch: IfExpression["elseBranch"] = none();

  const elseToken = tokens[cursor];
  if (elseToken?.kind === "keyword" && elseToken.text === "else") {
    cursor += 1; // skip `else`
    const afterElse = tokens[cursor];
    if (afterElse?.kind === "keyword" && afterElse.text === "if") {
      const elseIfResult = parseIfExpression(tokens, diagnostics, cursor);
      if (isErr(elseIfResult)) return elseIfResult;
      elseBranch = some(elseIfResult.value.node);
      cursor = elseIfResult.value.next;
    } else if (afterElse?.kind === "lbrace") {
      const elseBlockResult = parseBlock(tokens, diagnostics, cursor);
      if (isErr(elseBlockResult)) return elseBlockResult;
      elseBranch = some(elseBlockResult.value.node);
      cursor = elseBlockResult.value.next;
    } else {
      return err({
        severity: "error",
        message: `Expected 'if' or '{' after 'else'`,
        span: afterElse !== undefined ? some(afterElse.span) : none(),
      });
    }
  }

  const node: IfExpression = {
    kind: "IfExpression",
    tokenId: start,
    condition: condResult.value.node,
    thenBranch: thenResult.value.node,
    elseBranch,
  };
  return ok({ node, next: cursor });
}

/** Parses `Path "{" FieldInits? (".." Expression)? "}"`. */
// eslint-disable-next-line complexity
function parseStructExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  pathNode: PathExpression,
): PR<Parsed<StructExpression>> {
  let cursor = pos + 1; // skip `{`

  const fields: FieldInit[] = [];
  let base: StructExpression["base"] = none();

  while (
    tokens[cursor]?.kind !== "rbrace" &&
    tokens[cursor]?.kind !== "eof" &&
    tokens[cursor] !== undefined
  ) {
    // Struct update spread: `..expr`
    if (tokens[cursor]?.kind === "dot_dot") {
      const spreadTok = tokens[cursor];
      assert(spreadTok !== undefined, "Expected spread token to be defined");
      cursor += 1;
      const baseResult = parseExpressionWithBindingPower(
        tokens,
        diagnostics,
        cursor,
        0,
        true,
      );
      if (isErr(baseResult)) return baseResult;
      base = some(baseResult.value.node);
      cursor = baseResult.value.next;
      diagnostics.push({
        severity: "warning",
        message:
          "struct update expression (`..base`) is not yet supported in semantic analysis",
        span: some(spreadTok.span),
      });
      if (tokens[cursor]?.kind === "comma") cursor += 1; // trailing comma after spread
      if (tokens[cursor]?.kind !== "rbrace") {
        const tok = tokens[cursor];
        return err({
          severity: "error",
          message: `Expected '}' after struct update expression — spread must be last`,
          span: tok !== undefined ? some(tok.span) : none(),
        });
      }
      break;
    }

    // Field init: Identifier (":" Expression)?
    const nameResult = parseIdentifier(tokens, cursor);
    if (isErr(nameResult)) return nameResult;
    cursor = nameResult.value.next;

    let fieldValue: FieldInit["value"] = none();
    if (tokens[cursor]?.kind === "colon") {
      cursor += 1;
      const valResult = parseExpressionWithBindingPower(
        tokens,
        diagnostics,
        cursor,
        0,
        true,
      );
      if (isErr(valResult)) return valResult;
      fieldValue = some(valResult.value.node);
      cursor = valResult.value.next;
    }

    const fieldInit: FieldInit = {
      kind: "FieldInit",
      tokenId: nameResult.value.node.tokenId,
      name: nameResult.value.node,
      value: fieldValue,
    };
    fields.push(fieldInit);

    if (tokens[cursor]?.kind === "comma") {
      cursor += 1;
    } else {
      break;
    }
  }

  const closeTok = tokens[cursor];
  if (closeTok === undefined || closeTok.kind !== "rbrace") {
    return err({
      severity: "error",
      message: `Expected '}' to close struct expression`,
      span: closeTok !== undefined ? some(closeTok.span) : none(),
    });
  }

  const node: StructExpression = {
    kind: "StructExpression",
    tokenId: pathNode.tokenId,
    path: pathNode.path,
    fields,
    base,
  };
  return ok({ node, next: cursor + 1 });
}

/**
 * If `tokens[pos]` is `::` immediately followed by `<`, it's a turbofish
 * (`::<...>`). Rejects it with the generics guardrail diagnostic. Otherwise
 * a no-op success, so callers thread it through the same `isErr` check they
 * use for every other parse step.
 */
function checkTurbofish(tokens: readonly Token[], pos: number): PR<boolean> {
  const pathSepMatch = pathSepBeforeLt(tokens, pos);
  if (isSome(pathSepMatch)) {
    const message = isLifetimeGenericsStart(tokens, pos + 1)
      ? unsupportedLifetimeMessage("lifetime arguments (`::<...>`)")
      : unsupportedGenericsMessage("turbofish generic arguments (`::<...>`)");
    return err({
      severity: "error",
      message,
      span: some(pathSepMatch.value.span),
    });
  }
  return ok(true);
}

/**
 * Parses a primary expression.
 *
 * Supported slice-1 forms:
 *
 * - String / integer / float / bool / char literals
 * - Path expressions
 * - Reference expressions
 *
 * Grammar:
 *
 * ```text
 * PrimaryExpression ::=
 *     StringLiteral
 *   | IntLiteral
 *   | FloatLiteral
 *   | BoolLiteral
 *   | CharLiteral
 *   | PathExpression
 *   | ReferenceExpression
 * ```
 */
// eslint-disable-next-line complexity -- dispatch function; more readable this way
function parsePrimary(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  allowStruct: boolean,
): PR<Parsed<Expression>> {
  const tokenResult = tokenAt(tokens, pos);
  if (isErr(tokenResult)) return tokenResult;
  const token = tokenResult.value;

  if (token.kind === "string")
    return ok({
      node: { kind: "StringLiteral", tokenId: pos, value: token.text },
      next: pos + 1,
    });
  if (token.kind === "int") return ok(parseIntLiteral(pos, token));
  if (token.kind === "float") return ok(parseFloatLiteral(pos, token));
  if (token.kind === "char")
    return ok({
      node: {
        kind: "CharLiteral",
        tokenId: pos,
        value: resolveEscape(token.text),
      },
      next: pos + 1,
    });
  if (
    token.kind === "keyword" &&
    (token.text === "true" || token.text === "false")
  )
    return ok({
      node: { kind: "BoolLiteral", tokenId: pos, value: token.text === "true" },
      next: pos + 1,
    });

  // `if` expression
  if (token.kind === "keyword" && token.text === "if") {
    return parseIfExpression(tokens, diagnostics, pos);
  }

  const loopKeyword = loopKeywordAt(tokens, pos);
  if (isSome(loopKeyword)) {
    return err({
      severity: "error",
      message: unsupportedLoopMessage(loopKeyword.value.token.text),
      span: some(loopKeyword.value.token.span),
    });
  }

  // Block expression
  if (token.kind === "lbrace") {
    return parseBlock(tokens, diagnostics, pos);
  }

  // Path, or path followed by `{` (struct expression when allowed)
  if (token.kind === "ident" || token.kind === "path_sep") {
    const pathResult = parsePath(tokens, pos);
    if (isErr(pathResult)) return pathResult;
    const afterPath = pathResult.value.next;
    const turbofishResult = checkTurbofish(tokens, afterPath);
    if (isErr(turbofishResult)) {
      return turbofishResult;
    }
    if (allowStruct && tokens[pathResult.value.next]?.kind === "lbrace") {
      return parseStructExpression(
        tokens,
        diagnostics,
        pathResult.value.next,
        pathResult.value.node,
      );
    }
    return ok(pathResult.value);
  }

  if (token.kind === "amp")
    return parseReference(tokens, diagnostics, pos, allowStruct);

  // Prefix unary: - and !
  if (token.kind === "minus") {
    const operandResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      pos + 1,
      24,
      allowStruct,
    );
    if (isErr(operandResult)) return operandResult;
    const unary: UnaryExpression = {
      kind: "UnaryExpression",
      tokenId: pos,
      operator: "Neg",
      operand: operandResult.value.node,
    };
    return ok({ node: unary, next: operandResult.value.next });
  }
  if (token.kind === "bang") {
    const operandResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      pos + 1,
      24,
      allowStruct,
    );
    if (isErr(operandResult)) return operandResult;
    const unary: UnaryExpression = {
      kind: "UnaryExpression",
      tokenId: pos,
      operator: "Not",
      operand: operandResult.value.node,
    };
    return ok({ node: unary, next: operandResult.value.next });
  }

  // Tuple, grouping, or unit
  if (token.kind === "lparen") {
    return parseTupleOrGroup(tokens, diagnostics, pos);
  }

  // Guardrail: * in prefix position is dereference, not yet supported
  if (token.kind === "star")
    return err({
      severity: "error",
      message: "dereference (*) is not supported in Slice 1",
      span: some(token.span),
    });

  return err({
    severity: "error",
    message: `Expected an expression, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
  });
}

/**
 * Parses a parenthesized argument list.
 *
 * Grammar:
 *
 * ```text
 * Arguments ::= "(" (Expression ("," Expression)*)? ")"
 * ```
 */
function parseArguments(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Expression[]>> {
  const afterLparen = expect(tokens, pos, "lparen");
  if (isErr(afterLparen)) return afterLparen;
  let cursor = afterLparen.value;
  const args: Expression[] = [];
  for (;;) {
    if (tokens[cursor]?.kind === "rparen") break;
    const cur = tokens[cursor];
    if (cur === undefined || cur.kind === "eof") {
      return err({
        severity: "error",
        message: "Expected ')' to close argument list",
        span: none(),
      });
    }
    // Arguments are always in struct-ok position (they're inside parens)
    const argResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      cursor,
      0,
      true,
    );
    if (isErr(argResult)) return argResult;
    args.push(argResult.value.node);
    cursor = argResult.value.next;
    if (tokens[cursor]?.kind !== "comma") break;
    cursor += 1;
  }
  const afterRparen = expect(tokens, cursor, "rparen");
  if (isErr(afterRparen)) return afterRparen;
  return ok({ node: args, next: afterRparen.value });
}

function parseInfixCall(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
): PR<Parsed<Expression>> {
  const argsResult = parseArguments(tokens, diagnostics, opPos);
  if (isErr(argsResult)) return argsResult;
  return ok({
    node: {
      kind: "CallExpression",
      tokenId: lhs.node.tokenId,
      callee: lhs.node,
      arguments: argsResult.value.node,
    },
    next: argsResult.value.next,
  });
}

/**
 * Handles `.field` and `.method(args)`.
 *
 * When `(` immediately follows the field name, produces `MethodCallExpression`
 * (preserving the `this` receiver for correct JS codegen). Otherwise produces
 * `FieldAccessExpression`.
 */
function parseInfixField(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
): PR<Parsed<Expression>> {
  const fieldResult = parseIdentifier(tokens, opPos + 1);
  if (isErr(fieldResult)) return fieldResult;
  const afterIdent = fieldResult.value.next;

  const turbofishResult = checkTurbofish(tokens, afterIdent);
  if (isErr(turbofishResult)) {
    return turbofishResult;
  }

  if (tokens[afterIdent]?.kind === "lparen") {
    const argsResult = parseArguments(tokens, diagnostics, afterIdent);
    if (isErr(argsResult)) return argsResult;
    const node: MethodCallExpression = {
      kind: "MethodCallExpression",
      tokenId: lhs.node.tokenId,
      receiver: lhs.node,
      method: fieldResult.value.node,
      arguments: argsResult.value.node,
    };
    return ok({ node, next: argsResult.value.next });
  }

  return ok({
    node: {
      kind: "FieldAccessExpression",
      tokenId: lhs.node.tokenId,
      object: lhs.node,
      field: fieldResult.value.node,
    },
    next: afterIdent,
  });
}

function parseInfixIndex(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
): PR<Parsed<Expression>> {
  let cursor = opPos + 1; // skip `[`

  const tok = tokens[cursor];
  if (tok === undefined || tok.kind === "eof" || tok.kind === "rbracket") {
    return err({
      severity: "error",
      message: `Expected an expression inside '[...]'`,
      span: tok !== undefined && tok.kind !== "eof" ? some(tok.span) : none(),
    });
  }

  // Index expressions are always in struct-ok position
  const indexResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    0,
    true,
  );
  if (isErr(indexResult)) return indexResult;
  cursor = indexResult.value.next;

  const closeResult = expect(tokens, cursor, "rbracket");
  if (isErr(closeResult)) return closeResult;

  const node: IndexExpression = {
    kind: "IndexExpression",
    tokenId: lhs.node.tokenId,
    object: lhs.node,
    index: indexResult.value.node,
  };
  return ok({ node, next: closeResult.value });
}

function parseInfixBinary(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: Extract<InfixEntry, { kind: "binary" }>,
  allowStruct: boolean,
): PR<Parsed<Expression>> {
  const rhsResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    opPos + 1,
    infix.rightBp,
    allowStruct,
  );
  if (isErr(rhsResult)) return rhsResult;
  const node: BinaryExpression = {
    kind: "BinaryExpression",
    tokenId: opPos,
    operator: infix.operator,
    left: lhs.node,
    right: rhsResult.value.node,
  };
  const result: Parsed<Expression> = { node, next: rhsResult.value.next };
  if (infix.nonAssoc) {
    const peek = tokens[result.next];
    if (peek !== undefined) {
      const nextInfix = infixOp(peek);
      if (
        nextInfix !== null &&
        nextInfix.kind === "binary" &&
        nextInfix.nonAssoc &&
        nextInfix.leftBp === infix.leftBp
      ) {
        return err({
          severity: "error",
          message: `cannot chain '${infix.sigil}' with '${nextInfix.sigil}'`,
          span: some(peek.span),
        });
      }
    }
  }
  return ok(result);
}

function parseInfixAssign(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: Extract<InfixEntry, { kind: "assign" }>,
  allowStruct: boolean,
): PR<Parsed<Expression>> {
  const rhsResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    opPos + 1,
    infix.rightBp,
    allowStruct,
  );
  if (isErr(rhsResult)) return rhsResult;
  return ok({
    node: {
      kind: "AssignExpression",
      tokenId: opPos,
      lhs: lhs.node,
      rhs: rhsResult.value.node,
    },
    next: rhsResult.value.next,
  });
}

function parseInfixCompoundAssign(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: Extract<InfixEntry, { kind: "compound-assign" }>,
  allowStruct: boolean,
): PR<Parsed<Expression>> {
  const rhsResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    opPos + 1,
    infix.rightBp,
    allowStruct,
  );
  if (isErr(rhsResult)) return rhsResult;
  return ok({
    node: {
      kind: "CompoundAssignExpression",
      tokenId: opPos,
      operator: infix.operator,
      lhs: lhs.node,
      rhs: rhsResult.value.node,
    },
    next: rhsResult.value.next,
  });
}

/**
 * Parses an expression from a sequence of tokens starting at `pos`.
 */
export function parseExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Expression>> {
  return parseExpressionWithBindingPower(tokens, diagnostics, pos, 0, true);
}

/**
 * Parses an expression from a sequence of tokens starting at `pos` with the
 * given minimum binding power. Internal recursive entry point for the Pratt loop.
 *
 * @param tokens The sequence of tokens to parse.
 * @param diagnostics The diagnostic warnings and errors array.
 * @param pos The current position in the token sequence to start parsing.
 * @param minBp The minimum binding power; operators with leftBp ≤ minBp are not consumed.
 * @param allowStruct Whether structs are allowed in this space.
 *
 * @return The result of parsing, which includes either the parsed expression or an error.
 */
// eslint-disable-next-line complexity -- dispatch function; more readable this way
function parseExpressionWithBindingPower(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  minBp: number,
  allowStruct: boolean,
): PR<Parsed<Expression>> {
  const primaryResult = parsePrimary(tokens, diagnostics, pos, allowStruct);
  if (isErr(primaryResult)) return primaryResult;
  let result = primaryResult.value;

  for (;;) {
    const nextToken = tokens[result.next];
    if (nextToken === undefined || nextToken.kind === "eof") break;
    const infix = infixOp(nextToken);
    if (infix === null) break;
    if (infix.leftBp <= minBp) break;

    const opPos = result.next;
    let stepResult: PR<Parsed<Expression>>;

    switch (infix.kind) {
      case "postfix-call":
        stepResult = parseInfixCall(tokens, diagnostics, result, opPos);
        break;
      case "postfix-field":
        stepResult = parseInfixField(tokens, diagnostics, result, opPos);
        break;
      case "postfix-index":
        stepResult = parseInfixIndex(tokens, diagnostics, result, opPos);
        break;
      case "binary":
        stepResult = parseInfixBinary(
          tokens,
          diagnostics,
          result,
          opPos,
          infix,
          allowStruct,
        );
        break;
      case "assign":
        stepResult = parseInfixAssign(
          tokens,
          diagnostics,
          result,
          opPos,
          infix,
          allowStruct,
        );
        break;
      case "compound-assign":
        stepResult = parseInfixCompoundAssign(
          tokens,
          diagnostics,
          result,
          opPos,
          infix,
          allowStruct,
        );
        break;
      default:
        assertNever(
          infix,
          `Unhandled InfixEntry kind: ${JSON.stringify(infix)}`,
        );
    }

    if (isErr(stepResult)) return stepResult;
    result = stepResult.value;
  }

  return ok(result);
}
