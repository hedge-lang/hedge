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
