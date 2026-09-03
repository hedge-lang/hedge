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
      return String.raw`hex escape \x needs exactly 2 hex digits at offset ${kind.offset}`;
    case "LexUnicodeEscapeNoOpeningBrace":
      return String.raw`unicode escape \u must be followed by '{' at offset ${kind.offset}`;
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
    case "ParseExpectedFound":
      return `Expected ${kind.expected}, found "${kind.found}" at offset ${kind.offset}`;
    case "ParseExpectedKeyword":
      return `Expected keyword "${kind.keyword}", found "${kind.found}" at offset ${kind.offset}`;
    case "ParseExpectedIdentifierFound":
      return `Expected an identifier, found ${kind.found} at offset ${kind.offset}`;
    case "ParseExpectedIdentifierAfterPathSep":
      return `Expected identifier after "::", found ${kind.found}`;
    case "ParseExpectedBraceToStartBlockFound":
      return `expected \`{\` to start block, found \`${kind.found}\``;
    case "ParseExpectedColonAfterParamName":
      return `expected ':' after parameter name '${kind.name}'`;
    case "ParseExpectedColonAfterFieldName":
      return `expected ':' after field name '${kind.name}'`;
    case "ParseExpectedParenAfterMethodGenerics":
      return `expected '(' after generic arguments in method position, found "${kind.found}"`;
    case "ParseExpectedCommaOrCloseAngleInGenericParams":
      return `expected ',' or '>' in generic parameter list, found "${kind.found}"`;
    case "ParseExpectedStructBody":
      return `expected struct body (\`{\`, \`(\`, or \`;\`), found "${kind.found}"`;
    case "ParseExpectedTraitBodyItem":
      return `expected a function, associated type, or const in trait body, found ${kind.found}`;
    case "ParseExpectedSemiOrCloseBracketInArrayType":
      return `expected ';' or ']' in array type, found "${kind.found}"`;
    case "ParseExpectedCommaOrCloseAngleInTypeArgs":
      return `expected ',' or '>' in type argument list, found "${kind.found}"`;
    case "ParseExpectedNumericLiteralAfterMinusInPattern":
      return `Expected a numeric literal after "-" in a pattern, found ${kind.found}`;
    case "ParseExpectedLiteralAfterRangeInPattern":
      return `Expected a literal after "..=" in a range pattern, found ${kind.found}`;
    case "ParseExpectedCommaOrParenInParens":
      return "Expected ',' or ')' after expression in parentheses";
    case "ParseExpectedSeparatorInArrayLiteral":
      return "Expected ',', ';', or ']' after expression in array literal";
    case "ParseExpectedIfOrBraceAfterElse":
      return "Expected 'if' or '{' after 'else'";
    case "ParseExpectedBraceToStartIfBody":
      return "Expected '{' to start if body";
    case "ParseExpectedBraceToStartWhileBody":
      return "Expected '{' to start while body";
    case "ParseExpectedArrowInMatchArm":
      return "Expected '=>' in match arm";
    case "ParseExpectedCommaBetweenMatchArms":
      return "Expected ',' between match arms";
    case "ParseExpectedBraceAfterStructUpdate":
      return "Expected '}' after struct update expression; spread must be last";
    case "ParseExpectedBraceToCloseStructExpr":
      return "Expected '}' to close struct expression";
    case "ParseExpectedParenToCloseArgumentList":
      return "Expected ')' to close argument list";
    case "ParseExpectedExpressionInBrackets":
      return "Expected an expression inside '[...]'";
    case "ParseExpectedExpressionAfterInclusiveRange":
      return "Expected an expression after '..='";
    case "ParseExpectedBraceToCloseBlock":
      return "Expected '}' to close block";
    case "ParseExpectedCommaOrParenAfterReceiver":
      return "expected ',' or ')' after receiver";
    case "ParseUnexpectedEndOfInputAtToken":
      return `Unexpected end of input at token ${kind.token}`;
    case "ParseExpectedCloseBraceEofInBlock":
      return "expected `}` to close block, found end of input";
    case "ParseExpectedBraceEofToOpenLoopBody":
      return "expected `{` to open loop body, found end of input";
    case "ParseExpectedCloseBraceEofInMatch":
      return "Expected '}' to close match expression, found end of input";
    case "ParseUnterminatedAttributeArgumentList":
      return "unterminated attribute argument list";
    case "ParseExpectedCloseParenEofInType":
      return "expected `)` to close type, found end of input";
    case "ParseGuardrailThen":
      return `${kind.guardrail}; ${kind.rest}`;
    case "ParseCannotChainOperators":
      return `cannot chain '${kind.left}' with '${kind.right}'`;
    case "ParseConstructNotSupported":
      return `${kind.construct} are not yet supported`;
    case "ParseLoopNotSupported":
      return kind.keyword === "loop"
        ? "`loop` expressions are not yet supported"
        : `\`${kind.keyword}\` loops are not yet supported`;
    case "ParseKeywordNotSupported":
      return `\`${kind.keyword}\` is not yet supported`;
    case "ParseDeclarationKeywordNotSupported":
      return `\`${kind.keyword}\` declarations are not yet supported`;
    case "ParseAsyncNotSupported":
      return "`async` is not yet supported";
    case "ParseMutReservedIdentifier":
      return "The keyword `mut` is reserved and cannot be used as an identifier. For a mutable binding, use `let mut`; for a mutable borrow, use `&mut`.";
    case "ParseNeverTypeNotSupported":
      return "the never type (`!`) is not yet supported";
    case "ParseTupleTypeNotSupported":
      return "tuple types are not yet supported";
    case "ParseSliceTypeNotSupported":
      return "slice types (`[T]`) are not yet supported";
    case "ParseDynMustNameTrait":
      return "`dyn` must name a trait, not a lifetime";
    case "ParsePubScopeNotSupported":
      return `\`pub(${kind.scope})\` visibility is not yet supported`;
    case "ParseExpectedType":
      return `expected a type, found \`${kind.found}\``;
    case "ElisionNoApplicableRule":
      return (
        "missing lifetime specifier: a reference with no applicable elision rule " +
        "needs an explicit lifetime annotation (this applies to struct fields, " +
        "let annotations, and references nested inside another reference)"
      );
    case "ElisionAmbiguousReturnLifetime":
      return (
        "missing lifetime specifier: the return type borrows a reference, but " +
        `the signature has ${kind.referenceParamCount} reference parameters, so the ` +
        "compiler cannot infer which one it borrows from; add explicit " +
        "lifetime parameters (e.g. fn f<'a>(x: &'a T) -> &'a T)"
      );
    case "ParseStrayAngleBracket":
      return `unexpected extra '>' after ${kind.context}`;
    case "ParseUnexpectedItemKindInBlock":
      return `unexpected item kind '${kind.itemKind}' in block position`;
    case "ParseUnexpectedItemKindInImplBody":
      return `unexpected item kind '${kind.itemKind}' in impl body`;
    case "ParseVisibilityNotAllowed":
      return `visibility qualifiers are not allowed ${kind.location}`;
    case "ParseSigilOnPathPattern":
      return "`mut`/`&`/`&mut` sigils cannot be applied to a struct, tuple-struct, or path pattern";
    case "ParseSigilOnWildcardPattern":
      return kind.byRef
        ? "`&`/`&mut` cannot be applied to the wildcard pattern `_`"
        : "`mut` cannot be applied to the wildcard pattern `_`";
    case "ParseMutOnFieldlessPattern":
      return "`mut` cannot be applied to a fieldless pattern like a bare unit variant";
    case "ParseImmutableBindingNeverUsed":
      return "immutable binding declared without a value can never be used";
    case "ParseStructUpdateUnsupportedInSemantics":
      return "struct update expression (`..base`) is not yet supported in semantic analysis";
    case "SemCannotFindName":
      return `Cannot find name "${kind.name}" in this scope.`;
    case "SemCannotFindType":
      return `cannot find type \`${kind.name}\` in this scope`;
    case "SemCannotFindTrait":
      return `cannot find trait \`${kind.name}\` in this scope`;
    case "SemNameIsNotATrait":
      return `\`${kind.name}\` is not a trait`;
    case "SemCannotFindEnum":
      return `cannot find enum \`${kind.name}\` in this scope`;
    case "SemCannotFindStruct":
      return `cannot find struct \`${kind.name}\` in this scope`;
    case "SemDefinedMoreThanOnce":
      return `${kind.itemKind} \`${kind.name}\` is defined more than once`;
    case "SemConstCollidesWithFunction":
      return `const \`${kind.name}\` collides with an existing function name`;
    case "SemStaticCollidesWithConst":
      return `static \`${kind.name}\` collides with a const of the same name`;
    case "SemStaticCollidesWithFunction":
      return `static \`${kind.name}\` collides with an existing function name`;
    case "SemFunctionTupleStructNamespaceClash":
      return `\`${kind.name}\` is defined multiple times: a function and a tuple struct constructor share the value namespace`;
    case "SemNoFieldOnStruct":
      return `no field \`${kind.field}\` on struct \`${kind.structName}\``;
    case "SemNoFieldOnLabeled":
      return `no field \`${kind.field}\` on ${kind.label}`;
    case "SemUnknownFieldForStruct":
      return `unknown field \`${kind.field}\` for struct \`${kind.structName}\``;
    case "SemNoVariantOnEnum":
      return `no variant \`${kind.variant}\` on enum \`${kind.enumName}\``;
    case "SemFieldSpecifiedMoreThanOnce":
      return `field \`${kind.field}\` specified more than once in struct literal`;
    case "SemSelfOutsideTraitOrImpl":
      return "`Self` can only be used inside a trait or impl block";
    case "SemSelfWithoutReceiver":
      return "`self` is only valid in a method that has a `self` receiver";
    case "SemGenericParamShadowsType":
      return `generic parameter \`${kind.name}\` shadows an existing type of the same name`;
    case "SemBlanketImplGlobalScope":
      return `blanket impl of trait \`${kind.trait}\` takes effect everywhere in the program, not just this scope`;
    case "SemImplGlobalScope":
      return `impl of trait \`${kind.trait}\` for \`${kind.target}\` takes effect everywhere in the program, not just this scope`;
    case "SemDeclarationShadowsOuter":
      return `${kind.declKind} \`${kind.name}\` shadows an outer declaration of the same name`;
    case "SemTypeParamNeverUsed":
      return `type parameter \`${kind.name}\` is declared but never used`;
    case "SemRefutableLetOrParamPattern":
      return "refutable patterns are not allowed in `let`/parameter position; use `if let` for a pattern that might not match";
    case "SemConstInitializerNotConstExpr":
      return `const \`${kind.name}\`'s initializer must be a compile-time constant expression`;
    case "SemConstDefinedInTermsOfItself":
      return `const \`${kind.name}\` cannot be defined in terms of itself`;
    case "SemConstDivideByZero":
      return "attempt to divide by zero in a constant expression";
    case "SemConstShiftOutOfRange":
      return "shift amount must be between 0 and 63 in a constant expression";
    case "SemArrayLengthNotConstExpr":
      return "array length must be a compile-time constant expression";
    case "SemArrayLengthNotInteger":
      return "array length must be an integer";
    case "SemArrayLengthNegative":
      return "array length cannot be negative";
    case "SemArrayLengthExceedsMax":
      return `array length ${kind.value} exceeds the maximum ${kind.max}`;
    case "SemConflictingImpls":
      return `conflicting implementations of trait \`${kind.trait}\``;
    case "SemConflictingImplsForType":
      return `conflicting implementations of trait \`${kind.trait}\` for type \`${kind.typeName}\``;
    case "SemTraitAlreadyImplementedForType":
      return `trait \`${kind.trait}\` is already implemented for type \`${kind.typeName}\``;
    case "SemTraitBoundNotSatisfied":
      return `the trait bound \`${kind.typeName}: ${kind.trait}\` is not satisfied`;
    case "SemImplMissingMethod":
      return `impl of trait \`${kind.trait}\` for \`${kind.target}\` is missing method \`${kind.method}\``;
    case "SemImplMissingAssociatedType":
      return `impl of trait \`${kind.trait}\` for \`${kind.target}\` is missing associated type \`${kind.assocName}\``;
    case "SemImplDefinesUndeclaredAssocType":
      return `impl of trait \`${kind.trait}\` for \`${kind.target}\` defines associated type \`${kind.assocName}\`, which trait \`${kind.trait}\` does not declare`;
    case "SemAssocTypeNotFoundOnTrait":
      return `cannot find associated type \`${kind.assocName}\` on trait \`${kind.trait}\``;
    case "SemAssocTypeNotFoundAmongBounds":
      return `cannot find associated type \`${kind.assocName}\` among the trait bounds of \`${kind.baseName}\``;
    case "SemAssocTypeNotFoundOnType":
      return `cannot find associated type \`${kind.assocName}\` on \`${kind.typeName}\``;
    case "SemAssocTypeAmbiguous":
      return `associated type \`${kind.assocName}\` is ambiguous between traits ${kind.traitList}`;
    case "SemTraitNotObjectSafe":
      return `trait \`${kind.trait}\` cannot be made into a \`dyn\` object: ${kind.offender} takes \`Self\` as a non-receiver argument`;
    case "SemQualifiedTypePathsUnsupported":
      return "qualified type paths are not supported yet";
    case "SemGenericTypeParamNoArguments":
      return `generic type parameter \`${kind.name}\` does not accept type arguments`;
    case "SemPatternKindNotYetSupported":
      return "this pattern kind is not yet supported";
    case "SemWhileNotYetSupported":
      return "`while` expressions are not yet supported by semantic analysis";
    case "SemSignatureNoBodyTopLevel":
      return "a function signature with no body is not allowed as a top-level item";
    case "SemSignatureNoBodyInBlock":
      return "a function signature with no body is not allowed inside a block";
    case "SemTopLevelItemRestriction":
      return "only function, struct, enum, const, and static declarations are allowed at the top level";
    case "SemStaticCannotBePub":
      return "static items cannot be pub yet";
    case "SemConstInitializerTypeMismatch":
      return `const \`${kind.name}\`'s initializer does not match its declared type ${kind.declaredType}`;
    case "SemPatternTypeMismatch":
      return `expected \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemStaticTypeMismatch":
      return "type mismatch: static's declared type does not match its initializer";
    case "SemMissingReturnValue":
      return `missing return value: expected \`${kind.expected}\``;
    case "SemReturnTypeMismatch":
      return `return type mismatch: expected \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemLetAnnotationMismatch":
      return "type mismatch: explicit annotation does not match initializer type";
    case "SemArrayIndexMustBeUsize":
      return `array index must be \`usize\`, found \`${kind.found}\``;
    case "SemStructFieldTypeMismatch":
      return `field \`${kind.field}\` type mismatch: expected \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemArgumentTypeMismatch":
    case "SemArgumentTypeMismatchConflict":
      return `argument ${kind.argIndex} to ${kind.calleeKind} \`${kind.calleeName}\` type mismatch: expected \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemCallReturnTypeMismatch":
      return `call to \`${kind.calleeName}\` type mismatch: expected \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemNoMethodOnType":
      return `no method \`${kind.method}\` found for type \`${kind.typeName}\``;
    case "SemAmbiguousMethod":
      return `method \`${kind.method}\` on \`${kind.typeName}\` is ambiguous between traits ${kind.traits
        .map((t) => `\`${t}\``)
        .join(" and ")}`;
    case "SemNoAssociatedItem":
      return `no associated item \`${kind.name}\` found for \`${kind.typeName}\``;
    case "SemLogicalOperandsMustBeBool":
      return "logical operator operands must be `bool`";
    case "SemBitwiseRequiresInteger":
      return "bitwise operations require integer operands";
    case "SemArithmeticOperandNotNumeric":
      return `arithmetic operands must be numeric; ${kind.side}-operand is type \`${kind.found}\``;
    case "SemShiftedValueMustBeInteger":
      return "the shifted value must be an integer";
    case "SemShiftAmountMustBeInteger":
      return "the shift amount must be an integer";
    case "SemNotRequiresBoolOrInteger":
      return `\`!\` requires \`bool\` or an integer, found \`${kind.found}\``;
    case "SemRepeatArrayElementMustBeCopy":
      return `repeat-form array element type must be Copy, found \`${kind.found}\``;
    case "SemIfConditionMustBeBool":
      return "if condition must be `bool`";
    case "SemComparisonNotSupported":
      return `type does not support ${kind.relation} comparison`;
    case "SemComparisonOperandsSameType":
      return "comparison operands must have the same type";
    case "SemArithmeticOperandsSameType":
      return "arithmetic operands must have the same type";
    case "SemBitwiseOperandsSameType":
      return "bitwise operands must have the same type";
    case "SemArrayElementsSameType":
      return `array elements must all have the same type; expected \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemMatchArmsIncompatible":
      return "match arms have incompatible types";
    case "SemIfBranchesIncompatible":
      return "if expression branches have incompatible types";
    case "SemLiteralOutOfRange":
      return `out of range for ${kind.typeName}`;
    case "SemUnexpectedIntLiteralRangeCheck":
      return `unexpected int-literal range check for type ${kind.typeName}`;
    case "SemUnexpectedFloatLiteralRangeCheck":
      return `unexpected float-literal range check for type ${kind.typeName}`;
    case "SemArrayIndexOutOfBounds":
      return `index ${kind.index} out of bounds for array of length ${kind.length}`;
    case "SemCannotInferEmptyArrayElementType":
      return "cannot infer element type of an empty array literal without an explicit type annotation";
    case "SemCannotInferGenericParam":
      return `cannot infer type of generic parameter \`${kind.paramName}\` without an explicit type annotation or turbofish`;
    case "SemCannotDereferenceNonReference":
      return "cannot dereference a non-reference type";
    case "SemCannotIndexNonArray":
      return `cannot index into non-array type \`${kind.found}\``;
    case "SemFieldAccessOnNonStruct":
      return "field access on non-struct type";
    case "SemStructHasNamedFields":
      return `struct \`${kind.structName}\` has named fields; use \`${kind.structName} { ... }\``;
    case "SemUnitStructCannotUseParens":
      return `struct \`${kind.structName}\` is a unit struct and cannot be constructed with \`()\``;
    case "SemFieldProvidedForUnitStruct":
      return `field \`${kind.field}\` provided for unit struct \`${kind.structName}\``;
    case "SemMissingRequiredField":
      return `missing required field \`${kind.field}\` in struct literal of type \`${kind.structName}\``;
    case "SemVariantTakesNoArguments":
      return `variant \`${kind.variant}\` takes no arguments, but ${kind.count} ${kind.count === 1 ? "was" : "were"} supplied`;
    case "SemVariantHasNamedFields":
      return `variant \`${kind.variant}\` has named fields; use \`${kind.variant} { ... }\``;
    case "SemVariantIsTupleVariantConstruct":
      return `variant \`${kind.variant}\` is a tuple variant; use \`${kind.variant}(...)\``;
    case "SemVariantIsUnitVariantConstruct":
      return `variant \`${kind.variant}\` is a unit variant; use \`${kind.variant}\` with no braces`;
    case "SemConstructorArgCountMismatch":
      return `${kind.calleeKind} \`${kind.name}\` takes ${kind.expected} argument(s), but ${kind.count} ${kind.count === 1 ? "was" : "were"} supplied`;
    case "SemTurbofishArgCountMismatch":
      return `\`${kind.calleeName}\` declares ${kind.declared} generic parameter(s), but the turbofish supplies ${kind.supplied}`;
    case "SemNonExhaustivePatterns":
      return `non-exhaustive patterns: \`${kind.missing}\` not covered`;
    case "SemUnreachablePattern":
      return "unreachable pattern";
    case "SemOrPatternInconsistentNames":
      return `or-pattern alternatives must bind the same names; \`${kind.names}\` ${kind.single ? "is" : "are"} not bound by every alternative`;
    case "SemOrPatternInconsistentBinding":
      return `or-pattern alternatives must bind \`${kind.name}\` with the same type and mode in every alternative`;
    case "SemVariantNotTupleVariant":
      return `variant \`${kind.variant}\` is not a tuple variant`;
    case "SemVariantNotStructVariant":
      return `variant \`${kind.variant}\` is not a struct variant`;
    case "SemPatternExpectedStruct":
      return `expected struct \`${kind.expected}\`, found \`${kind.found}\``;
    case "SemStructNotTupleStruct":
      return `struct \`${kind.name}\` is not a tuple struct`;
    case "SemStructNoNamedFields":
      return `struct \`${kind.name}\` does not have named fields`;
    case "SemVariantHasFieldsPattern":
      return `variant \`${kind.variant}\` has fields; use \`${kind.variant}(...)\` or \`${kind.variant} { ... }\``;
    case "SemPatternFieldCountMismatch":
      return `${kind.label} has ${kind.fieldCount} field(s), but the pattern has ${kind.patternCount}`;
    case "SemSlicePatternMultipleRest":
      return `a slice pattern can have at most one \`..\` rest, but this one has ${kind.restCount}`;
    case "SemSlicePatternLengthAtLeast":
      return `array has ${kind.length} element(s), but the pattern requires at least ${kind.minCount}`;
    case "SemSlicePatternLengthExactly":
      return `array has ${kind.length} element(s), but the pattern requires exactly ${kind.exactCount}`;
    case "SemRangeBoundsSameType":
      return `range bounds must have the same type: \`${kind.start}\` and \`${kind.end}\``;
    case "SemRangeLowerGreaterThanUpper":
      return `lower range bound ${kind.low} is greater than upper bound ${kind.high}, so the range matches nothing`;
    case "SemCannotBindMutThroughSharedRef":
      return `cannot bind \`${kind.name}\` as \`&mut\` through a shared reference`;
    case "SemCannotBindMutPlaceNotMutable":
      return `cannot bind \`${kind.name}\` as \`&mut\` because the underlying place is not mutable`;
    case "SemReturnsReferenceToLocal":
      return `returns a reference to \`${kind.name}\`, which does not live beyond this function`;
    case "SemStructLiteralFieldBorrowsLocal":
      return `struct literal field \`${kind.field}\` borrows \`${kind.name}\`, which does not live beyond this function`;
    case "SemNotABorrowablePlace":
      return "only a local binding, a parameter, or a field, index, or dereference of one can be borrowed directly";
    case "SemCannotAssignToImmutableBinding":
      return "cannot assign to immutable binding";
    case "SemCannotAssignThroughSharedReference":
      return "cannot assign through a shared reference";
    case "OwnBorrowMutThroughShared":
      return `cannot borrow \`${kind.place}\` as mutable because \`${kind.through}\` is a shared reference.`;
    case "OwnBorrowMutNotDeclaredMut":
      return `Cannot borrow "${kind.baseName}" as &mut because it is not declared mut.`;
    case "OwnConflictingBorrows":
      return (
        `Conflicting borrows of "${kind.place}": ${kind.first} at offset ${kind.firstOffset} ` +
        `and ${kind.second} at offset ${kind.secondOffset} are both live.`
      );
    case "OwnUseOfUninitializedBinding":
      return `use of uninitialized binding \`${kind.name}\``;
    case "OwnUseOfMovedValue":
      return `use of moved value \`${kind.name}\``;
    case "OwnUseOfPossiblyMovedValue":
      return `use of possibly-moved value \`${kind.name}\`: moved on some paths but not others`;
    case "OwnUseOfPossiblyUninitializedBinding":
      return `use of possibly-uninitialized binding \`${kind.name}\`: initialized on some paths but not others`;
    case "OwnCannotMoveOutBorrowInstead":
      return `cannot move out of \`${kind.place}\`; borrow it with \`&${kind.place}\` instead`;
    case "OwnCannotMoveOutOfReference":
      return `cannot move ${kind.place} out of a reference`;
    case "OwnConditionalDropFlag":
      return `\`${kind.name}\` needs a runtime drop flag to decide whether it is still owned at scope exit`;
    case "OwnAmbiguousDrop":
      return `\`${kind.name}\` may or may not have been initialized depending on the branch taken, and conditional drops are not yet supported`;
    default:
      return assertNever(kind);
  }
}

function radixArticle(radix: RadixName): string {
  return radix === "octal" ? "an" : "a";
}

export function renderRelatedLabel(label: RelatedLabelKind): string {
  switch (label.kind) {
    case "LabelMovedHere":
      return "moved here";
    case "LabelBorrowHere":
      return `${label.borrow} borrow here`;
    case "LabelShadowedDeclaration":
      return "shadowed declaration";
    case "LabelImplForThisDeclaration":
      return "impl for this declaration";
    case "LabelFirstImplementedHere":
      return "first implemented here";
    case "LabelInferredAsHere":
      return `inferred as \`${label.typeName}\` here`;
    default:
      return assertNever(label);
  }
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
