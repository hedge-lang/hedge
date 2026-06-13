export { tokenize } from "./lexer/lexer.js";
export type { Span, Token, TokenKind } from "./lexer/token.js";

export { parse } from "./parser/parser.js";
export type * from "./parser/ast.js";

export function version(): string {
  return "0.0.0";
}
