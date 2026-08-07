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
 * Most emission sites still report `none()`. The end state is that `code`
 * becomes required, making an uncoded diagnostic unrepresentable rather than
 * merely discouraged; until then this union is the registry.
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
  | "HEDGE-BORROW-CHECK-001"
  | "HEDGE-BORROW-CHECK-002"
  | "HEDGE-BORROW-CHECK-003"
  | "HEDGE-LIFETIME-001"
  | "HEDGE-LIFETIME-002";

/** A compiler diagnostic. */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Source span the diagnostic points at, if known. */
  readonly span: Option<Span>;
  readonly code: Option<DiagnosticCode>;
  readonly relatedSpans: readonly RelatedSpan[];
}

/**
 * Build an error. `code` comes first so it is answered rather than trailed
 * off the end, and so the signature barely moves once it stops being
 * optional. The lexer and parser build every diagnostic through these; the
 * analyzer has its own `emitError`, which pushes onto its context.
 */
export function errorDiagnostic(
  code: Option<DiagnosticCode>,
  message: string,
  span: Option<Span>,
): Diagnostic {
  return { severity: "error", message, span, code, relatedSpans: [] };
}

export function warningDiagnostic(
  code: Option<DiagnosticCode>,
  message: string,
  span: Option<Span>,
): Diagnostic {
  return { severity: "warning", message, span, code, relatedSpans: [] };
}
