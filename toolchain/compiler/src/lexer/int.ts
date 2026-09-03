import type { Diagnostic, DiagnosticKind } from "../diagnostics/index.js";
import { errorDiagnostic } from "../diagnostics/index.js";
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
  kind: DiagnosticKind,
): number {
  diagnostics.push(errorDiagnostic(kind, some({ start, end })));
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
    const kind: DiagnosticKind =
      firstChar === "_"
        ? {
            kind: "LexRadixLiteralLeadingUnderscore",
            radix: "hex",
            offset: start,
          }
        : { kind: "LexRadixLiteralNoDigits", radix: "hex", offset: start };
    const end = firstChar !== "" ? i + 1 : i;
    return numError(tokens, diagnostics, source, start, end, kind);
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
    const kind: DiagnosticKind =
      ch === "_"
        ? {
            kind: "LexRadixLiteralLeadingUnderscore",
            radix: "octal",
            offset: start,
          }
        : isDigit(ch)
          ? {
              kind: "LexInvalidRadixDigit",
              radix: "octal",
              character: ch,
              offset: i,
            }
          : { kind: "LexRadixLiteralNoDigits", radix: "octal", offset: start };
    const end = ch !== "" ? i + 1 : i;
    return numError(tokens, diagnostics, source, start, end, kind);
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
    const kind: DiagnosticKind =
      ch === "_"
        ? {
            kind: "LexRadixLiteralLeadingUnderscore",
            radix: "binary",
            offset: start,
          }
        : isDigit(ch)
          ? {
              kind: "LexInvalidRadixDigit",
              radix: "binary",
              character: ch,
              offset: i,
            }
          : { kind: "LexRadixLiteralNoDigits", radix: "binary", offset: start };
    const end = ch !== "" ? i + 1 : i;
    return numError(tokens, diagnostics, source, start, end, kind);
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
