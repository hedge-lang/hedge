import { type Diagnostic } from "../diagnostics/index.js";
import { none, type Option, some } from "../option.js";
import { isIdentContinue, isIdentStart } from "./ident.js";
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

/**
 * Tokenize a keyword starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` if the source starts with a keyword.
 * @returns `None` if the source does not start with a keyword.
 */
export function tokenizeKeyword(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  void diagnostics;
  const ch = source.at(start);
  if (ch === undefined || !isIdentStart(ch)) return none();
  const end = scanWhile(source, start + 1, isIdentContinue);
  const text = source.slice(start, end);
  if (!HARD_KEYWORDS.has(text)) return none();
  tokens.push({ kind: "keyword", text, span: { start, end } });
  return some(end);
}
