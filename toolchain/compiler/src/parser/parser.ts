import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type { Item, Program } from "./ast.js";
import { collectInnerAttributes } from "./attribute.js";
import { parseItem } from "./item.js";
import { tokenAt } from "./parse-utils.js";

/** The result of parsing a token stream: an optional program plus any parse-time diagnostics. */
export interface ParseResult {
  readonly program: Option<Program>;
  readonly diagnostics: readonly Diagnostic[];
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
 */
export function parse(tokens: readonly Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  // Program-level inner attributes (#![...]) apply to the module itself.
  const innerResult = collectInnerAttributes(tokens, diagnostics, cursor);
  if (!isSome(innerResult)) {
    return { program: none(), diagnostics };
  }
  const attributes = innerResult.value.attributes;
  cursor = innerResult.value.next;

  const items: Item[] = [];
  for (;;) {
    const peekResult = tokenAt(tokens, diagnostics, cursor);
    if (!isSome(peekResult)) {
      return { program: none(), diagnostics };
    }
    if (peekResult.value.kind === "eof") {
      break;
    }
    const itemResult = parseItem(tokens, diagnostics, cursor);
    if (!isSome(itemResult)) {
      return { program: none(), diagnostics };
    }
    items.push(itemResult.value.node);
    cursor = itemResult.value.next;
  }
  return { program: some({ kind: "Program", items, attributes }), diagnostics };
}
