import { type Diagnostic } from "../diagnostics.js";
import { none, type Option, some } from "../option.js";
import { err, isErr, ok, type Result } from "../result.js";
import { type Token } from "./token.js";

/**
 * Identify if the source at `index` is whitespace.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with whitespace.
 * @returns `Ok(false)` if the source does not start with whitespace.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
export function isWhitespace(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err({
      severity: "error",
      message: `Attempted to read beyond end of source at index ${index} of ${source.length}`,
      span: none(),
      code: none(),
      relatedSpans: [],
    });
  }

  return ok(ch === " " || ch === "\t" || ch === "\n" || ch === "\r");
}

/**
 * Consumes whitespace starting at `start` in `source` (whitespace is skipped; no tokens are emitted).
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` if the source starts with whitespace.
 * @returns `None` if the source does not start with whitespace.
 */
export function tokenizeWhitespace(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  void tokens;

  let index = start;
  while (index < source.length) {
    const maybeWhitespace = isWhitespace(source, index);
    if (isErr(maybeWhitespace)) {
      diagnostics.push(maybeWhitespace.error);
      break;
    }
    if (!maybeWhitespace.value) {
      break;
    }
    index += 1;
  }

  return index === start ? none() : some(index);
}
