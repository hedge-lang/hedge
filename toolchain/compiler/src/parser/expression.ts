import { assert, assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import { resolveEscape } from "../lexer/escape.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  ArrayExpression,
  ArrayRepeatExpression,
  BinaryExpression,
  BinaryOperator,
  CompoundAssignOperator,
  DereferenceExpression,
  Expression,
  FieldInit,
  IfExpression,
  IndexExpression,
  LetExpression,
  MatchArm,
  MatchExpression,
  MethodCallExpression,
  PathExpression,
  RangeExpression,
  ReferenceExpression,
  StructExpression,
  TupleExpression,
  Type,
  UnaryExpression,
  WhileExpression,
} from "./ast.js";
import type { Parsed } from "./parse.js";
import {
  expect,
  isWhileLetAt,
  loopKeywordAt,
  parseFloatLiteral,
  parseIdentifier,
  parseIntLiteral,
  pathKeywordAt,
  pathSepBeforeLt,
  tokenAt,
  unsupportedLoopMessage,
  type PR,
} from "./parse-utils.js";
import { parsePath } from "./path.js";
import { parsePattern } from "./pattern.js";
import { parseBlock } from "./statement.js";
import { parseType } from "./type.js";

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
  | { readonly kind: "postfix-index"; readonly leftBp: number }
  | {
      readonly kind: "range";
      readonly inclusive: boolean;
      readonly leftBp: number;
      readonly rightBp: number;
      readonly nonAssoc: boolean;
      readonly sigil: string;
    };

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
    // Prec 12: range (bp 4, non-associative)
    case "dot_dot":
      return {
        kind: "range",
        inclusive: false,
        leftBp: 4,
        rightBp: 5,
        nonAssoc: true,
        sigil: "..",
      };
    case "dot_dot_eq":
      return {
        kind: "range",
        inclusive: true,
        leftBp: 4,
        rightBp: 5,
        nonAssoc: true,
        sigil: "..=",
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
      code: none(),
      relatedSpans: [],
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

/** Parses `[]` (empty), `[a, b, ...]` (list form), or `[value; count]` (repeat form). */
// eslint-disable-next-line complexity
function parseArrayLiteral(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Expression>> {
  const start = pos;
  let cursor = pos + 1; // skip `[`

  // Empty list: []
  if (tokens[cursor]?.kind === "rbracket") {
    const array: ArrayExpression = {
      kind: "ArrayExpression",
      tokenId: start,
      elements: [],
    };
    return ok({ node: array, next: cursor + 1 });
  }

  const firstResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    0,
    true,
  );
  if (isErr(firstResult)) return firstResult;
  cursor = firstResult.value.next;

  // Repeat form: [value; count]
  if (tokens[cursor]?.kind === "semi") {
    cursor += 1; // skip `;`
    const countResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      cursor,
      0,
      true,
    );
    if (isErr(countResult)) return countResult;
    const closeResult = expect(tokens, countResult.value.next, "rbracket");
    if (isErr(closeResult)) return closeResult;
    const repeat: ArrayRepeatExpression = {
      kind: "ArrayRepeatExpression",
      tokenId: start,
      value: firstResult.value.node,
      count: countResult.value.node,
    };
    return ok({ node: repeat, next: closeResult.value });
  }

  if (tokens[cursor]?.kind !== "comma" && tokens[cursor]?.kind !== "rbracket") {
    const tok = tokens[cursor];
    return err({
      severity: "error",
      message: `Expected ',', ';', or ']' after expression in array literal`,
      span: tok !== undefined ? some(tok.span) : none(),
      code: none(),
      relatedSpans: [],
    });
  }

  // Collect remaining list elements
  const elements: Expression[] = [firstResult.value.node];
  while (tokens[cursor]?.kind === "comma") {
    cursor += 1; // skip comma
    if (tokens[cursor]?.kind === "rbracket") break; // trailing comma
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

  const closeResult = expect(tokens, cursor, "rbracket");
  if (isErr(closeResult)) return closeResult;

  const array: ArrayExpression = {
    kind: "ArrayExpression",
    tokenId: start,
    elements,
  };
  return ok({ node: array, next: closeResult.value });
}

/**
 * Parses an `if`/`while` condition: either `"let" Pattern "=" Expression`
 * (a `LetExpression`) or an ordinary `ExpressionNoStruct`: `{` always
 * starts the following block, never a struct literal, so struct literals
 * are disallowed here exactly as in general condition position today.
 */
function parseCondition(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Expression>> {
  const token = tokens[pos];
  if (token?.kind === "keyword" && token.text === "let") {
    const letStart = pos;
    const patternResult = parsePattern(tokens, pos + 1);
    if (isErr(patternResult)) return patternResult;

    const eqResult = expect(tokens, patternResult.value.next, "eq");
    if (isErr(eqResult)) return eqResult;

    const scrutineeResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      eqResult.value,
      0,
      false,
    );
    if (isErr(scrutineeResult)) return scrutineeResult;

    const node: LetExpression = {
      kind: "LetExpression",
      tokenId: letStart,
      pattern: patternResult.value.node,
      scrutinee: scrutineeResult.value.node,
    };
    return ok({ node, next: scrutineeResult.value.next });
  }
  return parseExpressionWithBindingPower(tokens, diagnostics, pos, 0, false);
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

  const condResult = parseCondition(tokens, diagnostics, afterIf);
  if (isErr(condResult)) return condResult;

  const thenTok = tokens[condResult.value.next];
  if (thenTok === undefined || thenTok.kind !== "lbrace") {
    return err({
      severity: "error",
      message: `Expected '{' to start if body`,
      span: thenTok !== undefined ? some(thenTok.span) : none(),
      code: none(),
      relatedSpans: [],
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
        code: none(),
        relatedSpans: [],
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

/**
 * True for an expression that ends in its own closing `}` (a block, or a
 * construct whose body is one): a comma is optional after such an arm's
 * body, mirroring `statement.ts`'s "ExpressionWithBlock doesn't need a
 * semicolon" rule for the same reason: no risk of the following token being
 * absorbed as a continuation.
 */
function isBlockLikeExpression(expr: Expression): boolean {
  return (
    expr.kind === "Block" ||
    expr.kind === "IfExpression" ||
    expr.kind === "MatchExpression" ||
    expr.kind === "WhileExpression"
  );
}

/**
 * Parses `"while" "let" Pattern "=" Expression Block`: the only supported
 * `while` form.
 */
function parseWhileExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<WhileExpression>> {
  const start = pos;
  const afterWhile = pos + 1;

  const condResult = parseCondition(tokens, diagnostics, afterWhile);
  if (isErr(condResult)) return condResult;

  const bodyTok = tokens[condResult.value.next];
  if (bodyTok === undefined || bodyTok.kind !== "lbrace") {
    return err({
      severity: "error",
      message: `Expected '{' to start while body`,
      span: bodyTok !== undefined ? some(bodyTok.span) : none(),
      code: none(),
      relatedSpans: [],
    });
  }
  const bodyResult = parseBlock(tokens, diagnostics, condResult.value.next);
  if (isErr(bodyResult)) return bodyResult;

  const node: WhileExpression = {
    kind: "WhileExpression",
    tokenId: start,
    condition: condResult.value.node,
    body: bodyResult.value.node,
  };
  return ok({ node, next: bodyResult.value.next });
}

/** Parses one `Pattern ("if" Expression)? "=>" Expression` match arm. */
function parseMatchArm(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<MatchArm>> {
  const start = pos;
  const patternResult = parsePattern(tokens, pos);
  if (isErr(patternResult)) return patternResult;
  let cursor = patternResult.value.next;

  let guard: MatchArm["guard"] = none();
  const guardTok = tokens[cursor];
  if (guardTok?.kind === "keyword" && guardTok.text === "if") {
    const guardResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      cursor + 1,
      0,
      true,
    );
    if (isErr(guardResult)) return guardResult;
    guard = some(guardResult.value.node);
    cursor = guardResult.value.next;
  }

  const arrowTok = tokens[cursor];
  if (arrowTok === undefined || arrowTok.kind !== "fat_arrow") {
    return err({
      severity: "error",
      message: `Expected '=>' in match arm`,
      span: arrowTok !== undefined ? some(arrowTok.span) : none(),
      code: none(),
      relatedSpans: [],
    });
  }
  cursor += 1;

  const bodyResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    0,
    true,
  );
  if (isErr(bodyResult)) return bodyResult;

  const arm: MatchArm = {
    kind: "MatchArm",
    tokenId: start,
    pattern: patternResult.value.node,
    guard,
    body: bodyResult.value.node,
  };
  return ok({ node: arm, next: bodyResult.value.next });
}

/** Parses `"match" Expression "{" ( MatchArm ","? )* "}"`. */
// eslint-disable-next-line complexity -- Arm-list loop with the block-like-body comma exemption; splitting would obscure the grammar rule.
function parseMatchExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<MatchExpression>> {
  const start = pos;
  const afterMatch = pos + 1;

  // Scrutinee is ExpressionNoStruct, for the same reason as an if/while
  // condition: `{` always starts the arm list, never a struct literal.
  const scrutineeResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    afterMatch,
    0,
    false,
  );
  if (isErr(scrutineeResult)) return scrutineeResult;

  const openBrace = expect(tokens, scrutineeResult.value.next, "lbrace");
  if (isErr(openBrace)) return openBrace;
  let cursor = openBrace.value;

  const arms: MatchArm[] = [];
  while (tokens[cursor]?.kind !== "rbrace") {
    const tok = tokens[cursor];
    if (tok === undefined || tok.kind === "eof") {
      return err({
        severity: "error",
        message: "Expected '}' to close match expression, found end of input",
        span: none(),
        code: none(),
        relatedSpans: [],
      });
    }

    const armResult = parseMatchArm(tokens, diagnostics, cursor);
    if (isErr(armResult)) return armResult;
    arms.push(armResult.value.node);
    cursor = armResult.value.next;

    if (tokens[cursor]?.kind === "comma") {
      cursor += 1;
      continue;
    }
    if (tokens[cursor]?.kind === "rbrace") {
      break;
    }
    if (isBlockLikeExpression(armResult.value.node.body)) {
      continue;
    }
    const nextTok = tokens[cursor];
    if (nextTok === undefined || nextTok.kind === "eof") {
      return err({
        severity: "error",
        message: "Expected '}' to close match expression, found end of input",
        span: none(),
        code: none(),
        relatedSpans: [],
      });
    }
    return err({
      severity: "error",
      message: `Expected ',' between match arms`,
      span: some(nextTok.span),
      code: none(),
      relatedSpans: [],
    });
  }

  const node: MatchExpression = {
    kind: "MatchExpression",
    tokenId: start,
    scrutinee: scrutineeResult.value.node,
    arms,
  };
  return ok({ node, next: cursor + 1 });
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
        code: none(),
        relatedSpans: [],
      });
      if (tokens[cursor]?.kind === "comma") cursor += 1; // trailing comma after spread
      if (tokens[cursor]?.kind !== "rbrace") {
        const tok = tokens[cursor];
        return err({
          severity: "error",
          message: `Expected '}' after struct update expression — spread must be last`,
          span: tok !== undefined ? some(tok.span) : none(),
          code: none(),
          relatedSpans: [],
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
      code: none(),
      relatedSpans: [],
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
 * Parses turbofish type arguments (`::<Type, Type, ...>`) if `tokens[pos]`
 * is `::` followed by `<`. Empty list, `next` unchanged, otherwise - a bare
 * `<` in expression position is always the comparison operator, never a
 * generic-argument list.
 *
 * No `>>`-splitting needed: a generic turbofish argument (`first::<Vec<i32>>`)
 * hits the Type-position guardrail before any closing `>>` is reached, so
 * this only ever closes on a single, un-nested `>`.
 *
 * Grammar:
 *
 * ```text
 * GenericArgs ::= "::" "<" (Type ("," Type)* ","?)? ">"
 * ```
 */
function parseTurbofishTypeArguments(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<readonly Type[]>> {
  const pathSepMatch = pathSepBeforeLt(tokens, pos);
  if (!isSome(pathSepMatch)) {
    return ok({ node: [], next: pos });
  }
  let cursor = pos + 2; // skip `::` and `<`
  if (tokens[cursor]?.kind === "gt") {
    return ok({ node: [], next: cursor + 1 });
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
      if (tokens[cursor]?.kind === "gt") {
        return ok({ node: typeArguments, next: cursor + 1 });
      }
      continue;
    }
    break;
  }
  const closeResult = expect(tokens, cursor, "gt");
  if (isErr(closeResult)) {
    return closeResult;
  }
  return ok({ node: typeArguments, next: closeResult.value });
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

  // `while let` expression: the only supported `while` form; a bare
  // (non-`let`) or label-prefixed `while` falls through to the guardrail below.
  if (isWhileLetAt(tokens, pos)) {
    return parseWhileExpression(tokens, diagnostics, pos);
  }

  const loopKeyword = loopKeywordAt(tokens, pos);
  if (isSome(loopKeyword)) {
    return err({
      severity: "error",
      message: unsupportedLoopMessage(loopKeyword.value.token.text),
      span: some(loopKeyword.value.token.span),
      code: none(),
      relatedSpans: [],
    });
  }

  // `match` expression
  if (token.kind === "keyword" && token.text === "match") {
    return parseMatchExpression(tokens, diagnostics, pos);
  }

  // Block expression
  if (token.kind === "lbrace") {
    return parseBlock(tokens, diagnostics, pos);
  }

  // Path, or path followed by `{` (struct expression when allowed)
  if (
    token.kind === "ident" ||
    token.kind === "path_sep" ||
    isSome(pathKeywordAt(tokens, pos))
  ) {
    const pathResult = parsePath(tokens, pos);
    if (isErr(pathResult)) return pathResult;
    const afterPath = pathResult.value.next;
    const turbofishResult = parseTurbofishTypeArguments(tokens, afterPath);
    if (isErr(turbofishResult)) {
      return turbofishResult;
    }
    const pathNode: PathExpression = {
      ...pathResult.value.node,
      typeArguments: turbofishResult.value.node,
    };
    const afterTurbofish = turbofishResult.value.next;
    if (allowStruct && tokens[afterTurbofish]?.kind === "lbrace") {
      return parseStructExpression(
        tokens,
        diagnostics,
        afterTurbofish,
        pathNode,
      );
    }
    return ok({ node: pathNode, next: afterTurbofish });
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

  // Array literal: list form [a, b, c] or repeat form [value; count]
  if (token.kind === "lbracket") {
    return parseArrayLiteral(tokens, diagnostics, pos);
  }

  // Prefix range: ..b, ..=b, or bare .. (RangeTo / RangeToInclusive / RangeFull)
  if (token.kind === "dot_dot" || token.kind === "dot_dot_eq") {
    return parseRangeTail(
      tokens,
      diagnostics,
      pos,
      token.kind === "dot_dot_eq",
      none(),
      allowStruct,
    );
  }

  if (token.kind === "star") {
    const operandResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      pos + 1,
      24,
      allowStruct,
    );
    if (isErr(operandResult)) return operandResult;
    const deref: DereferenceExpression = {
      kind: "DereferenceExpression",
      tokenId: pos,
      operand: operandResult.value.node,
    };
    return ok({ node: deref, next: operandResult.value.next });
  }

  return err({
    severity: "error",
    message: `Expected an expression, found "${token.kind}" at offset ${token.span.start}`,
    span: some(token.span),
    code: none(),
    relatedSpans: [],
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
        code: none(),
        relatedSpans: [],
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

  const turbofishResult = parseTurbofishTypeArguments(tokens, afterIdent);
  if (isErr(turbofishResult)) {
    return turbofishResult;
  }
  const typeArguments = turbofishResult.value.node;
  const afterTurbofish = turbofishResult.value.next;
  const hadTurbofish = afterTurbofish !== afterIdent;

  if (tokens[afterTurbofish]?.kind === "lparen") {
    const argsResult = parseArguments(tokens, diagnostics, afterTurbofish);
    if (isErr(argsResult)) return argsResult;
    const node: MethodCallExpression = {
      kind: "MethodCallExpression",
      tokenId: lhs.node.tokenId,
      receiver: lhs.node,
      method: fieldResult.value.node,
      typeArguments,
      arguments: argsResult.value.node,
    };
    return ok({ node, next: argsResult.value.next });
  }

  // GenericArgs only appears within MethodCall, always followed by parens -
  // FieldAccess has no GenericArgs slot, so a turbofish with no call isn't
  // valid anywhere.
  if (hadTurbofish) {
    const badToken = tokens[afterTurbofish];
    return err({
      severity: "error",
      message: `expected '(' after generic arguments in method position, found "${badToken?.kind ?? "end of input"}"`,
      span: badToken !== undefined ? some(badToken.span) : none(),
      code: none(),
      relatedSpans: [],
    });
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
      code: none(),
      relatedSpans: [],
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
          code: none(),
          relatedSpans: [],
        });
      }
    }
  }
  return ok(result);
}

/**
 * Tokens that end a range's end-operand slot rather than starting one, used
 * to decide whether `a..`/`..b`/`..` left an operand out (as opposed to the
 * parser attempting to consume a following construct as the range's end).
 */
const RANGE_END_TERMINATORS: ReadonlySet<Token["kind"]> = new Set([
  "eof",
  "semi",
  "comma",
  "rparen",
  "rbracket",
  "rbrace",
  "dot_dot",
  "dot_dot_eq",
]);

/**
 * `lbrace` is only a terminator when `allowStruct` is false: every other
 * infix operator has a mandatory RHS, so this ambiguity has never come up
 * before. The only `allowStruct: false` context in the parser is
 * `parseIfExpression`'s own condition parse, where `{` must always start the
 * if-body, not the range's end (`if a.. { foo(); }`). Everywhere else
 * `allowStruct` is true and there is no competing construct for a following
 * `{` to belong to, so `a..{ compute() }` as a plain let-initializer parses
 * the block as the range's end rather than being rejected.
 */
function isRangeEndTerminator(
  token: Token | undefined,
  allowStruct: boolean,
): boolean {
  if (token === undefined) return true;
  if (token.kind === "lbrace") return !allowStruct;
  return RANGE_END_TERMINATORS.has(token.kind);
}

/**
 * Parses the `..`/`..=` tail of a range expression (the tokens after the
 * operator), given an already-parsed `start` operand (`none()` for the
 * prefix forms `..b`, `..=b`, bare `..`). Shared by both the infix
 * continuation and `parsePrimary`'s prefix dispatch so the omissible-end
 * logic and non-associative chain rejection are written once.
 */
function parseRangeTail(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  dotDotPos: number,
  inclusive: boolean,
  start: Option<Expression>,
  allowStruct: boolean,
): PR<Parsed<RangeExpression>> {
  const cursor = dotDotPos + 1;
  const afterOp = tokens[cursor];

  let end: Option<Expression>;
  let next: number;

  if (isRangeEndTerminator(afterOp, allowStruct)) {
    if (inclusive) {
      return err({
        severity: "error",
        message: "Expected an expression after '..='",
        span:
          afterOp !== undefined && afterOp.kind !== "eof"
            ? some(afterOp.span)
            : none(),
        code: none(),
        relatedSpans: [],
      });
    }
    end = none();
    next = cursor;
  } else {
    const endResult = parseExpressionWithBindingPower(
      tokens,
      diagnostics,
      cursor,
      5,
      allowStruct,
    );
    if (isErr(endResult)) return endResult;
    end = some(endResult.value.node);
    next = endResult.value.next;
  }

  const node: RangeExpression = {
    kind: "RangeExpression",
    tokenId: dotDotPos,
    start,
    end,
    inclusive,
  };
  const result: Parsed<RangeExpression> = { node, next };

  const peek = tokens[next];
  if (peek !== undefined) {
    const nextInfix = infixOp(peek);
    if (nextInfix !== null && nextInfix.kind === "range") {
      const sigil = inclusive ? "..=" : "..";
      return err({
        severity: "error",
        message: `cannot chain '${sigil}' with '${nextInfix.sigil}'`,
        span: some(peek.span),
        code: none(),
        relatedSpans: [],
      });
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
      case "range":
        stepResult = parseRangeTail(
          tokens,
          diagnostics,
          opPos,
          infix.inclusive,
          some(result.node),
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
