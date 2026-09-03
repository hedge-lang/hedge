import type { DiagnosticCode } from "./code.js";

/**
 * A structured diagnostic: one variant per distinct message template, each
 * carrying only plain, already-rendered data (a name, a count, a type name
 * produced by `describeType` at the emission site). `code` is derived from
 * the variant by `codeOf`, so a call site can never pair a diagnostic with
 * the wrong code, and the English text lives solely in `message.ts`.
 */
export type DiagnosticKind =
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
  | { readonly kind: "SemSelfWithoutReceiver" }
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
  | {
      readonly kind: "SemNoMethodOnType";
      readonly method: string;
      readonly typeName: string;
    }
  | {
      readonly kind: "SemAmbiguousMethod";
      readonly method: string;
      readonly typeName: string;
      readonly traits: readonly string[];
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

/** The label on a diagnostic's secondary source location. */
export type RelatedLabelKind =
  | { readonly kind: "LabelMovedHere" }
  | { readonly kind: "LabelBorrowHere"; readonly borrow: string }
  | { readonly kind: "LabelShadowedDeclaration" }
  | { readonly kind: "LabelImplForThisDeclaration" }
  | { readonly kind: "LabelFirstImplementedHere" }
  | { readonly kind: "LabelInferredAsHere"; readonly typeName: string };

/**
 * `DiagnosticCode` for each `DiagnosticKind` variant. A lookup table, not a
 * switch: it carries no logic. A new variant needs an entry here alongside
 * its `message.ts` case (which the compiler forces) and its `kind.test.ts`
 * `SAMPLE_KINDS` entry - the registry test pins all three in sync.
 */
export const CODE_BY_KIND: ReadonlyMap<string, DiagnosticCode> = new Map<
  string,
  DiagnosticCode
>([
  ["LexUnterminatedStringLiteral", "HEDGE-LEX-001"],
  ["LexUnterminatedRawStringLiteral", "HEDGE-LEX-001"],
  ["LexUnterminatedCharLiteral", "HEDGE-LEX-002"],
  ["LexUnterminatedBlockComment", "HEDGE-LEX-003"],
  ["LexEmptyCharLiteral", "HEDGE-LEX-004"],
  ["LexUnexpectedCharacter", "HEDGE-LEX-005"],
  ["LexFloatExponentNoDigits", "HEDGE-LEX-006"],
  ["LexUnterminatedFloatLiteral", "HEDGE-LEX-006"],
  ["LexRadixLiteralNoDigits", "HEDGE-LEX-006"],
  ["LexRadixLiteralLeadingUnderscore", "HEDGE-LEX-006"],
  ["LexInvalidRadixDigit", "HEDGE-LEX-006"],
  ["LexRawIdentifierPrefixIncomplete", "HEDGE-LEX-007"],
  ["LexRawStringPrefixIncomplete", "HEDGE-LEX-007"],
  ["LexHexEscapeNeedsTwoDigits", "HEDGE-LEX-008"],
  ["LexUnicodeEscapeNoOpeningBrace", "HEDGE-LEX-008"],
  ["LexUnicodeEscapeNoDigits", "HEDGE-LEX-008"],
  ["LexUnicodeEscapeNoClosingBrace", "HEDGE-LEX-008"],
  ["LexUnicodeEscapeTooManyDigits", "HEDGE-LEX-008"],
  ["LexUnicodeEscapeOutOfRange", "HEDGE-LEX-008"],
  ["LexUnicodeEscapeSurrogate", "HEDGE-LEX-008"],
  ["LexUnknownEscapeSequence", "HEDGE-LEX-008"],
  ["LexReadPastEnd", "HEDGE-LEX-009"],
  ["ParseExpectedFound", "HEDGE-PARSE-001"],
  ["ParseExpectedKeyword", "HEDGE-PARSE-001"],
  ["ParseExpectedIdentifierFound", "HEDGE-PARSE-001"],
  ["ParseExpectedIdentifierAfterPathSep", "HEDGE-PARSE-001"],
  ["ParseExpectedBraceToStartBlockFound", "HEDGE-PARSE-001"],
  ["ParseExpectedColonAfterParamName", "HEDGE-PARSE-001"],
  ["ParseExpectedColonAfterFieldName", "HEDGE-PARSE-001"],
  ["ParseExpectedParenAfterMethodGenerics", "HEDGE-PARSE-001"],
  ["ParseExpectedCommaOrCloseAngleInGenericParams", "HEDGE-PARSE-001"],
  ["ParseExpectedStructBody", "HEDGE-PARSE-001"],
  ["ParseExpectedTraitBodyItem", "HEDGE-PARSE-001"],
  ["ParseExpectedSemiOrCloseBracketInArrayType", "HEDGE-PARSE-001"],
  ["ParseExpectedCommaOrCloseAngleInTypeArgs", "HEDGE-PARSE-001"],
  ["ParseExpectedNumericLiteralAfterMinusInPattern", "HEDGE-PARSE-001"],
  ["ParseExpectedLiteralAfterRangeInPattern", "HEDGE-PARSE-001"],
  ["ParseExpectedCommaOrParenInParens", "HEDGE-PARSE-001"],
  ["ParseExpectedSeparatorInArrayLiteral", "HEDGE-PARSE-001"],
  ["ParseExpectedIfOrBraceAfterElse", "HEDGE-PARSE-001"],
  ["ParseExpectedBraceToStartIfBody", "HEDGE-PARSE-001"],
  ["ParseExpectedBraceToStartWhileBody", "HEDGE-PARSE-001"],
  ["ParseExpectedArrowInMatchArm", "HEDGE-PARSE-001"],
  ["ParseExpectedCommaBetweenMatchArms", "HEDGE-PARSE-001"],
  ["ParseExpectedBraceAfterStructUpdate", "HEDGE-PARSE-001"],
  ["ParseExpectedBraceToCloseStructExpr", "HEDGE-PARSE-001"],
  ["ParseExpectedParenToCloseArgumentList", "HEDGE-PARSE-001"],
  ["ParseExpectedExpressionInBrackets", "HEDGE-PARSE-001"],
  ["ParseExpectedExpressionAfterInclusiveRange", "HEDGE-PARSE-001"],
  ["ParseExpectedBraceToCloseBlock", "HEDGE-PARSE-001"],
  ["ParseExpectedCommaOrParenAfterReceiver", "HEDGE-PARSE-001"],
  ["ParseUnexpectedEndOfInputAtToken", "HEDGE-PARSE-002"],
  ["ParseExpectedCloseBraceEofInBlock", "HEDGE-PARSE-002"],
  ["ParseExpectedBraceEofToOpenLoopBody", "HEDGE-PARSE-002"],
  ["ParseExpectedCloseBraceEofInMatch", "HEDGE-PARSE-002"],
  ["ParseUnterminatedAttributeArgumentList", "HEDGE-PARSE-002"],
  ["ParseExpectedCloseParenEofInType", "HEDGE-PARSE-002"],
  ["ParseGuardrailThen", "HEDGE-PARSE-002"],
  ["ParseCannotChainOperators", "HEDGE-PARSE-003"],
  ["ParseConstructNotSupported", "HEDGE-PARSE-004"],
  ["ParseLoopNotSupported", "HEDGE-PARSE-004"],
  ["ParseKeywordNotSupported", "HEDGE-PARSE-004"],
  ["ParseDeclarationKeywordNotSupported", "HEDGE-PARSE-004"],
  ["ParseAsyncNotSupported", "HEDGE-PARSE-004"],
  ["ParseMutReservedIdentifier", "HEDGE-PARSE-004"],
  ["ParseNeverTypeNotSupported", "HEDGE-PARSE-004"],
  ["ParseTupleTypeNotSupported", "HEDGE-PARSE-004"],
  ["ParseSliceTypeNotSupported", "HEDGE-PARSE-004"],
  ["ParseDynMustNameTrait", "HEDGE-PARSE-004"],
  ["ParsePubScopeNotSupported", "HEDGE-PARSE-004"],
  ["ParseExpectedType", "HEDGE-PARSE-004"],
  ["ParseStrayAngleBracket", "HEDGE-PARSE-005"],
  ["ParseUnexpectedItemKindInBlock", "HEDGE-PARSE-006"],
  ["ParseUnexpectedItemKindInImplBody", "HEDGE-PARSE-006"],
  ["ParseVisibilityNotAllowed", "HEDGE-PARSE-006"],
  ["ParseSigilOnPathPattern", "HEDGE-PARSE-006"],
  ["ParseSigilOnWildcardPattern", "HEDGE-PARSE-006"],
  ["ParseMutOnFieldlessPattern", "HEDGE-PARSE-006"],
  ["ElisionNoApplicableRule", "HEDGE-LIFETIME-001"],
  ["ElisionAmbiguousReturnLifetime", "HEDGE-LIFETIME-001"],
  ["ParseImmutableBindingNeverUsed", "HEDGE-LINT-001"],
  ["ParseStructUpdateUnsupportedInSemantics", "HEDGE-UNSUPPORTED-001"],
  ["SemCannotFindName", "HEDGE-NAME-001"],
  ["SemCannotFindType", "HEDGE-NAME-001"],
  ["SemCannotFindTrait", "HEDGE-NAME-001"],
  ["SemNameIsNotATrait", "HEDGE-NAME-001"],
  ["SemCannotFindEnum", "HEDGE-NAME-001"],
  ["SemCannotFindStruct", "HEDGE-NAME-001"],
  ["SemDefinedMoreThanOnce", "HEDGE-NAME-002"],
  ["SemConstCollidesWithFunction", "HEDGE-NAME-002"],
  ["SemStaticCollidesWithConst", "HEDGE-NAME-002"],
  ["SemStaticCollidesWithFunction", "HEDGE-NAME-002"],
  ["SemFunctionTupleStructNamespaceClash", "HEDGE-NAME-002"],
  ["SemNoFieldOnStruct", "HEDGE-NAME-003"],
  ["SemNoFieldOnLabeled", "HEDGE-NAME-003"],
  ["SemUnknownFieldForStruct", "HEDGE-NAME-003"],
  ["SemNoVariantOnEnum", "HEDGE-NAME-004"],
  ["SemFieldSpecifiedMoreThanOnce", "HEDGE-NAME-005"],
  ["SemSelfOutsideTraitOrImpl", "HEDGE-NAME-006"],
  ["SemSelfWithoutReceiver", "HEDGE-NAME-007"],
  ["SemGenericParamShadowsType", "HEDGE-LINT-002"],
  ["SemBlanketImplGlobalScope", "HEDGE-LINT-003"],
  ["SemImplGlobalScope", "HEDGE-LINT-003"],
  ["SemDeclarationShadowsOuter", "HEDGE-LINT-004"],
  ["SemTypeParamNeverUsed", "HEDGE-TYPE-009"],
  ["SemRefutableLetOrParamPattern", "HEDGE-PATTERN-001"],
  ["SemConstInitializerNotConstExpr", "HEDGE-CONST-001"],
  ["SemConstDefinedInTermsOfItself", "HEDGE-CONST-002"],
  ["SemConstDivideByZero", "HEDGE-CONST-003"],
  ["SemConstShiftOutOfRange", "HEDGE-CONST-003"],
  ["SemArrayLengthNotConstExpr", "HEDGE-CONST-004"],
  ["SemArrayLengthNotInteger", "HEDGE-CONST-004"],
  ["SemArrayLengthNegative", "HEDGE-CONST-004"],
  ["SemArrayLengthExceedsMax", "HEDGE-CONST-004"],
  ["SemConflictingImpls", "HEDGE-TRAIT-001"],
  ["SemConflictingImplsForType", "HEDGE-TRAIT-001"],
  ["SemTraitAlreadyImplementedForType", "HEDGE-TRAIT-001"],
  ["SemTraitBoundNotSatisfied", "HEDGE-TRAIT-002"],
  ["SemImplMissingMethod", "HEDGE-TRAIT-003"],
  ["SemImplMissingAssociatedType", "HEDGE-TRAIT-004"],
  ["SemAssocTypeNotFoundOnTrait", "HEDGE-TRAIT-005"],
  ["SemAssocTypeNotFoundAmongBounds", "HEDGE-TRAIT-005"],
  ["SemAssocTypeNotFoundOnType", "HEDGE-TRAIT-005"],
  ["SemAssocTypeAmbiguous", "HEDGE-TRAIT-006"],
  ["SemImplDefinesUndeclaredAssocType", "HEDGE-TRAIT-007"],
  ["SemTraitNotObjectSafe", "HEDGE-TRAIT-008"],
  ["SemQualifiedTypePathsUnsupported", "HEDGE-UNSUPPORTED-001"],
  ["SemGenericTypeParamNoArguments", "HEDGE-UNSUPPORTED-001"],
  ["SemPatternKindNotYetSupported", "HEDGE-UNSUPPORTED-001"],
  ["SemWhileNotYetSupported", "HEDGE-UNSUPPORTED-001"],
  ["SemSignatureNoBodyTopLevel", "HEDGE-ITEM-001"],
  ["SemSignatureNoBodyInBlock", "HEDGE-ITEM-001"],
  ["SemTopLevelItemRestriction", "HEDGE-ITEM-001"],
  ["SemStaticCannotBePub", "HEDGE-ITEM-001"],
  ["SemConstInitializerTypeMismatch", "HEDGE-TYPE-001"],
  ["SemPatternTypeMismatch", "HEDGE-TYPE-001"],
  ["SemStaticTypeMismatch", "HEDGE-TYPE-001"],
  ["SemMissingReturnValue", "HEDGE-TYPE-001"],
  ["SemReturnTypeMismatch", "HEDGE-TYPE-001"],
  ["SemLetAnnotationMismatch", "HEDGE-TYPE-001"],
  ["SemArrayIndexMustBeUsize", "HEDGE-TYPE-001"],
  ["SemStructFieldTypeMismatch", "HEDGE-TYPE-001"],
  ["SemArgumentTypeMismatch", "HEDGE-TYPE-001"],
  ["SemArgumentTypeMismatchConflict", "HEDGE-TYPE-010"],
  ["SemCallReturnTypeMismatch", "HEDGE-TYPE-010"],
  ["SemNoMethodOnType", "HEDGE-TYPE-012"],
  ["SemAmbiguousMethod", "HEDGE-TYPE-013"],
  ["SemLogicalOperandsMustBeBool", "HEDGE-TYPE-002"],
  ["SemBitwiseRequiresInteger", "HEDGE-TYPE-002"],
  ["SemArithmeticOperandNotNumeric", "HEDGE-TYPE-002"],
  ["SemShiftedValueMustBeInteger", "HEDGE-TYPE-002"],
  ["SemShiftAmountMustBeInteger", "HEDGE-TYPE-002"],
  ["SemNotRequiresBoolOrInteger", "HEDGE-TYPE-002"],
  ["SemRepeatArrayElementMustBeCopy", "HEDGE-TYPE-002"],
  ["SemIfConditionMustBeBool", "HEDGE-TYPE-002"],
  ["SemComparisonNotSupported", "HEDGE-TYPE-002"],
  ["SemComparisonOperandsSameType", "HEDGE-TYPE-003"],
  ["SemArithmeticOperandsSameType", "HEDGE-TYPE-003"],
  ["SemBitwiseOperandsSameType", "HEDGE-TYPE-003"],
  ["SemArrayElementsSameType", "HEDGE-TYPE-003"],
  ["SemMatchArmsIncompatible", "HEDGE-TYPE-004"],
  ["SemIfBranchesIncompatible", "HEDGE-TYPE-004"],
  ["SemLiteralOutOfRange", "HEDGE-TYPE-005"],
  ["SemUnexpectedIntLiteralRangeCheck", "HEDGE-TYPE-005"],
  ["SemUnexpectedFloatLiteralRangeCheck", "HEDGE-TYPE-005"],
  ["SemArrayIndexOutOfBounds", "HEDGE-TYPE-005"],
  ["SemCannotInferEmptyArrayElementType", "HEDGE-TYPE-006"],
  ["SemCannotInferGenericParam", "HEDGE-TYPE-006"],
  ["SemCannotDereferenceNonReference", "HEDGE-TYPE-007"],
  ["SemCannotIndexNonArray", "HEDGE-TYPE-007"],
  ["SemFieldAccessOnNonStruct", "HEDGE-TYPE-007"],
  ["SemStructHasNamedFields", "HEDGE-TYPE-008"],
  ["SemUnitStructCannotUseParens", "HEDGE-TYPE-008"],
  ["SemFieldProvidedForUnitStruct", "HEDGE-TYPE-008"],
  ["SemMissingRequiredField", "HEDGE-TYPE-008"],
  ["SemVariantTakesNoArguments", "HEDGE-TYPE-008"],
  ["SemVariantHasNamedFields", "HEDGE-TYPE-008"],
  ["SemVariantIsTupleVariantConstruct", "HEDGE-TYPE-008"],
  ["SemVariantIsUnitVariantConstruct", "HEDGE-TYPE-008"],
  ["SemConstructorArgCountMismatch", "HEDGE-TYPE-008"],
  ["SemTurbofishArgCountMismatch", "HEDGE-TYPE-011"],
  ["SemNonExhaustivePatterns", "HEDGE-PATTERN-002"],
  ["SemUnreachablePattern", "HEDGE-PATTERN-003"],
  ["SemOrPatternInconsistentNames", "HEDGE-PATTERN-004"],
  ["SemOrPatternInconsistentBinding", "HEDGE-PATTERN-004"],
  ["SemVariantNotTupleVariant", "HEDGE-PATTERN-005"],
  ["SemVariantNotStructVariant", "HEDGE-PATTERN-005"],
  ["SemPatternExpectedStruct", "HEDGE-PATTERN-005"],
  ["SemStructNotTupleStruct", "HEDGE-PATTERN-005"],
  ["SemStructNoNamedFields", "HEDGE-PATTERN-005"],
  ["SemVariantHasFieldsPattern", "HEDGE-PATTERN-005"],
  ["SemPatternFieldCountMismatch", "HEDGE-PATTERN-005"],
  ["SemSlicePatternMultipleRest", "HEDGE-PATTERN-005"],
  ["SemSlicePatternLengthAtLeast", "HEDGE-PATTERN-005"],
  ["SemSlicePatternLengthExactly", "HEDGE-PATTERN-005"],
  ["SemRangeBoundsSameType", "HEDGE-PATTERN-006"],
  ["SemRangeLowerGreaterThanUpper", "HEDGE-PATTERN-006"],
  ["SemCannotBindMutThroughSharedRef", "HEDGE-PATTERN-007"],
  ["SemCannotBindMutPlaceNotMutable", "HEDGE-PATTERN-007"],
  ["SemReturnsReferenceToLocal", "HEDGE-LIFETIME-002"],
  ["SemStructLiteralFieldBorrowsLocal", "HEDGE-LIFETIME-002"],
  ["SemNotABorrowablePlace", "HEDGE-BORROW-CHECK-005"],
  ["SemCannotAssignToImmutableBinding", "HEDGE-BORROW-CHECK-006"],
  ["SemCannotAssignThroughSharedReference", "HEDGE-BORROW-CHECK-006"],
  ["OwnConflictingBorrows", "HEDGE-BORROW-CHECK-001"],
  ["OwnBorrowMutThroughShared", "HEDGE-BORROW-CHECK-002"],
  ["OwnBorrowMutNotDeclaredMut", "HEDGE-BORROW-CHECK-002"],
  ["OwnUseOfMovedValue", "HEDGE-BORROW-CHECK-003"],
  ["OwnUseOfPossiblyMovedValue", "HEDGE-BORROW-CHECK-003"],
  ["OwnUseOfUninitializedBinding", "HEDGE-MOVE-001"],
  ["OwnUseOfPossiblyUninitializedBinding", "HEDGE-MOVE-001"],
  ["OwnCannotMoveOutBorrowInstead", "HEDGE-MOVE-002"],
  ["OwnCannotMoveOutOfReference", "HEDGE-MOVE-002"],
  ["OwnAmbiguousDrop", "HEDGE-MOVE-003"],
  ["OwnConditionalDropFlag", "HEDGE-MOVE-004"],
]);

export function codeOf(kind: DiagnosticKind): DiagnosticCode {
  const code = CODE_BY_KIND.get(kind.kind);
  if (code === undefined) {
    throw new Error(`ICE: no diagnostic code registered for ${kind.kind}`);
  }
  return code;
}
