import type { Diagnostic } from "../diagnostics.js";
import { some } from "../option.js";
import { isHexDigit } from "./number.js";
import type { Token } from "./token.js";

function escapeError(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  tokenStart: number,
  end: number,
  message: string,
): null {
  diagnostics.push({
    severity: "error",
    message,
    span: some({ start: tokenStart, end }),
  });
  tokens.push({
    kind: "error",
    span: { start: tokenStart, end },
    text: source.slice(tokenStart, end),
  });
  return null;
}

function scanHexEscape(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  tokenStart: number,
  pos: number,
): number | null {
  const h1 = source[pos + 2] ?? "";
  const h2 = source[pos + 3] ?? "";
  if (!isHexDigit(h1) || !isHexDigit(h2)) {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      pos + 4,
      `hex escape \\x needs exactly 2 hex digits at offset ${pos}`,
    );
  }
  return pos + 4;
}

function scanUnicodeEscape(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  tokenStart: number,
  pos: number,
): number | null {
  if (source[pos + 2] !== "{") {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      pos + 3,
      `unicode escape \\u must be followed by '{' at offset ${pos}`,
    );
  }
  let j = pos + 3;
  const hexStart = j;
  while (isHexDigit(source[j] ?? "")) j++;
  if (j === hexStart) {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      j + 1,
      `unicode escape has no digits at offset ${pos}`,
    );
  }
  if (source[j] !== "}") {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      j + 1,
      `unicode escape missing closing '}' at offset ${j}`,
    );
  }
  const hexStr = source.slice(hexStart, j);
  if (hexStr.length > 6) {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      j + 1,
      `unicode escape has too many digits at offset ${pos}`,
    );
  }
  const codePoint = parseInt(hexStr, 16);
  if (codePoint > 0x10ffff) {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      j + 1,
      `unicode escape U+${hexStr.toUpperCase()} is out of range (max U+10FFFF) at offset ${pos}`,
    );
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return escapeError(
      tokens,
      diagnostics,
      source,
      tokenStart,
      j + 1,
      `unicode escape U+${hexStr.toUpperCase()} is a surrogate code point at offset ${pos}`,
    );
  }
  return j + 1;
}

/** Decodes a raw escape-sequence text (e.g. `\\n`) to the actual character. */
export function resolveEscape(raw: string): string {
  if (raw.startsWith("\\")) {
    const code = raw[1];
    switch (code) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "\\":
        return "\\";
      case "'":
        return "'";
      case '"':
        return '"';
      case "0":
        return "\0";
      case "$":
        return "$";
      case "x":
        return String.fromCodePoint(parseInt(raw.slice(2), 16));
      case "u":
        return String.fromCodePoint(parseInt(raw.slice(3, -1), 16));
    }
  }
  return raw;
}

/**
 * Validates and scans a single escape sequence starting at the `\` (pos).
 * Returns the index after the escape, or emits a diagnostic and returns null.
 */
export function scanEscapeSeq(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  tokenStart: number,
  pos: number,
): number | null {
  const next = source[pos + 1] ?? "";
  switch (next) {
    case "n":
    case "r":
    case "t":
    case "\\":
    case "'":
    case '"':
    case "0":
    case "$":
      return pos + 2;
    case "x":
      return scanHexEscape(tokens, diagnostics, source, tokenStart, pos);
    case "u":
      return scanUnicodeEscape(tokens, diagnostics, source, tokenStart, pos);
    default:
      return escapeError(
        tokens,
        diagnostics,
        source,
        tokenStart,
        pos + 2,
        `unknown escape sequence '\\${next}' at offset ${pos}`,
      );
  }
}
