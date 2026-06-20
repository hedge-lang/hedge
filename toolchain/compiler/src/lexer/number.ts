import type { Option } from "../option.js";
import { none, some } from "../option.js";
import { isIdentContinue } from "./ident.js";
import type { FloatSuffix, IntSuffix, Token } from "./token.js";
import type { Diagnostic } from "../diagnostics.js";

export function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

export function isHexDigit(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

function isOctDigit(ch: string): boolean {
  return ch >= "0" && ch <= "7";
}

function isBinDigit(ch: string): boolean {
  return ch === "0" || ch === "1";
}

function matchIntSuffix(
  source: string,
  pos: number,
): { end: number; suffix: Option<IntSuffix> } {
  const suffixes: IntSuffix[] = [
    "isize",
    "usize",
    "i64",
    "i32",
    "i16",
    "i8",
    "u64",
    "u32",
    "u16",
    "u8",
  ];
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

function matchFloatSuffix(
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

function numError(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  end: number,
  message: string,
): number {
  diagnostics.push({ severity: "error", message, span: some({ start, end }) });
  tokens.push({
    kind: "error",
    span: { start, end },
    text: source.slice(start, end),
  });
  return end;
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

function scanHexLiteral(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  let i = start + 2;
  const firstChar = source[i] ?? "";
  if (!isHexDigit(firstChar)) {
    const msg =
      firstChar === "_"
        ? `hex literal must begin with a hex digit, not '_' at offset ${start}`
        : `hex literal has no digits at offset ${start}`;
    const end = firstChar !== "" ? i + 1 : i;
    return numError(tokens, diagnostics, source, start, end, msg);
  }
  while (isHexDigit(source[i] ?? "") || source[i] === "_") i++;
  const { end, suffix } = matchIntSuffix(source, i);
  tokens.push({
    kind: "int",
    span: { start, end },
    text: source.slice(start, end),
    radix: 16,
    suffix,
  });
  return end;
}

function scanOctLiteral(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  let i = start + 2;
  const ch = source[i] ?? "";
  if (!isOctDigit(ch)) {
    const msg =
      ch === "_"
        ? `octal literal must begin with an octal digit, not '_' at offset ${start}`
        : isDigit(ch)
          ? `invalid octal digit '${ch}' at offset ${i}`
          : `octal literal has no digits at offset ${start}`;
    const end = ch !== "" ? i + 1 : i;
    return numError(tokens, diagnostics, source, start, end, msg);
  }
  while (isOctDigit(source[i] ?? "") || source[i] === "_") i++;
  const { end, suffix } = matchIntSuffix(source, i);
  tokens.push({
    kind: "int",
    span: { start, end },
    text: source.slice(start, end),
    radix: 8,
    suffix,
  });
  return end;
}

function scanBinLiteral(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): number {
  let i = start + 2;
  const ch = source[i] ?? "";
  if (!isBinDigit(ch)) {
    const msg =
      ch === "_"
        ? `binary literal must begin with a binary digit, not '_' at offset ${start}`
        : isDigit(ch)
          ? `invalid binary digit '${ch}' at offset ${i}`
          : `binary literal has no digits at offset ${start}`;
    const end = ch !== "" ? i + 1 : i;
    return numError(tokens, diagnostics, source, start, end, msg);
  }
  while (isBinDigit(source[i] ?? "") || source[i] === "_") i++;
  const { end, suffix } = matchIntSuffix(source, i);
  tokens.push({
    kind: "int",
    span: { start, end },
    text: source.slice(start, end),
    radix: 2,
    suffix,
  });
  return end;
}

function scanExponentFloat(
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

function scanDotFloat(
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
