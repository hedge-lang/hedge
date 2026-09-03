import type { Span } from "../lexer/token.js";
import type { Option } from "../option.js";

import type { DiagnosticCode } from "./code.js";
import { codeOf, type DiagnosticKind, type RelatedLabelKind } from "./kind.js";

/** A secondary source location a diagnostic refers to, alongside its own `span`. */
export interface RelatedSpan {
  readonly span: Span;
  readonly label: RelatedLabelKind;
}

/** A compiler diagnostic. */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly kind: DiagnosticKind;
  /** Source span the diagnostic points at, if known. */
  readonly span: Option<Span>;
  readonly code: DiagnosticCode;
  readonly relatedSpans: readonly RelatedSpan[];
}

/**
 * Build an error. `code` is derived from `kind`, never passed, so a call
 * site cannot pair a diagnostic with the wrong code. The lexer and parser
 * build every diagnostic through these; the analyzer has its own
 * `emitError`, which pushes onto its context.
 */
export function errorDiagnostic(
  kind: DiagnosticKind,
  span: Option<Span>,
): Diagnostic {
  return {
    severity: "error",
    kind,
    span,
    code: codeOf(kind),
    relatedSpans: [],
  };
}

export function warningDiagnostic(
  kind: DiagnosticKind,
  span: Option<Span>,
): Diagnostic {
  return {
    severity: "warning",
    kind,
    span,
    code: codeOf(kind),
    relatedSpans: [],
  };
}
