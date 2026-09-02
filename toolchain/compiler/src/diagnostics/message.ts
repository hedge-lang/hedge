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
