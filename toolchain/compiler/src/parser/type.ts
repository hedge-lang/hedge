import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type { NamedType, Type, UnitType } from "./ast.js";
import type { Parsed } from "./parse.js";
import { tokenAt } from "./parse-utils.js";
import { parsePathSegments } from "./path.js";

/**
 * Parses a type.
 *
 * Slice-1 supports named types (path types) and the unit type `()`.
 * The forms `&T`, `&write T`, `[T]`, and `!` are recognized and produce
 * specific guardrail errors; all other unsupported type syntax produces a
 * generic guardrail error.
 *
 * Grammar:
 *
 * ```text
 * Type ::= "()" | Path
 * ```
 *
 * `(Type)` (tuple syntax) is recognized and produces a guardrail diagnostic;
 * tuple types are not supported in Slice 1.
 */
export function parseType(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Parsed<Type>> {
  const tokenResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenResult)) {
    return none();
  }
  const token = tokenResult.value;

  if (token.kind === "lparen") {
    const nextResult = tokenAt(tokens, diagnostics, pos + 1);
    if (!isSome(nextResult)) {
      return none();
    }
    const next = nextResult.value;
    if (next.kind === "rparen") {
      const unit: UnitType = { kind: "UnitType", tokenId: pos };
      return some({ node: unit, next: pos + 2 });
    }
    if (next.kind === "eof") {
      diagnostics.push({
        severity: "error",
        message: "expected `)` to close type, found end of input",
        span: some(token.span),
      });
      return none();
    }
    diagnostics.push({
      severity: "error",
      message: "tuple types are not supported in Slice 1",
      span: some(token.span),
    });
    return none();
  }

  if (token.kind === "ident" || token.kind === "path_sep") {
    const pathResult = parsePathSegments(tokens, diagnostics, pos);
    if (!isSome(pathResult)) {
      return none();
    }
    const named: NamedType = {
      kind: "NamedType",
      tokenId: pos,
      path: pathResult.value.node,
    };
    return some({ node: named, next: pathResult.value.next });
  }

  if (token.kind === "amp") {
    diagnostics.push({
      severity: "error",
      message:
        "reference types are not supported in Slice 1; borrows are introduced in Slice 2",
      span: some(token.span),
    });
    return none();
  }

  if (token.kind === "lbracket") {
    diagnostics.push({
      severity: "error",
      message: "slice types ([T]) are not supported in Slice 1",
      span: some(token.span),
    });
    return none();
  }

  if (token.kind === "bang") {
    diagnostics.push({
      severity: "error",
      message: "the never type (!) is not supported in Slice 1",
      span: some(token.span),
    });
    return none();
  }

  diagnostics.push({
    severity: "error",
    message: `type syntax "${token.kind}" is not supported in Slice 1`,
    span: some(token.span),
  });
  return none();
}
