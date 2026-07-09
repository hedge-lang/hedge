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
      return { program: none(), diagnostics };
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
      diagnostics.push({
        severity: "warning",
        message: "immutable binding declared without a value can never be used",
        span: token !== undefined ? some(token.span) : none(),
      });
    }
  }
  return { program: some({ kind: "Program", items, attributes }), diagnostics };
}
