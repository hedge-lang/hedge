import type { Diagnostic } from "@hedge-lang/compiler";

/**
 * Render diagnostics as one `severity: message` line each. A line/column
 * renderer with source snippets is a later increment (the diagnostics design
 * note); diagnostics currently carry only a token index.
 */
export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic: Diagnostic): string =>
        `${diagnostic.severity}: ${diagnostic.message}`,
    )
    .join("\n");
}
