import { errorDiagnostic } from "../diagnostics.js";
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
    diagnostics.push(
      errorDiagnostic(
        some("HEDGE-LEX-006"),
        `float exponent has no digits at offset ${pos}`,
        some({ start, end: i }),
      ),
    );
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
  if (expEnd === null) {
    const token = tokens.at(-1);
    if (!token) {
      diagnostics.push(
        errorDiagnostic(
          some("HEDGE-LEX-006"),
          `Unterminated float literal starting at ${start}`,
          some({ start, end: source.length }),
        ),
      );
      tokens.push({
        kind: "error",
        span: { start, end: source.length },
        text: source.slice(start),
      });
      return source.length;
    }
    return token.span.end;
  }
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
    if (expEnd === null) {
      const lastToken = tokens.at(-1);
      if (lastToken === undefined) {
        diagnostics.push(
          errorDiagnostic(
            some("HEDGE-LEX-006"),
            `Unterminated float literal starting at ${start}`,
            some({ start, end: source.length }),
          ),
        );
        tokens.push({
          kind: "error",
          span: { start, end: source.length },
          text: source.slice(start),
        });
        return source.length;
      }
      return lastToken.span.end;
    }
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
