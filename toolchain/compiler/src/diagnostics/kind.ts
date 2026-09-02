import type { DiagnosticCode } from "./code.js";

/**
 * A structured diagnostic: one variant per distinct message template, each
 * carrying only plain, already-rendered data (a name, a count, a type name
 * produced by `describeType` at the emission site). `code` is derived from
 * the variant by `codeOf`, so a call site can never pair a diagnostic with
 * the wrong code, and the English text lives solely in `message.ts`.
 */
export type DiagnosticKind = RawDiagnosticKind;

/**
 * Wraps a preformatted message and its code so emission sites migrate to
 * structured variants one subsystem at a time. Removed once no site builds
 * one, at which point `tsc` proves every diagnostic is structured.
 */
interface RawDiagnosticKind {
  readonly kind: "Raw";
  readonly code: DiagnosticCode;
  readonly text: string;
}

/** The label on a diagnostic's secondary source location. */
export type RelatedLabelKind = RawRelatedLabelKind;

interface RawRelatedLabelKind {
  readonly kind: "RawLabel";
  readonly text: string;
}

export function codeOf(kind: DiagnosticKind): DiagnosticCode {
  // Becomes an exhaustive switch once DiagnosticKind gains real variants.
  return kind.code;
}
