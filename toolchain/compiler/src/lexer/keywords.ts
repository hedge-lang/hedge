import { type Diagnostic } from "../diagnostics.js";
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

const KEYWORD_CHARACTERS = new Set(
  Array.from(HARD_KEYWORDS.values()).flatMap((keyword) => Array.from(keyword)),
);

export function isKeyword(source: string, start: number): boolean {
  const end = scanWhile(source, start, (ch) => KEYWORD_CHARACTERS.has(ch));
  const maybeKeyword = source.slice(start, end);
  return HARD_KEYWORDS.has(maybeKeyword);
}

export function parseKeyword(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const end = scanWhile(source, start, (ch) => KEYWORD_CHARACTERS.has(ch));
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
