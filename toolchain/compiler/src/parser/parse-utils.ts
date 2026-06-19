import type { Diagnostic } from "../diagnostics.js";
import { isSome, none, some, type Option } from "../option.js";
import type { Token } from "../lexer/token.js";
import { tokenToString } from "../lexer/token.js";

/**
 * @returns `Some(token)` at {@link pos}, or pushes a {@link Diagnostic} and
 * returns `None` if the parser attempts to read beyond the end of the token stream.
 */
export function tokenAt(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
): Option<Token> {
  const token = tokens[pos];
  if (token === undefined) {
    diagnostics.push({
      severity: "error",
      message: `Unexpected end of input at token ${pos}`,
      span: none(),
    });
    return none();
  }
  return some(token);
}

/**
 * Contextual keywords are lexed as identifiers and interpreted by the parser.
 *
 * @returns `true` if the token is an identifier whose text matches a contextual keyword.
 */
export function isContextual(token: Token, text: string): boolean {
  return token.kind === "ident" && token.text === text;
}

/**
 * Consumes a required token of the given kind.
 *
 * @returns `Some(next)` with the index of the next token, or `None` if the
 * token at `pos` is not of the expected kind.
 */
export function expect(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  kind: Token["kind"],
): Option<number> {
  const tokenAtResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenAtResult)) {
    return none();
  }
  const token = tokenAtResult.value;
  if (token.kind !== kind) {
    diagnostics.push({
      severity: "error",
      message: `Expected ${kind}, found "${tokenToString(token)}"`,
      span: some(token.span),
    });
    return none();
  }
  return some(pos + 1);
}

/**
 * Consumes a required keyword token.
 *
 * @returns `Some(next)` with the index after the keyword, or `None` if the
 * expected keyword is not present.
 */
export function expectKeyword(
  tokens: readonly Token[],
  diagnostics: Diagnostic[],
  pos: number,
  text: string,
): Option<number> {
  const tokenAtResult = tokenAt(tokens, diagnostics, pos);
  if (!isSome(tokenAtResult)) {
    return none();
  }
  const token = tokenAtResult.value;
  if (token.kind !== "keyword" || token.text !== text) {
    diagnostics.push({
      severity: "error",
      message: `Expected keyword "${text}", found "${tokenToString(token)}"`,
      span: some(token.span),
    });
    return none();
  }
  return some(pos + 1);
}
