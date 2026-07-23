import type { Span } from "./lexer/token.js";
import type { Option } from "./option.js";

/** A secondary source location a diagnostic refers to, alongside its own `span`. */
export interface RelatedSpan {
  readonly span: Span;
  readonly label: string;
}

/**
 * A compiler diagnostic. `code` is a stable identifier (schema:
 * `HEDGE-<CATEGORY>-<NNN>`, see `diagnostic-code-id.test.ts`) for diagnostics
 * that have been assigned one; most emission sites still report `none()`.
 */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Source span the diagnostic points at, if known. */
  readonly span: Option<Span>;
  readonly code: Option<string>;
  readonly relatedSpans: readonly RelatedSpan[];
}
