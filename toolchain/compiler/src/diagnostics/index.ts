export type { DiagnosticCode } from "./code.js";
export type { Diagnostic, RelatedSpan } from "./diagnostic.js";
export {
  errorDiagnostic,
  errorDiagnosticRaw,
  rawLabel,
  warningDiagnosticRaw,
} from "./diagnostic.js";
export { codeOf, type DiagnosticKind, type RelatedLabelKind } from "./kind.js";
export {
  messageOf,
  renderDiagnosticMessage,
  renderRelatedLabel,
} from "./message.js";
