import { scanWhile } from "./scan-while.js";
import type { Token } from "./token.js";

// NOTE: ASCII subset of ECMAScript IdentifierName for now; full Unicode
// ID_Start / ID_Continue (grammar appendix) is a later refinement.
export function isIdentStart(ch: string): boolean {
  return /[\p{ID_Start}_$]/u.test(ch);
}

export function isIdentContinue(ch: string): boolean {
  return /[\p{ID_Continue}_$]/u.test(ch);
}

function getIdent(source: string, start: number, offset: number): Token {
  const end = scanWhile(source, start + 1 + offset, isIdentContinue);
  const text = source.slice(start + offset, end);
  return { kind: "ident", text, span: { start, end } };
}

export function parseIdent(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const token = getIdent(source, start, 0);
  const end = token.span.end;
  tokens.push(token);
  return end;
}

export function isRawIdentStart(source: string, start: number): boolean {
  const a = source[start];
  const b = source[start + 1];
  const c = source[start + 2];

  if (a === undefined || b === undefined || c === undefined) {
    return false;
  }
  return a === "r" && b === "#" && isIdentStart(c);
}

export function parseRawIdent(
  tokens: Token[],
  source: string,
  start: number,
): number {
  const token = getIdent(source, start, 2);
  const end = token.span.end;
  tokens.push(token);
  return end;
}
