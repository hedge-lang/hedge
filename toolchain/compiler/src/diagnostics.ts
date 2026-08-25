import type { Span } from "./lexer/token.js";
import type { Option } from "./option.js";

/** A secondary source location a diagnostic refers to, alongside its own `span`. */
export interface RelatedSpan {
  readonly span: Span;
  readonly label: string;
}

/**
 * Every assigned diagnostic code, spelled out so a typo or a duplicate fails
 * to compile and the assigned set can be read in one place. The schema is
 * `HEDGE-<CATEGORY>-<NNN>`, pinned by `diagnostic-code-id.test.ts`.
 *
 * `Diagnostic.code` is required, so an uncoded diagnostic is unrepresentable
 * rather than merely discouraged, and this union is the whole registry.
 */
export type DiagnosticCode =
  // Lexing.
  | "HEDGE-LEX-001" // unterminated string literal
  | "HEDGE-LEX-002" // unterminated char literal
  | "HEDGE-LEX-003" // unterminated block comment
  | "HEDGE-LEX-004" // empty char literal
  | "HEDGE-LEX-005" // unexpected character
  | "HEDGE-LEX-006" // malformed numeric literal
  | "HEDGE-LEX-007" // malformed raw prefix
  | "HEDGE-LEX-008" // invalid escape sequence
  | "HEDGE-LEX-009" // scanner read past end of source (internal invariant)
  // Parsing.
  | "HEDGE-PARSE-001" // unexpected token
  | "HEDGE-PARSE-002" // unexpected end of input
  | "HEDGE-PARSE-003" // non-associative operator chained
  | "HEDGE-PARSE-004" // construct not supported in this slice
  | "HEDGE-PARSE-005" // stray extra `>`
  | "HEDGE-PARSE-006" // construct not allowed in this position
  // Name resolution.
  | "HEDGE-NAME-001" // name not found in this scope
  | "HEDGE-NAME-002" // item defined more than once
  | "HEDGE-NAME-003" // no such field
  | "HEDGE-NAME-004" // no such variant
  | "HEDGE-NAME-005" // field given more than once in one initializer
  | "HEDGE-NAME-006" // `Self` used outside a trait/impl block
  // Typing.
  | "HEDGE-TYPE-001" // type mismatch
  | "HEDGE-TYPE-002" // operand type invalid for this operator
  | "HEDGE-TYPE-003" // operands must have the same type
  | "HEDGE-TYPE-004" // branches have incompatible types
  | "HEDGE-TYPE-005" // value out of range for its type
  | "HEDGE-TYPE-006" // type cannot be inferred
  | "HEDGE-TYPE-007" // operation invalid for this type
  | "HEDGE-TYPE-008" // construction does not match the type's shape
  | "HEDGE-TYPE-009" // struct/enum type parameter declared but never used
  | "HEDGE-TYPE-010" // generic parameter bound to conflicting types
  | "HEDGE-TYPE-011" // turbofish argument count does not match declared generics
  // Patterns.
  | "HEDGE-PATTERN-001" // refutable pattern in an irrefutable position
  | "HEDGE-PATTERN-002" // non-exhaustive match
  | "HEDGE-PATTERN-003" // unreachable pattern
  | "HEDGE-PATTERN-004" // or-pattern alternatives disagree
  | "HEDGE-PATTERN-005" // pattern shape does not match the scrutinee
  | "HEDGE-PATTERN-006" // invalid range bounds
  | "HEDGE-PATTERN-007" // binding mode not permitted here
  // Constant evaluation.
  | "HEDGE-CONST-001" // not a compile-time constant
  | "HEDGE-CONST-002" // const defined in terms of itself
  | "HEDGE-CONST-003" // arithmetic error during constant evaluation
  | "HEDGE-CONST-004" // invalid array length
  // Borrow checking and mutability.
  | "HEDGE-BORROW-CHECK-001"
  | "HEDGE-BORROW-CHECK-002"
  | "HEDGE-BORROW-CHECK-003"
  | "HEDGE-BORROW-CHECK-005" // expression is not a borrowable place
  | "HEDGE-BORROW-CHECK-006" // cannot assign through an immutable binding
  | "HEDGE-LIFETIME-001"
  | "HEDGE-LIFETIME-002"
  // Moves and drops.
  | "HEDGE-MOVE-001" // use of an uninitialized binding
  | "HEDGE-MOVE-002" // cannot move out of this place
  | "HEDGE-MOVE-003" // drop obligation is ambiguous
  | "HEDGE-MOVE-004" // value is dropped conditionally (warning)
  // Lints (warnings).
  | "HEDGE-LINT-001" // binding can never be used
  | "HEDGE-LINT-002" // generic parameter shadows an outer type of the same name
  // Items and slice gating.
  | "HEDGE-ITEM-001" // item not permitted in this position
  | "HEDGE-UNSUPPORTED-001"; // construct not yet supported by the analyzer

/** A compiler diagnostic. */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Source span the diagnostic points at, if known. */
  readonly span: Option<Span>;
  readonly code: DiagnosticCode;
  readonly relatedSpans: readonly RelatedSpan[];
}

/**
 * Build an error. `code` comes first so it is answered rather than trailed
 * off the end, and so the signature barely moves once it stops being
 * optional. The lexer and parser build every diagnostic through these; the
 * analyzer has its own `emitError`, which pushes onto its context.
 */
export function errorDiagnostic(
  code: DiagnosticCode,
  message: string,
  span: Option<Span>,
): Diagnostic {
  return { severity: "error", message, span, code, relatedSpans: [] };
}

export function warningDiagnostic(
  code: DiagnosticCode,
  message: string,
  span: Option<Span>,
): Diagnostic {
  return { severity: "warning", message, span, code, relatedSpans: [] };
}
