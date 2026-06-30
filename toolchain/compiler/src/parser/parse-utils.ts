import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { none, some } from "../option.js";
import { err, isErr, ok, type Result } from "../result.js";
import type { Identifier } from "./ast.js";
import type { Parsed } from "./parse.js";

/** Internal shorthand for Result-threaded parser returns. */
export type PR<T> = Result<T, Diagnostic>;

/**
 * @returns the token at {@link pos}, or else a {@link Diagnostic} if the
 * parser attempts to read beyond the end of the token stream.
 */
export function tokenAt(tokens: readonly Token[], pos: number): PR<Token> {
  const token = tokens[pos];
  if (token === undefined) {
    return err({
      severity: "error",
      message: `Unexpected end of input at token ${pos}`,
      span: none(),
    });
  }
  return ok(token);
}

/**
 * Consumes a required token of the given kind.
 *
 * @returns Index of the next token, or `Err` if the token at `pos` is not of the expected kind.
 */
export function expect(
  tokens: readonly Token[],
  pos: number,
  kind: Token["kind"],
): PR<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== kind) {
    return err({
      severity: "error",
      message: `Expected ${kind}, found "${token.kind}" at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  return ok(pos + 1);
}

/**
 * Consumes a required keyword token.
 *
 * @returns Index of the next token after the keyword, or `Err` if the expected keyword is not present.
 */
export function expectKeyword(
  tokens: readonly Token[],
  pos: number,
  text: string,
): PR<number> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind !== "keyword" || token.text !== text) {
    const found = token.kind === "keyword" ? token.text : token.kind;
    return err({
      severity: "error",
      message: `Expected keyword "${text}", found "${found}" at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  return ok(pos + 1);
}

export function stripPrefix(text: string, radix: 2 | 8 | 10 | 16): string {
  if (radix !== 10) return text.slice(2); // strip 0x / 0o / 0b
  return text;
}

export function stripUnderscores(text: string): string {
  return text.replaceAll("_", "");
}

export const MUT_MESSAGE: string =
  "The keyword `mut` is reserved and cannot be used as an identifier. For a mutable binding, use `let mut`; for a mutable borrow, use `&mut`.";

/**
 * Parses an identifier expression.
 *
 * Grammar:
 *
 * ```text
 * Identifier ::= IDENT
 * ```
 */
export function parseIdentifier(
  tokens: readonly Token[],
  pos: number,
): PR<Parsed<Identifier>> {
  const tokenAtResult = tokenAt(tokens, pos);
  if (isErr(tokenAtResult)) {
    return tokenAtResult;
  }
  const token = tokenAtResult.value;
  if (token.kind === "keyword" && token.text === "mut") {
    return err({
      severity: "error",
      span: some({ start: token.span.start, end: token.span.end }),
      message: MUT_MESSAGE,
    });
  }

  if (token.kind !== "ident") {
    const found =
      token.kind === "keyword" ? `keyword "${token.text}"` : `"${token.kind}"`;
    return err({
      severity: "error",
      message: `Expected an identifier, found ${found} at offset ${token.span.start}`,
      span: some(token.span),
    });
  }
  const ident: Identifier = {
    kind: "Identifier",
    tokenId: pos,
    text: token.text,
  };
  return ok({ node: ident, next: pos + 1 });
}
