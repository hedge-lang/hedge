import type { Span } from "./lexer/token.js";
import type { Option } from "./option.js";

/**
 * A compiler diagnostic. This is the minimal shape for slice 1; error codes
 * and rich rendering grow with the diagnostics design note (see `docs/design`).
 */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Source span the diagnostic points at, if known. */
  readonly span: Option<Span>;
}
