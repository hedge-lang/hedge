import { assertNever } from "../assert.js";

import type { DiagnosticCode } from "./code.js";

/**
 * A structured diagnostic: one variant per distinct message template, each
 * carrying only plain, already-rendered data (a name, a count, a type name
 * produced by `describeType` at the emission site). `code` is derived from
 * the variant by `codeOf`, so a call site can never pair a diagnostic with
 * the wrong code, and the English text lives solely in `message.ts`.
 */
export type DiagnosticKind =
  | RawDiagnosticKind
  // Lexing.
  | { readonly kind: "LexUnterminatedStringLiteral"; readonly offset: number }
  | {
      readonly kind: "LexUnterminatedRawStringLiteral";
      readonly offset: number;
    }
  | { readonly kind: "LexUnterminatedCharLiteral"; readonly offset: number }
  | { readonly kind: "LexUnterminatedBlockComment" }
  | { readonly kind: "LexEmptyCharLiteral"; readonly offset: number }
  | {
      readonly kind: "LexUnexpectedCharacter";
      readonly character: string;
      readonly offset: number;
    }
  | { readonly kind: "LexRawIdentifierPrefixIncomplete" }
  | {
      readonly kind: "LexRawStringPrefixIncomplete";
      readonly prefix: string;
    }
  | {
      readonly kind: "LexReadPastEnd";
      readonly index: number;
      readonly sourceLength: number;
    }
  | { readonly kind: "LexFloatExponentNoDigits"; readonly offset: number }
  | { readonly kind: "LexUnterminatedFloatLiteral"; readonly offset: number }
  | {
      readonly kind: "LexRadixLiteralNoDigits";
      readonly radix: RadixName;
      readonly offset: number;
    }
  | {
      readonly kind: "LexRadixLiteralLeadingUnderscore";
      readonly radix: RadixName;
      readonly offset: number;
    }
  | {
      readonly kind: "LexInvalidRadixDigit";
      readonly radix: RadixName;
      readonly character: string;
      readonly offset: number;
    }
  | { readonly kind: "LexHexEscapeNeedsTwoDigits"; readonly offset: number }
  | { readonly kind: "LexUnicodeEscapeNoOpeningBrace"; readonly offset: number }
  | { readonly kind: "LexUnicodeEscapeNoDigits"; readonly offset: number }
  | { readonly kind: "LexUnicodeEscapeNoClosingBrace"; readonly offset: number }
  | { readonly kind: "LexUnicodeEscapeTooManyDigits"; readonly offset: number }
  | {
      readonly kind: "LexUnicodeEscapeOutOfRange";
      readonly codepoint: string;
      readonly offset: number;
    }
  | {
      readonly kind: "LexUnicodeEscapeSurrogate";
      readonly codepoint: string;
      readonly offset: number;
    }
  | {
      readonly kind: "LexUnknownEscapeSequence";
      readonly sequence: string;
      readonly offset: number;
    };

export type RadixName = "hex" | "octal" | "binary";

/**
 * Wraps a preformatted message and its code so emission sites migrate to
 * structured variants one subsystem at a time. Removed once no site builds
 * one, at which point `tsc` proves every diagnostic is structured.
 */
interface RawDiagnosticKind {
  readonly kind: "Raw";
  readonly code: DiagnosticCode;
  readonly text: string;
}

/** The label on a diagnostic's secondary source location. */
export type RelatedLabelKind = RawRelatedLabelKind;

interface RawRelatedLabelKind {
  readonly kind: "RawLabel";
  readonly text: string;
}

// eslint-disable-next-line complexity -- One flat mapping over the DiagnosticKind union.
export function codeOf(kind: DiagnosticKind): DiagnosticCode {
  switch (kind.kind) {
    case "Raw":
      return kind.code;
    case "LexUnterminatedStringLiteral":
    case "LexUnterminatedRawStringLiteral":
      return "HEDGE-LEX-001";
    case "LexUnterminatedCharLiteral":
      return "HEDGE-LEX-002";
    case "LexUnterminatedBlockComment":
      return "HEDGE-LEX-003";
    case "LexEmptyCharLiteral":
      return "HEDGE-LEX-004";
    case "LexUnexpectedCharacter":
      return "HEDGE-LEX-005";
    case "LexFloatExponentNoDigits":
    case "LexUnterminatedFloatLiteral":
    case "LexRadixLiteralNoDigits":
    case "LexRadixLiteralLeadingUnderscore":
    case "LexInvalidRadixDigit":
      return "HEDGE-LEX-006";
    case "LexRawIdentifierPrefixIncomplete":
    case "LexRawStringPrefixIncomplete":
      return "HEDGE-LEX-007";
    case "LexHexEscapeNeedsTwoDigits":
    case "LexUnicodeEscapeNoOpeningBrace":
    case "LexUnicodeEscapeNoDigits":
    case "LexUnicodeEscapeNoClosingBrace":
    case "LexUnicodeEscapeTooManyDigits":
    case "LexUnicodeEscapeOutOfRange":
    case "LexUnicodeEscapeSurrogate":
    case "LexUnknownEscapeSequence":
      return "HEDGE-LEX-008";
    case "LexReadPastEnd":
      return "HEDGE-LEX-009";
    default:
      return assertNever(kind);
  }
}
