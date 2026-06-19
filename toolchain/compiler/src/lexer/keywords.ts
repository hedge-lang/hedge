import { type Diagnostic } from "../diagnostics.js";
import { isIdentContinue, isIdentStart } from "./ident.js";
import { some } from "../option.js";
import { scanWhile } from "./scan-while.js";
import { type Token } from "./token.js";

/**
 * The hard keywords (grammar appendix). Contextual keywords (`write`, `bind`,
 * `package`, `unchecked`) are lexed as identifiers and classified later.
 */
export const HARD_KEYWORDS: ReadonlySet<string> = new Set([
  "as",
  "async",
  "await",
  "box",
  "break",
  "const",
  "continue",
  "dyn",
  "else",
  "enum",
  "export",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "macro",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "yield",
]);

export function isKeyword(source: string, start: number): boolean {
  const ch = source.at(start);
  if (ch === undefined || !isIdentStart(ch)) {
    return false;
  }
  const end = scanWhile(source, start + 1, isIdentContinue);
  return HARD_KEYWORDS.has(source.slice(start, end));
}

export function parseKeyword(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const end = scanWhile(source, start + 1, isIdentContinue);
  const text = source.slice(start, end);
  if (!HARD_KEYWORDS.has(text)) {
    diagnostics.push({
      severity: "error",
      message: `Unexpected token "${text}"; expected a keyword`,
      span: some({ start, end }),
    });
  }
  tokens.push({ kind: "keyword", text, span: { start, end } });
  return end;
}
