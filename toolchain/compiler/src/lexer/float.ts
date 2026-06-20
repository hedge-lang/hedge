import type { Diagnostic } from "../diagnostics.js";
import { none, some, type Option } from "../option.js";
import { isIdentContinue } from "./ident.js";
import { isDigit } from "./int.js";
import type { FloatSuffix, Token } from "./token.js";

/**
 * Matches a float suffix starting at `pos`.
 *
 * @param source The source to match against.
 * @param pos The position to start matching at.
 *
 * @returns The end position of the suffix and the suffix itself.
 */
export function matchFloatSuffix(
  source: string,
  pos: number,
): { end: number; suffix: Option<FloatSuffix> } {
  const suffixes: FloatSuffix[] = ["f32", "f64"];
  for (const s of suffixes) {
    if (
      source.startsWith(s, pos) &&
      !isIdentContinue(source[pos + s.length] ?? "")
    ) {
      return { end: pos + s.length, suffix: some(s) };
    }
  }
  return { end: pos, suffix: none() };
}

function scanExponent(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  pos: number,
): number | null {
  let i = pos + 1; // skip e/E
  if (source[i] === "+" || source[i] === "-") i += 1;
  if (!isDigit(source[i] ?? "")) {
    diagnostics.push({
      severity: "error",
      message: `float exponent has no digits at offset ${pos}`,
      span: some({ start, end: i }),
    });
    tokens.push({
      kind: "error",
      span: { start, end: i },
      text: source.slice(start, i),
    });
    return null;
  }
  while (isDigit(source[i] ?? "") || source[i] === "_") i++;
  return i;
}

export function scanExponentFloat(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  i: number,
): number {
  const expEnd = scanExponent(tokens, diagnostics, source, start, i);
  if (expEnd === null) return i + 1;
  const { end: suffixEnd, suffix: floatSuffix } = matchFloatSuffix(
    source,
    expEnd,
  );
  tokens.push({
    kind: "float",
    span: { start, end: suffixEnd },
    text: source.slice(start, suffixEnd),
    suffix: floatSuffix,
  });
  return suffixEnd;
}

export function scanDotFloat(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  dotPos: number,
): number {
  let i = dotPos + 1; // skip dot
  while (isDigit(source[i] ?? "") || source[i] === "_") i++;
  if (source[i] === "e" || source[i] === "E") {
    const expEnd = scanExponent(tokens, diagnostics, source, start, i);
    if (expEnd === null) return i + 1;
    i = expEnd;
  }
  const { end: suffixEnd, suffix: floatSuffix } = matchFloatSuffix(source, i);
  tokens.push({
    kind: "float",
    span: { start, end: suffixEnd },
    text: source.slice(start, suffixEnd),
    suffix: floatSuffix,
  });
  return suffixEnd;
}
