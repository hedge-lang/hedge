import { type Diagnostic, errorDiagnostic } from "../diagnostics/index.js";
import { none, type Option, some } from "../option.js";
import { scanWhile } from "./scan-while.js";
import { type Token } from "./token.js";

/**
 * Approximation of ECMAScript IdentifierName using Unicode property escapes.
 *
 * Spans are measured in UTF-16 code units; full code-point aware scanning may
 * be a later refinement.
 *
 * @param ch The character to test.
 *
 * @returns `true` if `ch` is a valid identifier start character.
 */
export function isIdentStart(ch: string): boolean {
  return /[\p{ID_Start}_$]/u.test(ch);
}

/**
 * Approximation of ECMAScript IdentifierPart using Unicode property escapes.
 *
 * Spans are measured in UTF-16 code units; full code-point aware scanning may
 * be a later refinement.
 *
 * @param ch The character to test.
 *
 * @returns `true` if `ch` is a valid identifier continue character.
 */
export function isIdentContinue(ch: string): boolean {
  return /[\p{ID_Continue}_$]/u.test(ch);
}

/**
 * Get an identifier starting at `start` in `source`, with an offset of `offset`
 * UTF-16 code units.
 *
 * @param source The source to scan.
 * @param start The index to start scanning at.
 * @param offset The offset to add to the start index.
 *
 * @returns The identifier token.
 */
function getIdent(source: string, start: number, offset: number): Token {
  const end = scanWhile(source, start + 1 + offset, isIdentContinue);
  const text = source.slice(start + offset, end);
  return { kind: "ident", text, span: { start, end } };
}

/**
 * Tokenize an identifier starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the identifier.
 * @returns `None` if the source does not start with an identifier.
 */
export function tokenizeIdent(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  void diagnostics;
  const ch = source.at(start);
  if (ch === undefined || !isIdentStart(ch)) return none();
  const token = getIdent(source, start, 0);
  tokens.push(token);
  return some(token.span.end);
}

/**
 * Tokenize a raw identifier starting at `start` in `source`, appending it to `tokens`.
 *
 * Also handles the error case where `r#` is not followed by an identifier start.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the raw identifier.
 * @returns `None` if the source does not start with `r#`.
 */
export function tokenizeRawIdent(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  if (source.at(start) !== "r" || source.at(start + 1) !== "#") return none();
  if (!isIdentStart(source.at(start + 2) ?? "")) {
    const end = start + 2;
    diagnostics.push(
      errorDiagnostic(
        { kind: "LexRawIdentifierPrefixIncomplete" },
        some({ start, end }),
      ),
    );
    tokens.push({ kind: "error", span: { start, end }, text: "r#" });
    return some(end);
  }
  const token = getIdent(source, start, 2);
  tokens.push(token);
  return some(token.span.end);
}
