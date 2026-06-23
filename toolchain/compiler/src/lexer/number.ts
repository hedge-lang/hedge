import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "./token.js";
import {
  isDigit,
  matchIntSuffix,
  scanBinLiteral,
  scanHexLiteral,
  scanOctLiteral,
} from "./int.js";
import { matchFloatSuffix, scanDotFloat, scanExponentFloat } from "./float.js";

function scanDecimalOrFloat(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  let i = start;
  while (isDigit(source[i] ?? "") || source[i] === "_") i++;

  const { end: floatSuffixEnd, suffix: directFloatSuffix } = matchFloatSuffix(
    source,
    i,
  );
  if (floatSuffixEnd > i) {
    tokens.push({
      kind: "float",
      span: { start, end: floatSuffixEnd },
      text: source.slice(start, floatSuffixEnd),
      suffix: directFloatSuffix,
    });
    return floatSuffixEnd;
  }

  if (source[i] === "e" || source[i] === "E")
    return scanExponentFloat(tokens, diagnostics, source, start, i);
  if (source[i] === "." && isDigit(source[i + 1] ?? ""))
    return scanDotFloat(tokens, diagnostics, source, start, i);

  const { end, suffix } = matchIntSuffix(source, i);
  tokens.push({
    kind: "int",
    span: { start, end },
    text: source.slice(start, end),
    radix: 10,
    suffix,
  });
  return end;
}

export function scanNumberLiteral(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  const ch0 = source[start] ?? "";
  const ch1 = source[start + 1] ?? "";
  if (ch0 === "0" && (ch1 === "x" || ch1 === "X"))
    return scanHexLiteral(tokens, diagnostics, source, start);
  if (ch0 === "0" && (ch1 === "o" || ch1 === "O"))
    return scanOctLiteral(tokens, diagnostics, source, start);
  if (ch0 === "0" && (ch1 === "b" || ch1 === "B"))
    return scanBinLiteral(tokens, diagnostics, source, start);
  return scanDecimalOrFloat(tokens, diagnostics, source, start);
}
