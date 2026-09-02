export { tokenize } from "./lexer/lexer.js";
export type { Span, Token } from "./lexer/token.js";

export { parse } from "./parser/parser.js";
export type { ParseResult } from "./parser/parser.js";
export type * from "./parser/ast.js";

export { analyze } from "./semantics/analyzer.js";
export type { AnalysisResult } from "./semantics/analyzer.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticKind,
  RelatedLabelKind,
  RelatedSpan,
} from "./diagnostics/index.js";
export {
  codeOf,
  errorDiagnostic,
  messageOf,
  renderDiagnosticMessage,
  renderRelatedLabel,
  warningDiagnostic,
} from "./diagnostics/index.js";

export { checkBorrows } from "./ownership/borrowck.js";

export { optimize } from "./optimization/optimizer.js";

export { generate } from "./codegen/generator.js";
export type { Code } from "./codegen/output.js";

export { compile } from "./driver.js";
export type { CompileOptions, CompileResult } from "./driver.js";

export type { Option } from "./option.js";
export { some, none, isSome, isNone } from "./option.js";

export type { Result } from "./result.js";
export { ok, err, isOk, isErr } from "./result.js";

export function version(): string {
  return "0.0.0";
}
