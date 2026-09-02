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
  | { readonly kind: "ParseStructUpdateUnsupportedInSemantics" }
  // Semantic analysis.
  | { readonly kind: "SemCannotFindName"; readonly name: string }
  | { readonly kind: "SemCannotFindType"; readonly name: string }
  | { readonly kind: "SemCannotFindTrait"; readonly name: string }
  | { readonly kind: "SemNameIsNotATrait"; readonly name: string }
  | { readonly kind: "SemCannotFindEnum"; readonly name: string }
  | { readonly kind: "SemCannotFindStruct"; readonly name: string }
  | {
      readonly kind: "SemDefinedMoreThanOnce";
      readonly itemKind: string;
      readonly name: string;
    }
  | { readonly kind: "SemConstCollidesWithFunction"; readonly name: string }
  | { readonly kind: "SemStaticCollidesWithConst"; readonly name: string }
  | { readonly kind: "SemStaticCollidesWithFunction"; readonly name: string }
  | {
      readonly kind: "SemFunctionTupleStructNamespaceClash";
      readonly name: string;
    }
  | {
      readonly kind: "SemNoFieldOnStruct";
      readonly field: string;
      readonly structName: string;
    }
  | {
      readonly kind: "SemNoFieldOnLabeled";
      readonly field: string;
      readonly label: string;
    }
  | {
      readonly kind: "SemUnknownFieldForStruct";
      readonly field: string;
      readonly structName: string;
    }
  | {
      readonly kind: "SemNoVariantOnEnum";
      readonly variant: string;
      readonly enumName: string;
    }
  | { readonly kind: "SemFieldSpecifiedMoreThanOnce"; readonly field: string }
  | { readonly kind: "SemSelfOutsideTraitOrImpl" }
  | { readonly kind: "SemGenericParamShadowsType"; readonly name: string }
  | { readonly kind: "SemBlanketImplGlobalScope"; readonly trait: string }
  | {
      readonly kind: "SemImplGlobalScope";
      readonly trait: string;
      readonly target: string;
    }
  | {
      readonly kind: "SemDeclarationShadowsOuter";
      readonly declKind: string;
      readonly name: string;
    }
  | { readonly kind: "SemTypeParamNeverUsed"; readonly name: string }
  | { readonly kind: "SemRefutableLetOrParamPattern" }
  | { readonly kind: "SemConstInitializerNotConstExpr"; readonly name: string }
  | { readonly kind: "SemConstDefinedInTermsOfItself"; readonly name: string }
  | { readonly kind: "SemConstDivideByZero" }
  | { readonly kind: "SemConstShiftOutOfRange" }
  | { readonly kind: "SemArrayLengthNotConstExpr" }
  | { readonly kind: "SemArrayLengthNotInteger" }
  | { readonly kind: "SemArrayLengthNegative" }
  | {
      readonly kind: "SemArrayLengthExceedsMax";
      readonly value: string;
      readonly max: string;
    }
  | { readonly kind: "SemConflictingImpls"; readonly trait: string }
  | {
      readonly kind: "SemConflictingImplsForType";
      readonly trait: string;
      readonly typeName: string;
    }
  | {
      readonly kind: "SemTraitAlreadyImplementedForType";
      readonly trait: string;
      readonly typeName: string;
    }
  | {
      readonly kind: "SemTraitBoundNotSatisfied";
      readonly typeName: string;
      readonly trait: string;
    }
  | {
      readonly kind: "SemImplMissingMethod";
      readonly trait: string;
      readonly target: string;
      readonly method: string;
    }
  | {
      readonly kind: "SemImplMissingAssociatedType";
      readonly trait: string;
      readonly target: string;
      readonly assocName: string;
    }
  | {
      readonly kind: "SemImplDefinesUndeclaredAssocType";
      readonly trait: string;
      readonly target: string;
      readonly assocName: string;
    }
  | {
      readonly kind: "SemAssocTypeNotFoundOnTrait";
      readonly assocName: string;
      readonly trait: string;
    }
  | {
      readonly kind: "SemAssocTypeNotFoundAmongBounds";
      readonly assocName: string;
      readonly baseName: string;
    }
  | {
      readonly kind: "SemAssocTypeNotFoundOnType";
      readonly assocName: string;
      readonly typeName: string;
    }
  | {
      readonly kind: "SemAssocTypeAmbiguous";
      readonly assocName: string;
      readonly traitList: string;
    }
  | {
      readonly kind: "SemTraitNotObjectSafe";
      readonly trait: string;
      readonly offender: string;
    }
  | { readonly kind: "SemQualifiedTypePathsUnsupported" }
  | { readonly kind: "SemGenericTypeParamNoArguments"; readonly name: string }
  | { readonly kind: "SemPatternKindNotYetSupported" }
  | { readonly kind: "SemWhileNotYetSupported" }
  | { readonly kind: "SemSignatureNoBodyTopLevel" }
  | { readonly kind: "SemSignatureNoBodyInBlock" }
  | { readonly kind: "SemTopLevelItemRestriction" }
  | { readonly kind: "SemStaticCannotBePub" }
  | {
      readonly kind: "SemConstInitializerTypeMismatch";
      readonly name: string;
      readonly declaredType: string;
    }
  | {
      readonly kind: "SemPatternTypeMismatch";
      readonly expected: string;
      readonly found: string;
    }
  | { readonly kind: "SemStaticTypeMismatch" }
  | { readonly kind: "SemMissingReturnValue"; readonly expected: string }
  | {
      readonly kind: "SemReturnTypeMismatch";
      readonly expected: string;
      readonly found: string;
    }
  | { readonly kind: "SemLetAnnotationMismatch" }
  | { readonly kind: "SemArrayIndexMustBeUsize"; readonly found: string }
  | {
      readonly kind: "SemStructFieldTypeMismatch";
      readonly field: string;
      readonly expected: string;
      readonly found: string;
    }
  | {
      readonly kind: "SemArgumentTypeMismatch";
      readonly argIndex: number;
      readonly calleeKind: string;
      readonly calleeName: string;
      readonly expected: string;
      readonly found: string;
    }
  // Same rendered text as SemArgumentTypeMismatch, but a generic-inference
  // conflict carries HEDGE-TYPE-010, not HEDGE-TYPE-001.
  | {
      readonly kind: "SemArgumentTypeMismatchConflict";
      readonly argIndex: number;
      readonly calleeKind: string;
      readonly calleeName: string;
      readonly expected: string;
      readonly found: string;
    }
  | {
      readonly kind: "SemCallReturnTypeMismatch";
      readonly calleeName: string;
      readonly expected: string;
      readonly found: string;
    }
  | { readonly kind: "SemLogicalOperandsMustBeBool" }
  | { readonly kind: "SemBitwiseRequiresInteger" }
  | {
      readonly kind: "SemArithmeticOperandNotNumeric";
      readonly side: "left" | "right";
      readonly found: string;
    }
  | { readonly kind: "SemShiftedValueMustBeInteger" }
  | { readonly kind: "SemShiftAmountMustBeInteger" }
  | { readonly kind: "SemNotRequiresBoolOrInteger"; readonly found: string }
  | { readonly kind: "SemRepeatArrayElementMustBeCopy"; readonly found: string }
  | { readonly kind: "SemIfConditionMustBeBool" }
  | {
      readonly kind: "SemComparisonNotSupported";
      readonly relation: "equality" | "ordering";
    }
  | { readonly kind: "SemComparisonOperandsSameType" }
  | { readonly kind: "SemArithmeticOperandsSameType" }
  | { readonly kind: "SemBitwiseOperandsSameType" }
  | {
      readonly kind: "SemArrayElementsSameType";
      readonly expected: string;
      readonly found: string;
    }
  | { readonly kind: "SemMatchArmsIncompatible" }
  | { readonly kind: "SemIfBranchesIncompatible" }
  | { readonly kind: "SemLiteralOutOfRange"; readonly typeName: string }
  | {
      readonly kind: "SemUnexpectedIntLiteralRangeCheck";
      readonly typeName: string;
    }
  | {
      readonly kind: "SemUnexpectedFloatLiteralRangeCheck";
      readonly typeName: string;
    }
  | {
      readonly kind: "SemArrayIndexOutOfBounds";
      readonly index: string;
      readonly length: string;
    }
  | { readonly kind: "SemCannotInferEmptyArrayElementType" }
  | { readonly kind: "SemCannotInferGenericParam"; readonly paramName: string }
  | { readonly kind: "SemCannotDereferenceNonReference" }
  | { readonly kind: "SemCannotIndexNonArray"; readonly found: string }
  | { readonly kind: "SemFieldAccessOnNonStruct" }
  | { readonly kind: "SemStructHasNamedFields"; readonly structName: string }
  | {
      readonly kind: "SemUnitStructCannotUseParens";
      readonly structName: string;
    }
  | {
      readonly kind: "SemFieldProvidedForUnitStruct";
      readonly field: string;
      readonly structName: string;
    }
  | {
      readonly kind: "SemMissingRequiredField";
      readonly field: string;
      readonly structName: string;
    }
  | {
      readonly kind: "SemVariantTakesNoArguments";
      readonly variant: string;
      readonly count: number;
    }
  | { readonly kind: "SemVariantHasNamedFields"; readonly variant: string }
  | {
      readonly kind: "SemVariantIsTupleVariantConstruct";
      readonly variant: string;
    }
  | {
      readonly kind: "SemVariantIsUnitVariantConstruct";
      readonly variant: string;
    }
  | {
      readonly kind: "SemConstructorArgCountMismatch";
      readonly calleeKind: string;
      readonly name: string;
      readonly expected: number;
      readonly count: number;
    }
  | {
      readonly kind: "SemTurbofishArgCountMismatch";
      readonly calleeName: string;
      readonly declared: number;
      readonly supplied: number;
    }
  | { readonly kind: "SemNonExhaustivePatterns"; readonly missing: string }
  | { readonly kind: "SemUnreachablePattern" }
  | {
      readonly kind: "SemOrPatternInconsistentNames";
      readonly names: string;
      readonly single: boolean;
    }
  | {
      readonly kind: "SemOrPatternInconsistentBinding";
      readonly name: string;
    }
  | { readonly kind: "SemVariantNotTupleVariant"; readonly variant: string }
  | { readonly kind: "SemVariantNotStructVariant"; readonly variant: string }
  | {
      readonly kind: "SemPatternExpectedStruct";
      readonly expected: string;
      readonly found: string;
    }
  | { readonly kind: "SemStructNotTupleStruct"; readonly name: string }
  | { readonly kind: "SemStructNoNamedFields"; readonly name: string }
  | { readonly kind: "SemVariantHasFieldsPattern"; readonly variant: string }
  | {
      readonly kind: "SemPatternFieldCountMismatch";
      readonly label: string;
      readonly fieldCount: number;
      readonly patternCount: number;
    }
  | { readonly kind: "SemSlicePatternMultipleRest"; readonly restCount: number }
  | {
      readonly kind: "SemSlicePatternLengthAtLeast";
      readonly length: number;
      readonly minCount: number;
    }
  | {
      readonly kind: "SemSlicePatternLengthExactly";
      readonly length: number;
      readonly exactCount: number;
    }
  | {
      readonly kind: "SemRangeBoundsSameType";
      readonly start: string;
      readonly end: string;
    }
  | {
      readonly kind: "SemRangeLowerGreaterThanUpper";
      readonly low: string;
      readonly high: string;
    }
  | {
      readonly kind: "SemCannotBindMutThroughSharedRef";
      readonly name: string;
    }
  | {
      readonly kind: "SemCannotBindMutPlaceNotMutable";
      readonly name: string;
    }
  | { readonly kind: "SemReturnsReferenceToLocal"; readonly name: string }
  | {
      readonly kind: "SemStructLiteralFieldBorrowsLocal";
      readonly field: string;
      readonly name: string;
    }
  | { readonly kind: "SemNotABorrowablePlace" }
  | { readonly kind: "SemCannotAssignToImmutableBinding" }
  | { readonly kind: "SemCannotAssignThroughSharedReference" }
  // Ownership analysis.
  | {
      readonly kind: "OwnBorrowMutThroughShared";
      readonly place: string;
      readonly through: string;
    }
  | { readonly kind: "OwnBorrowMutNotDeclaredMut"; readonly baseName: string }
  | {
      readonly kind: "OwnConflictingBorrows";
      readonly place: string;
      readonly first: string;
      readonly firstOffset: string;
      readonly second: string;
      readonly secondOffset: string;
    }
  | { readonly kind: "OwnUseOfUninitializedBinding"; readonly name: string }
  | { readonly kind: "OwnUseOfMovedValue"; readonly name: string }
  | { readonly kind: "OwnUseOfPossiblyMovedValue"; readonly name: string }
  | {
      readonly kind: "OwnUseOfPossiblyUninitializedBinding";
      readonly name: string;
    }
  | { readonly kind: "OwnCannotMoveOutBorrowInstead"; readonly place: string }
  | { readonly kind: "OwnCannotMoveOutOfReference"; readonly place: string }
  | { readonly kind: "OwnConditionalDropFlag"; readonly name: string }
  | { readonly kind: "OwnAmbiguousDrop"; readonly name: string };

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
export type RelatedLabelKind =
  | RawRelatedLabelKind
  | { readonly kind: "LabelMovedHere" }
  | { readonly kind: "LabelBorrowHere"; readonly borrow: string }
  | { readonly kind: "LabelShadowedDeclaration" }
  | { readonly kind: "LabelImplForThisDeclaration" }
  | { readonly kind: "LabelFirstImplementedHere" }
  | { readonly kind: "LabelInferredAsHere"; readonly typeName: string };

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
    case "SemCannotFindName":
    case "SemCannotFindType":
    case "SemCannotFindTrait":
    case "SemNameIsNotATrait":
    case "SemCannotFindEnum":
    case "SemCannotFindStruct":
      return "HEDGE-NAME-001";
    case "SemDefinedMoreThanOnce":
    case "SemConstCollidesWithFunction":
    case "SemStaticCollidesWithConst":
    case "SemStaticCollidesWithFunction":
    case "SemFunctionTupleStructNamespaceClash":
      return "HEDGE-NAME-002";
    case "SemNoFieldOnStruct":
    case "SemNoFieldOnLabeled":
    case "SemUnknownFieldForStruct":
      return "HEDGE-NAME-003";
    case "SemNoVariantOnEnum":
      return "HEDGE-NAME-004";
    case "SemFieldSpecifiedMoreThanOnce":
      return "HEDGE-NAME-005";
    case "SemSelfOutsideTraitOrImpl":
      return "HEDGE-NAME-006";
    case "SemGenericParamShadowsType":
      return "HEDGE-LINT-002";
    case "SemBlanketImplGlobalScope":
    case "SemImplGlobalScope":
      return "HEDGE-LINT-003";
    case "SemDeclarationShadowsOuter":
      return "HEDGE-LINT-004";
    case "SemTypeParamNeverUsed":
      return "HEDGE-TYPE-009";
    case "SemRefutableLetOrParamPattern":
      return "HEDGE-PATTERN-001";
    case "SemConstInitializerNotConstExpr":
      return "HEDGE-CONST-001";
    case "SemConstDefinedInTermsOfItself":
      return "HEDGE-CONST-002";
    case "SemConstDivideByZero":
    case "SemConstShiftOutOfRange":
      return "HEDGE-CONST-003";
    case "SemArrayLengthNotConstExpr":
    case "SemArrayLengthNotInteger":
    case "SemArrayLengthNegative":
    case "SemArrayLengthExceedsMax":
      return "HEDGE-CONST-004";
    case "SemConflictingImpls":
    case "SemConflictingImplsForType":
    case "SemTraitAlreadyImplementedForType":
      return "HEDGE-TRAIT-001";
    case "SemTraitBoundNotSatisfied":
      return "HEDGE-TRAIT-002";
    case "SemImplMissingMethod":
      return "HEDGE-TRAIT-003";
    case "SemImplMissingAssociatedType":
      return "HEDGE-TRAIT-004";
    case "SemAssocTypeNotFoundOnTrait":
    case "SemAssocTypeNotFoundAmongBounds":
    case "SemAssocTypeNotFoundOnType":
      return "HEDGE-TRAIT-005";
    case "SemAssocTypeAmbiguous":
      return "HEDGE-TRAIT-006";
    case "SemImplDefinesUndeclaredAssocType":
      return "HEDGE-TRAIT-007";
    case "SemTraitNotObjectSafe":
      return "HEDGE-TRAIT-008";
    case "SemQualifiedTypePathsUnsupported":
    case "SemGenericTypeParamNoArguments":
    case "SemPatternKindNotYetSupported":
    case "SemWhileNotYetSupported":
      return "HEDGE-UNSUPPORTED-001";
    case "SemSignatureNoBodyTopLevel":
    case "SemSignatureNoBodyInBlock":
    case "SemTopLevelItemRestriction":
    case "SemStaticCannotBePub":
      return "HEDGE-ITEM-001";
    case "SemConstInitializerTypeMismatch":
    case "SemPatternTypeMismatch":
    case "SemStaticTypeMismatch":
    case "SemMissingReturnValue":
    case "SemReturnTypeMismatch":
    case "SemLetAnnotationMismatch":
    case "SemArrayIndexMustBeUsize":
    case "SemStructFieldTypeMismatch":
    case "SemArgumentTypeMismatch":
      return "HEDGE-TYPE-001";
    case "SemArgumentTypeMismatchConflict":
    case "SemCallReturnTypeMismatch":
      return "HEDGE-TYPE-010";
    case "SemLogicalOperandsMustBeBool":
    case "SemBitwiseRequiresInteger":
    case "SemArithmeticOperandNotNumeric":
    case "SemShiftedValueMustBeInteger":
    case "SemShiftAmountMustBeInteger":
    case "SemNotRequiresBoolOrInteger":
    case "SemRepeatArrayElementMustBeCopy":
    case "SemIfConditionMustBeBool":
    case "SemComparisonNotSupported":
      return "HEDGE-TYPE-002";
    case "SemComparisonOperandsSameType":
    case "SemArithmeticOperandsSameType":
    case "SemBitwiseOperandsSameType":
    case "SemArrayElementsSameType":
      return "HEDGE-TYPE-003";
    case "SemMatchArmsIncompatible":
    case "SemIfBranchesIncompatible":
      return "HEDGE-TYPE-004";
    case "SemLiteralOutOfRange":
    case "SemUnexpectedIntLiteralRangeCheck":
    case "SemUnexpectedFloatLiteralRangeCheck":
    case "SemArrayIndexOutOfBounds":
      return "HEDGE-TYPE-005";
    case "SemCannotInferEmptyArrayElementType":
    case "SemCannotInferGenericParam":
      return "HEDGE-TYPE-006";
    case "SemCannotDereferenceNonReference":
    case "SemCannotIndexNonArray":
    case "SemFieldAccessOnNonStruct":
      return "HEDGE-TYPE-007";
    case "SemStructHasNamedFields":
    case "SemUnitStructCannotUseParens":
    case "SemFieldProvidedForUnitStruct":
    case "SemMissingRequiredField":
    case "SemVariantTakesNoArguments":
    case "SemVariantHasNamedFields":
    case "SemVariantIsTupleVariantConstruct":
    case "SemVariantIsUnitVariantConstruct":
    case "SemConstructorArgCountMismatch":
      return "HEDGE-TYPE-008";
    case "SemTurbofishArgCountMismatch":
      return "HEDGE-TYPE-011";
    case "SemNonExhaustivePatterns":
      return "HEDGE-PATTERN-002";
    case "SemUnreachablePattern":
      return "HEDGE-PATTERN-003";
    case "SemOrPatternInconsistentNames":
    case "SemOrPatternInconsistentBinding":
      return "HEDGE-PATTERN-004";
    case "SemVariantNotTupleVariant":
    case "SemVariantNotStructVariant":
    case "SemPatternExpectedStruct":
    case "SemStructNotTupleStruct":
    case "SemStructNoNamedFields":
    case "SemVariantHasFieldsPattern":
    case "SemPatternFieldCountMismatch":
    case "SemSlicePatternMultipleRest":
    case "SemSlicePatternLengthAtLeast":
    case "SemSlicePatternLengthExactly":
      return "HEDGE-PATTERN-005";
    case "SemRangeBoundsSameType":
    case "SemRangeLowerGreaterThanUpper":
      return "HEDGE-PATTERN-006";
    case "SemCannotBindMutThroughSharedRef":
    case "SemCannotBindMutPlaceNotMutable":
      return "HEDGE-PATTERN-007";
    case "SemReturnsReferenceToLocal":
    case "SemStructLiteralFieldBorrowsLocal":
      return "HEDGE-LIFETIME-002";
    case "SemNotABorrowablePlace":
      return "HEDGE-BORROW-CHECK-005";
    case "SemCannotAssignToImmutableBinding":
    case "SemCannotAssignThroughSharedReference":
      return "HEDGE-BORROW-CHECK-006";
    case "OwnConflictingBorrows":
      return "HEDGE-BORROW-CHECK-001";
    case "OwnBorrowMutThroughShared":
    case "OwnBorrowMutNotDeclaredMut":
      return "HEDGE-BORROW-CHECK-002";
    case "OwnUseOfMovedValue":
    case "OwnUseOfPossiblyMovedValue":
      return "HEDGE-BORROW-CHECK-003";
    case "OwnUseOfUninitializedBinding":
    case "OwnUseOfPossiblyUninitializedBinding":
      return "HEDGE-MOVE-001";
    case "OwnCannotMoveOutBorrowInstead":
    case "OwnCannotMoveOutOfReference":
      return "HEDGE-MOVE-002";
    case "OwnAmbiguousDrop":
      return "HEDGE-MOVE-003";
    case "OwnConditionalDropFlag":
      return "HEDGE-MOVE-004";
    default:
      return assertNever(kind);
  }
}
