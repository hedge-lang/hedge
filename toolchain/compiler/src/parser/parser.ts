import { type Diagnostic, warningDiagnosticRaw } from "../diagnostics/index.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { isErr } from "../result.js";
import type { Item, Program } from "./ast.js";
import { collectInnerAttributes } from "./attribute.js";
import { parseItem } from "./item.js";
import { elideLifetimes } from "./lifetime-elision.js";
import { kindAt, skipToItemStartKeyword, tokenAt } from "./parse-utils.js";

/**
 * @returns the token index of a missing `fn`/`struct` name - the one
 * top-level failure this ticket recovers from - or `undefined` for any other
 * failure. Detected structurally, not by message content or by `itemStart`:
 * a `fn`/`struct`'s very first step after the keyword is always parsing its
 * name, so a failure whose span starts exactly one token after an `fn`/
 * `struct` keyword can only be that step, regardless of what prefixes the
 * keyword (`pub`, attributes, ...). Anchoring on the error's own span rather
 * than `itemStart` matters: `itemStart` points at the item's leading token
 * (e.g. `pub`), which is *not* where the name lives once a visibility prefix
 * is present - `tokens[itemStart + 1]` would then be `fn` itself, not the
 * name, and a `pub`-prefixed missing name would never be recognized.
 * Anything else (a bad param/field/type/pattern deeper in the declaration, a
 * missing brace, a disallowed `pub` combination, ...) keeps failing fast
 * exactly as before - retrofitting recovery onto those would silently
 * swallow diagnostics the rest of the suite pins as hard failures (see e.g.
 * the reference-type, generic-type, and `mut`-as-name guardrails).
 */
function missingItemNameIndex(
  tokens: readonly Token[],
  errorSpan: Option<Span>,
): number | undefined {
  if (!isSome(errorSpan)) {
    return undefined;
  }
  const badNameIdx = tokens.findIndex(
    (tok) => tok.span.start === errorSpan.value.start,
  );
  const before = tokens[badNameIdx - 1];
  const isFnOrStruct =
    before?.kind === "keyword" &&
    (before.text === "fn" || before.text === "struct");
  return isFnOrStruct ? badNameIdx : undefined;
}

/**
 * Parse a token stream into a {@link Program}.
 *
 * Current slice support:
 *
 * - Function declarations
 * - Let statements
 * - Blocks
 * - Path expressions
 * - Call expressions
 * - Reference expressions
 * - String literals
 * - Integer literals
 *
 * The parser is intentionally implemented as a small recursive-descent parser
 * that grows incrementally toward the complete grammar defined in
 * `specification/0025-grammar.md`.
 *
 */
export interface ParseResult {
  readonly program: Option<Program>;
  readonly diagnostics: readonly Diagnostic[];
}

// eslint-disable-next-line complexity -- splitting would obscure the grammar rule.
export function parse(tokens: readonly Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  // Program-level inner attributes (#![...]) apply to the module itself.
  const innerResult = collectInnerAttributes(tokens, cursor);
  if (isErr(innerResult)) {
    diagnostics.push(innerResult.error);
    return { program: none(), diagnostics };
  }
  const attributes = innerResult.value.attributes;
  cursor = innerResult.value.next;

  const items: Item[] = [];
  for (;;) {
    const peekResult = tokenAt(tokens, cursor);
    if (isErr(peekResult)) {
      diagnostics.push(peekResult.error);
      return { program: none(), diagnostics };
    }
    if (peekResult.value.kind === "eof") {
      break;
    }
    // A lone `;` carries no semantic content. Skip it silently rather
    // than falling through to expression parsing, which would produce
    // a confusing secondary "Expected an expression" error and abort
    // the whole parse.
    if (peekResult.value.kind === "semi") {
      cursor += 1;
      continue;
    }
    const itemResult = parseItem(tokens, diagnostics, cursor);
    if (isErr(itemResult)) {
      diagnostics.push(itemResult.error);
      const badNameIdx = missingItemNameIndex(tokens, itemResult.error.span);
      if (badNameIdx === undefined) {
        return { program: none(), diagnostics };
      }
      // Skip past the bad name token before scanning for the next item -
      // otherwise a keyword reused as the bad name (`fn enum() {}`, or
      // `pub fn enum() {}`) would have it immediately re-matched as a fresh
      // item's start, since it's itself an `ITEM_START_KEYWORDS` member.
      cursor = skipToItemStartKeyword(tokens, badNameIdx + 1);
      // No further item to resync to: matches the existing convention (see
      // `skipUnsupportedTopLevelItem`'s own EOF case) that a synchronization
      // scan finding nothing before EOF is a hard failure, not a recovered
      // empty program.
      if (kindAt(tokens, cursor) === "eof") {
        return { program: none(), diagnostics };
      }
      continue;
    }
    cursor = itemResult.value.next;
    const node = itemResult.value.node;
    if (!isSome(node)) {
      continue;
    }
    items.push(node.value);
    if (
      node.value.kind === "LetStatement" &&
      node.value.pattern.kind === "BindingPattern" &&
      !node.value.pattern.mutable &&
      !isSome(node.value.initializer)
    ) {
      const token = tokens[node.value.tokenId];
      diagnostics.push(
        warningDiagnosticRaw(
          "HEDGE-LINT-001",
          "immutable binding declared without a value can never be used",
          token !== undefined ? some(token.span) : none(),
        ),
      );
    }
  }
  const program = elideLifetimes(
    { kind: "Program", items, attributes },
    tokens,
    diagnostics,
  );
  return { program: some(program), diagnostics };
}
