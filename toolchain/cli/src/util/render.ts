import type { Diagnostic } from "@hedge-lang/compiler";
import {} from "@hedge-lang/compiler";

/**
 * Render diagnostics as one `severity[code]: message` line each (the code
 * bracket is omitted when absent), followed by one `= note: label at offset
 * N` line per related span. A line/column renderer with source snippets is
 * a later increment (the diagnostics design note); diagnostics currently
 * carry only a token index.
 */
export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map(renderDiagnostic).join("\n");
}

function renderDiagnostic(diagnostic: Diagnostic): string {
  const code = `[${diagnostic.code}]`;
  const lines = [`${diagnostic.severity}${code}: ${diagnostic.message}`];
  for (const related of diagnostic.relatedSpans) {
    lines.push(`  = note: ${related.label} at offset ${related.span.start}`);
  }
  return lines.join("\n");
}
