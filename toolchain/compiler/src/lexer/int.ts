import type { Diagnostic } from "../diagnostics.js";
import { none, some, type Option } from "../option.js";
import { isIdentContinue } from "./ident.js";
import type { IntSuffix, Token } from "./token.js";

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

export function matchIntSuffix(
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

function numError(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  end: number,
  message: string,
): number {
  diagnostics.push({
    severity: "error",
    message,
    span: some({ start, end }),
    code: none(),
    relatedSpans: [],
  });
  tokens.push({
    kind: "error",
    span: { start, end },
    text: source.slice(start, end),
  });
  return end;
}

export function scanHexLiteral(
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

export function scanOctLiteral(
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

export function scanBinLiteral(
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
