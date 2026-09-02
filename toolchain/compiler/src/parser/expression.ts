import { assert, assertNever } from "../assert.js";
import {
  type Diagnostic,
  errorDiagnosticRaw,
  warningDiagnosticRaw,
} from "../diagnostics/index.js";
import { resolveEscape } from "../lexer/escape.js";
import type { Token, TokenKind } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { err, isErr, ok } from "../result.js";
import type {
  ArrayExpression,
  ArrayRepeatExpression,
  BinaryExpression,
  BinaryOperator,
  Block,
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
import { parseTypeArgumentList } from "./type.js";

interface BinaryInfixEntry {
  readonly kind: "binary";
  readonly operator: BinaryOperator;
  readonly leftBp: number;
  readonly rightBp: number;
  readonly nonAssoc: boolean;
  readonly sigil: string;
}

interface AssignInfixEntry {
  readonly kind: "assign";
  readonly leftBp: number;
  readonly rightBp: number;
  readonly nonAssoc: boolean;
  readonly sigil: string;
}

interface CompoundAssignInfixEntry {
  readonly kind: "compound-assign";
  readonly operator: CompoundAssignOperator;
  readonly leftBp: number;
  readonly rightBp: number;
  readonly nonAssoc: boolean;
  readonly sigil: string;
}

type InfixEntry =
  | BinaryInfixEntry
  | AssignInfixEntry
  | CompoundAssignInfixEntry
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
    // Prec 1 - postfix (bp 26, left-to-right)
    case "lparen":
      return { kind: "postfix-call", leftBp: 26 };
    case "dot":
      return { kind: "postfix-field", leftBp: 26 };
    case "lbracket":
      return { kind: "postfix-index", leftBp: 26 };
    // Prec 3 - multiplicative (bp 22, left-assoc)
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
    // Prec 4 - additive (bp 20, left-assoc)
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
    // Prec 5 - bitshift (bp 18, left-assoc)
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
    // Prec 6 - bit-and (bp 16, left-assoc); infix position only - prefix & is ReferenceExpression
    case "amp":
      return {
        kind: "binary",
        operator: "BitAnd",
        leftBp: 16,
        rightBp: 17,
        nonAssoc: false,
        sigil: "&",
      };
    // Prec 7 - bit-xor (bp 14, left-assoc)
    case "caret":
      return {
        kind: "binary",
        operator: "BitXor",
        leftBp: 14,
        rightBp: 15,
        nonAssoc: false,
        sigil: "^",
      };
    // Prec 8 - bit-or (bp 12, left-assoc)
    case "pipe":
      return {
        kind: "binary",
        operator: "BitOr",
        leftBp: 12,
        rightBp: 13,
        nonAssoc: false,
        sigil: "|",
      };
    // Prec 9 - comparison (bp 10, non-associative)
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
    // Prec 10 - logical-and (bp 8, left-assoc)
    case "amp_amp":
      return {
        kind: "binary",
        operator: "And",
        leftBp: 8,
        rightBp: 9,
        nonAssoc: false,
        sigil: "&&",
      };
    // Prec 11 - logical-or (bp 6, left-assoc)
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
    // Prec 13 - assignment (bp 2, right-assoc: rightBp < leftBp)
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
    case "ident":
    case "char":
    case "string":
    case "lifetime":
    case "error":
    case "eof":
    case "rparen":
    case "lbrace":
    case "rbrace":
    case "rbracket":
    case "comma":
    case "semi":
    case "colon":
    case "hash":
    case "at":
    case "question":
    case "bang":
    case "arrow":
    case "fat_arrow":
    case "keyword":
    case "int":
    case "float":
    case "path_sep":
      // Never appears in infix position.
      return null;
    default:
      return assertNever(token, `Unexpected token: ${JSON.stringify(token)}`);
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
  // the operand rather than the surrounding expression: &a.b => &(a.b), &f() => &(f())
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

  // No comma -> transparent grouping (passes allowStruct through; no new node)
  if (tokens[cursor]?.kind === "rparen") {
    return ok({ node: firstResult.value.node, next: cursor + 1 });
  }

  if (tokens[cursor]?.kind !== "comma") {
    const tok = tokens[cursor];
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected ',' or ')' after expression in parentheses`,
        tok !== undefined ? some(tok.span) : none(),
      ),
    );
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

/** Parses the `[value; count]` repeat form, `pos` positioned right after the `;`. */
function parseArrayRepeatForm(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  start: number,
  value: Expression,
): PR<Parsed<Expression>> {
  const countResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    pos,
    0,
    true,
  );
  if (isErr(countResult)) return countResult;
  const closeResult = expect(tokens, countResult.value.next, "rbracket");
  if (isErr(closeResult)) return closeResult;
  const repeat: ArrayRepeatExpression = {
    kind: "ArrayRepeatExpression",
    tokenId: start,
    value,
    count: countResult.value.node,
  };
  return ok({ node: repeat, next: closeResult.value });
}

/** Parses the `[a, b, ...]` list form, `pos` positioned right after the first element. */
function parseArrayListForm(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  start: number,
  firstElement: Expression,
): PR<Parsed<Expression>> {
  let cursor = pos;
  if (tokens[cursor]?.kind !== "comma" && tokens[cursor]?.kind !== "rbracket") {
    const tok = tokens[cursor];
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected ',', ';', or ']' after expression in array literal`,
        tok !== undefined ? some(tok.span) : none(),
      ),
    );
  }

  const elements: Expression[] = [firstElement];
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

/** Parses `[]` (empty), `[a, b, ...]` (list form), or `[value; count]` (repeat form). */
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
    return parseArrayRepeatForm(
      tokens,
      diagnostics,
      cursor + 1, // skip `;`
      start,
      firstResult.value.node,
    );
  }

  return parseArrayListForm(
    tokens,
    diagnostics,
    cursor,
    start,
    firstResult.value.node,
  );
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

/**
 * Parses an optional `else (if ... | { ... })` clause starting at `pos` (the
 * token right after the then-block). No `else` at all is `none()`, `pos`
 * unchanged.
 */
function parseElseClause(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Option<IfExpression | Block>>> {
  const elseToken = tokens[pos];
  if (elseToken?.kind !== "keyword" || elseToken.text !== "else") {
    return ok({ node: none(), next: pos });
  }
  const afterElsePos = pos + 1; // skip `else`
  const afterElse = tokens[afterElsePos];
  if (afterElse?.kind === "keyword" && afterElse.text === "if") {
    const elseIfResult = parseIfExpression(tokens, diagnostics, afterElsePos);
    if (isErr(elseIfResult)) return elseIfResult;
    return ok({
      node: some(elseIfResult.value.node),
      next: elseIfResult.value.next,
    });
  }
  if (afterElse?.kind === "lbrace") {
    const elseBlockResult = parseBlock(tokens, diagnostics, afterElsePos);
    if (isErr(elseBlockResult)) return elseBlockResult;
    return ok({
      node: some(elseBlockResult.value.node),
      next: elseBlockResult.value.next,
    });
  }
  return err(
    errorDiagnosticRaw(
      "HEDGE-PARSE-001",
      `Expected 'if' or '{' after 'else'`,
      afterElse !== undefined ? some(afterElse.span) : none(),
    ),
  );
}

/** Parses `if cond { then } (else (if ... | { else }))?`. */
function parseIfExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<IfExpression>> {
  const start = pos;
  // Token at pos is the `if` keyword - advance past it
  const afterIf = pos + 1;

  const condResult = parseCondition(tokens, diagnostics, afterIf);
  if (isErr(condResult)) return condResult;

  const thenTok = tokens[condResult.value.next];
  if (thenTok === undefined || thenTok.kind !== "lbrace") {
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected '{' to start if body`,
        thenTok !== undefined ? some(thenTok.span) : none(),
      ),
    );
  }
  const thenResult = parseBlock(tokens, diagnostics, condResult.value.next);
  if (isErr(thenResult)) return thenResult;

  const elseResult = parseElseClause(
    tokens,
    diagnostics,
    thenResult.value.next,
  );
  if (isErr(elseResult)) return elseResult;

  const node: IfExpression = {
    kind: "IfExpression",
    tokenId: start,
    condition: condResult.value.node,
    thenBranch: thenResult.value.node,
    elseBranch: elseResult.value.node,
  };
  return ok({ node, next: elseResult.value.next });
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
  if (bodyTok?.kind !== "lbrace") {
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected '{' to start while body`,
        bodyTok !== undefined ? some(bodyTok.span) : none(),
      ),
    );
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

  let guard: Option<Expression> = none();
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
  if (arrowTok?.kind !== "fat_arrow") {
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected '=>' in match arm`,
        arrowTok !== undefined ? some(arrowTok.span) : none(),
      ),
    );
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
      return err(
        errorDiagnosticRaw(
          "HEDGE-PARSE-002",
          "Expected '}' to close match expression, found end of input",
          none(),
        ),
      );
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
      return err(
        errorDiagnosticRaw(
          "HEDGE-PARSE-002",
          "Expected '}' to close match expression, found end of input",
          none(),
        ),
      );
    }
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected ',' between match arms`,
        some(nextTok.span),
      ),
    );
  }

  const node: MatchExpression = {
    kind: "MatchExpression",
    tokenId: start,
    scrutinee: scrutineeResult.value.node,
    arms,
  };
  return ok({ node, next: cursor + 1 });
}

/**
 * Parses a struct-update spread `..expr`, `pos` positioned at the `..`.
 * Must be the struct expression's last field - warns (semantic analysis
 * doesn't support it yet) and confirms the closing `}` immediately follows.
 */
function parseStructUpdateSpread(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<Expression>> {
  const spreadTok = tokens[pos];
  assert(spreadTok !== undefined, "Expected spread token to be defined");
  let cursor = pos + 1;
  const baseResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    0,
    true,
  );
  if (isErr(baseResult)) return baseResult;
  cursor = baseResult.value.next;
  diagnostics.push(
    warningDiagnosticRaw(
      "HEDGE-UNSUPPORTED-001",
      "struct update expression (`..base`) is not yet supported in semantic analysis",
      some(spreadTok.span),
    ),
  );
  if (tokens[cursor]?.kind === "comma") cursor += 1; // trailing comma after spread
  if (tokens[cursor]?.kind !== "rbrace") {
    const tok = tokens[cursor];
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected '}' after struct update expression; spread must be last`,
        tok !== undefined ? some(tok.span) : none(),
      ),
    );
  }
  return ok({ node: baseResult.value.node, next: cursor });
}

/** Parses one `Identifier (":" Expression)?` struct field init. */
function parseFieldInit(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): PR<Parsed<FieldInit>> {
  const nameResult = parseIdentifier(tokens, pos);
  if (isErr(nameResult)) return nameResult;
  let cursor = nameResult.value.next;

  let fieldValue: Option<Expression> = none();
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
  return ok({ node: fieldInit, next: cursor });
}

/** Parses `Path "{" FieldInits? (".." Expression)? "}"`. */
// eslint-disable-next-line complexity -- Loop combines spread-vs-field dispatch with comma/close handling
function parseStructExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  pathNode: PathExpression,
): PR<Parsed<StructExpression>> {
  let cursor = pos + 1; // skip `{`

  const fields: FieldInit[] = [];
  let base: Option<Expression> = none();

  while (
    tokens[cursor]?.kind !== "rbrace" &&
    tokens[cursor]?.kind !== "eof" &&
    tokens[cursor] !== undefined
  ) {
    // Struct update spread: `..expr`
    if (tokens[cursor]?.kind === "dot_dot") {
      const spreadResult = parseStructUpdateSpread(tokens, diagnostics, cursor);
      if (isErr(spreadResult)) return spreadResult;
      base = some(spreadResult.value.node);
      cursor = spreadResult.value.next;
      break;
    }

    const fieldResult = parseFieldInit(tokens, diagnostics, cursor);
    if (isErr(fieldResult)) return fieldResult;
    fields.push(fieldResult.value.node);
    cursor = fieldResult.value.next;

    if (tokens[cursor]?.kind === "comma") {
      cursor += 1;
    } else {
      break;
    }
  }

  const closeTok = tokens[cursor];
  if (closeTok?.kind !== "rbrace") {
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected '}' to close struct expression`,
        closeTok !== undefined ? some(closeTok.span) : none(),
      ),
    );
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
 * Delegates the actual `<...>` body to `parseTypeArgumentList`, shared with
 * a trait bound's own arguments and a `NamedType`'s own arguments in type
 * position. Unlike those callers, a turbofish has no enclosing `<...>` list
 * of its own to hand a leftover `pendingCloseHalf` off to - a generic
 * turbofish argument (`first::<Vec<Bar<Baz>>>`) can end exactly on a
 * half-spent `gt_gt`, so any owed half is resolved here by spending it
 * outright rather than propagated further.
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
  const argsResult = parseTypeArgumentList(tokens, pos + 1);
  if (isErr(argsResult)) {
    return argsResult;
  }
  // A turbofish has no enclosing `<...>` list to hand a half-spent `gt_gt`
  // off to, unlike a trait bound or a `NamedType`'s own nested arguments -
  // `pendingCloseHalf` here can only mean a genuine stray extra `>`
  // (`first::<T>>()`), the same class of malformed input
  // `parseDeclarationGenerics`/`parseWherePredicate` (`item.ts`) reject.
  if (argsResult.value.cursor.pendingCloseHalf) {
    const strayToken = tokens[argsResult.value.cursor.next];
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-005",
        "unexpected extra '>' after turbofish type argument list",
        strayToken !== undefined ? some(strayToken.span) : none(),
      ),
    );
  }
  return ok({
    node: argsResult.value.typeArguments,
    next: argsResult.value.cursor.next,
  });
}

/** Parses a path, then a struct expression if a `{` follows and `allowStruct` permits it. */
function parsePathOrStructExpression(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  allowStruct: boolean,
): PR<Parsed<Expression>> {
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
    return parseStructExpression(tokens, diagnostics, afterTurbofish, pathNode);
  }
  return ok({ node: pathNode, next: afterTurbofish });
}

/** Parses a `-`/`!` prefix unary expression, `pos` at the operator token. */
function parsePrefixUnary(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  operator: "Neg" | "Not",
  allowStruct: boolean,
): PR<Parsed<UnaryExpression>> {
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
    operator,
    operand: operandResult.value.node,
  };
  return ok({ node: unary, next: operandResult.value.next });
}

/** Parses a `*` prefix dereference expression, `pos` at the `*` token. */
function parsePrefixDereference(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  allowStruct: boolean,
): PR<Parsed<DereferenceExpression>> {
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
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-004",
        unsupportedLoopMessage(loopKeyword.value.token.text),
        some(loopKeyword.value.token.span),
      ),
    );
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
    return parsePathOrStructExpression(tokens, diagnostics, pos, allowStruct);
  }

  if (token.kind === "amp")
    return parseReference(tokens, diagnostics, pos, allowStruct);

  // Prefix unary: - and !
  if (token.kind === "minus") {
    return parsePrefixUnary(tokens, diagnostics, pos, "Neg", allowStruct);
  }
  if (token.kind === "bang") {
    return parsePrefixUnary(tokens, diagnostics, pos, "Not", allowStruct);
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
    return parsePrefixDereference(tokens, diagnostics, pos, allowStruct);
  }

  return err(
    errorDiagnosticRaw(
      "HEDGE-PARSE-001",
      `Expected an expression, found "${token.kind}" at offset ${token.span.start}`,
      some(token.span),
    ),
  );
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
      return err(
        errorDiagnosticRaw(
          "HEDGE-PARSE-001",
          "Expected ')' to close argument list",
          none(),
        ),
      );
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
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `expected '(' after generic arguments in method position, found "${badToken?.kind ?? "end of input"}"`,
        badToken !== undefined ? some(badToken.span) : none(),
      ),
    );
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
    return err(
      errorDiagnosticRaw(
        "HEDGE-PARSE-001",
        `Expected an expression inside '[...]'`,
        tok !== undefined && tok.kind !== "eof" ? some(tok.span) : none(),
      ),
    );
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
  infix: BinaryInfixEntry,
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
        return err(
          errorDiagnosticRaw(
            "HEDGE-PARSE-003",
            `cannot chain '${infix.sigil}' with '${nextInfix.sigil}'`,
            some(peek.span),
          ),
        );
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
const RANGE_END_TERMINATORS: ReadonlySet<TokenKind> = new Set([
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
 * Determines a range's `end`: `none()` for the omissible-end forms (`a..`,
 * bare `..`), or the parsed expression otherwise. `..=` has no open-ended
 * form, so an omitted end there is a real error, not `none()`.
 */
function parseRangeEnd(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  cursor: number,
  inclusive: boolean,
  allowStruct: boolean,
): PR<Parsed<Option<Expression>>> {
  const afterOp = tokens[cursor];

  if (isRangeEndTerminator(afterOp, allowStruct)) {
    if (inclusive) {
      return err(
        errorDiagnosticRaw(
          "HEDGE-PARSE-001",
          "Expected an expression after '..='",
          afterOp !== undefined && afterOp.kind !== "eof"
            ? some(afterOp.span)
            : none(),
        ),
      );
    }
    return ok({ node: none(), next: cursor });
  }

  const endResult = parseExpressionWithBindingPower(
    tokens,
    diagnostics,
    cursor,
    5,
    allowStruct,
  );
  if (isErr(endResult)) return endResult;
  return ok({ node: some(endResult.value.node), next: endResult.value.next });
}

/** Rejects a range immediately followed by another range operator (`a....b`), which can't associate. */
function checkNoChainedRange(
  tokens: readonly Token[],
  next: number,
  inclusive: boolean,
): PR<void> {
  const peek = tokens[next];
  if (peek === undefined) return ok(undefined);
  const nextInfix = infixOp(peek);
  if (nextInfix?.kind !== "range") return ok(undefined);
  const sigil = inclusive ? "..=" : "..";
  return err(
    errorDiagnosticRaw(
      "HEDGE-PARSE-003",
      `cannot chain '${sigil}' with '${nextInfix.sigil}'`,
      some(peek.span),
    ),
  );
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
  const endResult = parseRangeEnd(
    tokens,
    diagnostics,
    dotDotPos + 1,
    inclusive,
    allowStruct,
  );
  if (isErr(endResult)) return endResult;

  const chainResult = checkNoChainedRange(
    tokens,
    endResult.value.next,
    inclusive,
  );
  if (isErr(chainResult)) return chainResult;

  const node: RangeExpression = {
    kind: "RangeExpression",
    tokenId: dotDotPos,
    start,
    end: endResult.value.node,
    inclusive,
  };
  return ok({ node, next: endResult.value.next });
}

function parseInfixAssign(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  lhs: Parsed<Expression>,
  opPos: number,
  infix: AssignInfixEntry,
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
  infix: CompoundAssignInfixEntry,
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
 * @param minBp The minimum binding power; operators with leftBp <= minBp are not consumed.
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
