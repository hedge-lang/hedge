import type { Diagnostic } from "./diagnostic.js";
import type { DiagnosticKind, RelatedLabelKind } from "./kind.js";

/**
 * The sole place a `DiagnosticKind` becomes English. Becomes one exhaustive
 * switch once real variants land, so a new variant fails to compile until it
 * has text here. Imports nothing from the AST/IR layers: every payload is
 * already a plain string or scalar.
 */
export function renderDiagnosticMessage(kind: DiagnosticKind): string {
  return kind.text;
}

export function renderRelatedLabel(label: RelatedLabelKind): string {
  return label.text;
}

/**
 * The rendered text of a built diagnostic, for renderers and test assertions.
 * Accepts `undefined` so a `diagnostics[i]` index needs no guard at the call
 * site, and so it composes with the `assert(cond, messageOf(diags[0]))` idiom
 * where the message is only consulted when `cond` is already false.
 */
export function messageOf(
  diagnostic: Diagnostic | undefined,
  fallback: string = "",
): string {
  return diagnostic === undefined
    ? fallback
    : renderDiagnosticMessage(diagnostic.kind);
}
