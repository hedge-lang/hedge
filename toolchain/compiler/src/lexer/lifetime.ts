import { type Diagnostic } from "../diagnostics.js";
import { none, type Option, some } from "../option.js";
import { isIdentContinue, isIdentStart } from "./ident.js";
import { scanWhile } from "./scan-while.js";
import { type Token } from "./token.js";

/**
 * Tokenize a lifetime starting at `start` in `source`, appending it to `tokens`.
 *
 * A lifetime is `'ident`. A bare `'` not followed by an identifier start is an
 * error token.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the lifetime.
 * @returns `None` if the source does not start with `'`.
 */
export function tokenizeLifetime(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  if (source.at(start) !== "'") return none();
  const ch1 = source.at(start + 1) ?? "";
  if (isIdentStart(ch1)) {
    const end = scanWhile(source, start + 2, isIdentContinue);
    tokens.push({
      kind: "lifetime",
      text: source.slice(start + 1, end),
      span: { start, end },
    });
    return some(end);
  }
  const end = start + 1;
  diagnostics.push({
    severity: "error",
    message: `Unexpected character "'" at offset ${start}`,
    span: some({ start, end }),
  });
  tokens.push({ kind: "error", span: { start, end }, text: "'" });
  return some(end);
}
