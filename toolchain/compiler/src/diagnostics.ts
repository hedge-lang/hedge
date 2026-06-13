/**
 * A compiler diagnostic. This is the minimal shape for slice 1; spans, error
 * codes, and rich rendering grow with the diagnostics design note (see
 * `docs/design`).
 */
export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Index of the token the diagnostic points at. */
  readonly tokenId: number;
}
