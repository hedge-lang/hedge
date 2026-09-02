import type { Span } from "../lexer/token.js";
import type { Option } from "../option.js";

import type { DiagnosticCode } from "./code.js";

/** A secondary source location a diagnostic refers to, alongside its own `span`. */
export interface RelatedSpan {
  readonly span: Span;
  readonly label: string;
}

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
