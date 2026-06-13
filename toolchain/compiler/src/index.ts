export { tokenize } from "./lexer/lexer.js";
export type { Span, Token, TokenKind } from "./lexer/token.js";

export { parse } from "./parser/parser.js";
export type * from "./parser/ast.js";

export { analyze } from "./semantics/analyzer.js";
export type { AnalysisResult } from "./semantics/analyzer.js";
export type { Diagnostic } from "./diagnostics.js";

export { checkBorrows } from "./ownership/borrowck.js";

export { optimize } from "./optimization/optimizer.js";

export { generate } from "./codegen/generator.js";
export type { Code } from "./codegen/output.js";

export { compile } from "./driver.js";
export type { CompileResult } from "./driver.js";

export function version(): string {
  return "0.0.0";
}
