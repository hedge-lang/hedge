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
    }
  // Parsing.
  | {
      readonly kind: "ParseExpectedFound";
      readonly expected: string;
      readonly found: string;
      readonly offset: number;
    }
  | {
      readonly kind: "ParseExpectedKeyword";
      readonly keyword: string;
      readonly found: string;
      readonly offset: number;
    }
  | {
      readonly kind: "ParseExpectedIdentifierFound";
      readonly found: string;
      readonly offset: number;
    }
  | {
      readonly kind: "ParseExpectedIdentifierAfterPathSep";
      readonly found: string;
    }
  | {
      readonly kind: "ParseExpectedBraceToStartBlockFound";
      readonly found: string;
    }
  | { readonly kind: "ParseExpectedColonAfterParamName"; readonly name: string }
  | { readonly kind: "ParseExpectedColonAfterFieldName"; readonly name: string }
  | {
      readonly kind: "ParseExpectedParenAfterMethodGenerics";
      readonly found: string;
    }
  | {
      readonly kind: "ParseExpectedCommaOrCloseAngleInGenericParams";
      readonly found: string;
    }
  | { readonly kind: "ParseExpectedStructBody"; readonly found: string }
  | { readonly kind: "ParseExpectedTraitBodyItem"; readonly found: string }
  | {
      readonly kind: "ParseExpectedSemiOrCloseBracketInArrayType";
      readonly found: string;
    }
  | {
      readonly kind: "ParseExpectedCommaOrCloseAngleInTypeArgs";
      readonly found: string;
    }
  | {
      readonly kind: "ParseExpectedNumericLiteralAfterMinusInPattern";
      readonly found: string;
    }
  | {
      readonly kind: "ParseExpectedLiteralAfterRangeInPattern";
      readonly found: string;
    }
  | { readonly kind: "ParseExpectedCommaOrParenInParens" }
  | { readonly kind: "ParseExpectedSeparatorInArrayLiteral" }
  | { readonly kind: "ParseExpectedIfOrBraceAfterElse" }
  | { readonly kind: "ParseExpectedBraceToStartIfBody" }
  | { readonly kind: "ParseExpectedBraceToStartWhileBody" }
  | { readonly kind: "ParseExpectedArrowInMatchArm" }
  | { readonly kind: "ParseExpectedCommaBetweenMatchArms" }
  | { readonly kind: "ParseExpectedBraceAfterStructUpdate" }
  | { readonly kind: "ParseExpectedBraceToCloseStructExpr" }
  | { readonly kind: "ParseExpectedParenToCloseArgumentList" }
  | { readonly kind: "ParseExpectedExpressionInBrackets" }
  | { readonly kind: "ParseExpectedExpressionAfterInclusiveRange" }
  | { readonly kind: "ParseExpectedBraceToCloseBlock" }
  | { readonly kind: "ParseExpectedCommaOrParenAfterReceiver" }
  | {
      readonly kind: "ParseUnexpectedEndOfInputAtToken";
      readonly token: number;
    }
  | { readonly kind: "ParseExpectedCloseBraceEofInBlock" }
  | { readonly kind: "ParseExpectedBraceEofToOpenLoopBody" }
  | { readonly kind: "ParseExpectedCloseBraceEofInMatch" }
  | { readonly kind: "ParseUnterminatedAttributeArgumentList" }
  | { readonly kind: "ParseExpectedCloseParenEofInType" }
  | {
      readonly kind: "ParseGuardrailThen";
      readonly guardrail: string;
      readonly rest: string;
    }
  | {
      readonly kind: "ParseCannotChainOperators";
      readonly left: string;
      readonly right: string;
    }
  | { readonly kind: "ParseConstructNotSupported"; readonly construct: string }
  | { readonly kind: "ParseLoopNotSupported"; readonly keyword: string }
  | { readonly kind: "ParseKeywordNotSupported"; readonly keyword: string }
  | {
      readonly kind: "ParseDeclarationKeywordNotSupported";
      readonly keyword: string;
    }
  | { readonly kind: "ParseAsyncNotSupported" }
  | { readonly kind: "ParseMutReservedIdentifier" }
  | { readonly kind: "ParseNeverTypeNotSupported" }
  | { readonly kind: "ParseTupleTypeNotSupported" }
  | { readonly kind: "ParseSliceTypeNotSupported" }
  | { readonly kind: "ParseDynMustNameTrait" }
  | { readonly kind: "ParsePubScopeNotSupported"; readonly scope: string }
  | { readonly kind: "ParseExpectedType"; readonly found: string }
  | { readonly kind: "ElisionNoApplicableRule" }
  | {
      readonly kind: "ElisionAmbiguousReturnLifetime";
      readonly referenceParamCount: number;
    }
  | { readonly kind: "ParseStrayAngleBracket"; readonly context: string }
  | {
      readonly kind: "ParseUnexpectedItemKindInBlock";
      readonly itemKind: string;
    }
  | {
      readonly kind: "ParseUnexpectedItemKindInImplBody";
      readonly itemKind: string;
    }
  | { readonly kind: "ParseVisibilityNotAllowed"; readonly location: string }
  | { readonly kind: "ParseSigilOnPathPattern" }
  | { readonly kind: "ParseSigilOnWildcardPattern"; readonly byRef: boolean }
  | { readonly kind: "ParseMutOnFieldlessPattern" }
  | { readonly kind: "ParseImmutableBindingNeverUsed" }
  | { readonly kind: "ParseStructUpdateUnsupportedInSemantics" };

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
    case "ParseExpectedFound":
    case "ParseExpectedKeyword":
    case "ParseExpectedIdentifierFound":
    case "ParseExpectedIdentifierAfterPathSep":
    case "ParseExpectedBraceToStartBlockFound":
    case "ParseExpectedColonAfterParamName":
    case "ParseExpectedColonAfterFieldName":
    case "ParseExpectedParenAfterMethodGenerics":
    case "ParseExpectedCommaOrCloseAngleInGenericParams":
    case "ParseExpectedStructBody":
    case "ParseExpectedTraitBodyItem":
    case "ParseExpectedSemiOrCloseBracketInArrayType":
    case "ParseExpectedCommaOrCloseAngleInTypeArgs":
    case "ParseExpectedNumericLiteralAfterMinusInPattern":
    case "ParseExpectedLiteralAfterRangeInPattern":
    case "ParseExpectedCommaOrParenInParens":
    case "ParseExpectedSeparatorInArrayLiteral":
    case "ParseExpectedIfOrBraceAfterElse":
    case "ParseExpectedBraceToStartIfBody":
    case "ParseExpectedBraceToStartWhileBody":
    case "ParseExpectedArrowInMatchArm":
    case "ParseExpectedCommaBetweenMatchArms":
    case "ParseExpectedBraceAfterStructUpdate":
    case "ParseExpectedBraceToCloseStructExpr":
    case "ParseExpectedParenToCloseArgumentList":
    case "ParseExpectedExpressionInBrackets":
    case "ParseExpectedExpressionAfterInclusiveRange":
    case "ParseExpectedBraceToCloseBlock":
    case "ParseExpectedCommaOrParenAfterReceiver":
      return "HEDGE-PARSE-001";
    case "ParseUnexpectedEndOfInputAtToken":
    case "ParseExpectedCloseBraceEofInBlock":
    case "ParseExpectedBraceEofToOpenLoopBody":
    case "ParseExpectedCloseBraceEofInMatch":
    case "ParseUnterminatedAttributeArgumentList":
    case "ParseExpectedCloseParenEofInType":
    case "ParseGuardrailThen":
      return "HEDGE-PARSE-002";
    case "ParseCannotChainOperators":
      return "HEDGE-PARSE-003";
    case "ParseConstructNotSupported":
    case "ParseLoopNotSupported":
    case "ParseKeywordNotSupported":
    case "ParseDeclarationKeywordNotSupported":
    case "ParseAsyncNotSupported":
    case "ParseMutReservedIdentifier":
    case "ParseNeverTypeNotSupported":
    case "ParseTupleTypeNotSupported":
    case "ParseSliceTypeNotSupported":
    case "ParseDynMustNameTrait":
    case "ParsePubScopeNotSupported":
    case "ParseExpectedType":
      return "HEDGE-PARSE-004";
    case "ParseStrayAngleBracket":
      return "HEDGE-PARSE-005";
    case "ParseUnexpectedItemKindInBlock":
    case "ParseUnexpectedItemKindInImplBody":
    case "ParseVisibilityNotAllowed":
    case "ParseSigilOnPathPattern":
    case "ParseSigilOnWildcardPattern":
    case "ParseMutOnFieldlessPattern":
      return "HEDGE-PARSE-006";
    case "ElisionNoApplicableRule":
    case "ElisionAmbiguousReturnLifetime":
      return "HEDGE-LIFETIME-001";
    case "ParseImmutableBindingNeverUsed":
      return "HEDGE-LINT-001";
    case "ParseStructUpdateUnsupportedInSemantics":
      return "HEDGE-UNSUPPORTED-001";
    default:
      return assertNever(kind);
  }
}
