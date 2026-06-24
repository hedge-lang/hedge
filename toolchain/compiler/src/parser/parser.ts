import type { Diagnostic } from "../diagnostics.js";
import type { Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { isErr } from "../result.js";
import type { Program } from "./ast.js";
import { collectInnerAttributes } from "./attribute.js";
import { parseItem } from "./item.js";
import { tokenAt } from "./parse-utils.js";

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

  const items: Program["items"] = [];
  for (;;) {
    const peekResult = tokenAt(tokens, cursor);
    if (isErr(peekResult)) {
      diagnostics.push(peekResult.error);
      return { program: none(), diagnostics };
    }
    if (peekResult.value.kind === "eof") {
      break;
    }
    const itemResult = parseItem(tokens, cursor);
    if (isErr(itemResult)) {
      diagnostics.push(itemResult.error);
      return { program: none(), diagnostics };
    }
    const node = itemResult.value.node;
    items.push(node);
    if (
      node.kind === "LetStatement" &&
      !node.bind &&
      !node.write &&
      !isSome(node.initializer)
    ) {
      const token = tokens[node.tokenId];
      diagnostics.push({
        severity: "warning",
        message: "immutable binding declared without a value can never be used",
        span: token !== undefined ? some(token.span) : none(),
      });
    }
    cursor = itemResult.value.next;
  }
  return { program: some({ kind: "Program", items, attributes }), diagnostics };
}
