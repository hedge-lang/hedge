import { assertNever } from "../assert.js";

import type { Diagnostic } from "./diagnostic.js";
import type { DiagnosticKind, RadixName, RelatedLabelKind } from "./kind.js";

/**
 * The sole place a `DiagnosticKind` becomes English. One exhaustive switch, so
 * a new variant fails to compile until it has text here. Imports nothing from
 * the AST/IR layers: every payload is already a plain string or scalar.
 */
// eslint-disable-next-line complexity -- One flat rendering per DiagnosticKind variant.
export function renderDiagnosticMessage(kind: DiagnosticKind): string {
  switch (kind.kind) {
    case "Raw":
      return kind.text;
    case "LexUnterminatedStringLiteral":
      return `Unterminated string literal starting at ${kind.offset}`;
    case "LexUnterminatedRawStringLiteral":
      return `Unterminated raw string literal starting at ${kind.offset}`;
    case "LexUnterminatedCharLiteral":
      return `unterminated char literal at offset ${kind.offset}`;
    case "LexUnterminatedBlockComment":
      return "Unterminated block comment";
    case "LexEmptyCharLiteral":
      return `empty char literal at offset ${kind.offset}`;
    case "LexUnexpectedCharacter":
      return `Unexpected character "${kind.character}" at offset ${kind.offset}`;
    case "LexRawIdentifierPrefixIncomplete":
      return "raw identifier prefix `r#` must be followed by an identifier";
    case "LexRawStringPrefixIncomplete":
      return `raw string prefix \`${kind.prefix}\` must be followed by '"'`;
    case "LexReadPastEnd":
      return `Attempted to read beyond end of source at index ${kind.index} of ${kind.sourceLength}`;
    case "LexFloatExponentNoDigits":
      return `float exponent has no digits at offset ${kind.offset}`;
    case "LexUnterminatedFloatLiteral":
      return `Unterminated float literal starting at ${kind.offset}`;
    case "LexRadixLiteralNoDigits":
      return `${kind.radix} literal has no digits at offset ${kind.offset}`;
    case "LexRadixLiteralLeadingUnderscore":
      return `${kind.radix} literal must begin with ${radixArticle(kind.radix)} ${kind.radix} digit, not '_' at offset ${kind.offset}`;
    case "LexInvalidRadixDigit":
      return `invalid ${kind.radix} digit '${kind.character}' at offset ${kind.offset}`;
    case "LexHexEscapeNeedsTwoDigits":
      return `hex escape \\x needs exactly 2 hex digits at offset ${kind.offset}`;
    case "LexUnicodeEscapeNoOpeningBrace":
      return `unicode escape \\u must be followed by '{' at offset ${kind.offset}`;
    case "LexUnicodeEscapeNoDigits":
      return `unicode escape has no digits at offset ${kind.offset}`;
    case "LexUnicodeEscapeNoClosingBrace":
      return `unicode escape missing closing '}' at offset ${kind.offset}`;
    case "LexUnicodeEscapeTooManyDigits":
      return `unicode escape has too many digits at offset ${kind.offset}`;
    case "LexUnicodeEscapeOutOfRange":
      return `unicode escape U+${kind.codepoint} is out of range (max U+10FFFF) at offset ${kind.offset}`;
    case "LexUnicodeEscapeSurrogate":
      return `unicode escape U+${kind.codepoint} is a surrogate code point at offset ${kind.offset}`;
    case "LexUnknownEscapeSequence":
      return `unknown escape sequence '\\${kind.sequence}' at offset ${kind.offset}`;
    default:
      return assertNever(kind);
  }
}

function radixArticle(radix: RadixName): string {
  return radix === "octal" ? "an" : "a";
}

export function renderRelatedLabel(label: RelatedLabelKind): string {
  // Becomes an exhaustive switch once RelatedLabelKind gains real variants.
  return label.text;
}

/**
 * The rendered text of a built diagnostic, for renderers and test assertions.
 * Accepts `undefined` so a `diagnostics[i]` index needs no guard at the call
 * site, and so it composes with the `assert(cond, messageOf(diags[0]))` idiom
 * where the message is only consulted when `cond` is already false.
 */
export function messageOf(
  diagnostic: Diagnostic | undefined,
  fallback: string = "",
): string {
  return diagnostic === undefined
    ? fallback
    : renderDiagnosticMessage(diagnostic.kind);
}
