import type { Diagnostic } from "./diagnostics.js";
import { tokenize } from "./lexer/lexer.js";
import type { Token } from "./lexer/token.js";
import { isSome, type Option } from "./option.js";
import type { Program } from "./parser/ast.js";
import { parse } from "./parser/parser.js";

/**
 * The always-in-scope standard-library declarations, compiled in front of
 * every program. Pre-modules (ROADMAP Slice 7), this is the only prelude
 * mechanism: the items reach the user program through the normal
 * registration and resolution passes, exactly as if they had been declared
 * at the top of the file. `prelude.test.ts` pins that this source parses
 * and analyzes clean on its own - a break there is what fails CI.
 */
export const PRELUDE_SOURCE = `trait Clone {
  fn clone(&self) -> Self;
}

trait PartialEq {
  fn eq(&self, other: &Self) -> bool;
}

trait Eq: PartialEq {}

trait Default {
  fn default() -> Self;
}

trait Drop {
  fn drop(&mut self);
}
`;

export interface AssembledProgram {
  readonly program: Option<Program>;
  readonly tokens: readonly Token[];
  readonly lexDiagnostics: readonly Diagnostic[];
  readonly parseDiagnostics: readonly Diagnostic[];
}

const PRELUDE_TOKENS: readonly Token[] = tokenize(PRELUDE_SOURCE).tokens.filter(
  (token): boolean => token.kind !== "eof",
);

/**
 * Length of the leading run of module-level inner attributes (`#![...]`,
 * which is also what a leading `//!` doc comment lexes to). They must stay
 * at token 0 for `parse()` to read them as module attributes, so the
 * prelude splices in after them rather than before.
 */
function leadingInnerAttributePrefix(tokens: readonly Token[]): number {
  let index = 0;
  while (
    tokens[index]?.kind === "hash" &&
    tokens[index + 1]?.kind === "bang" &&
    tokens[index + 2]?.kind === "lbracket"
  ) {
    index += 2;
    let depth = 0;
    do {
      const kind = tokens[index]?.kind;
      if (kind === undefined) return index;
      if (kind === "lbracket") depth += 1;
      else if (kind === "rbracket") depth -= 1;
      index += 1;
    } while (depth > 0);
  }
  return index;
}

/**
 * Parses {@link source} with the std prelude spliced into its token stream,
 * so every `tokenId` is a correct index into the returned `tokens` with no
 * rewriting. The user tokens are parsed on their own first: a parse failure
 * (a truncated program, unrecoverable syntax) returns exactly what it would
 * without a prelude, and only a program that parses cleanly on its own is
 * re-parsed with the prelude spliced in ahead of its first item. The user
 * tokens keep their original spans, so diagnostics, source maps, and
 * fixture offsets are unaffected by the splice.
 */
export function assembleProgram(source: string): AssembledProgram {
  const { tokens: userTokens, diagnostics: lexDiagnostics } = tokenize(source);
  const userOnly = parse(userTokens);
  if (!isSome(userOnly.program)) {
    return {
      program: userOnly.program,
      tokens: userTokens,
      lexDiagnostics,
      parseDiagnostics: userOnly.diagnostics,
    };
  }
  const prefix = leadingInnerAttributePrefix(userTokens);
  const tokens = [
    ...userTokens.slice(0, prefix),
    ...PRELUDE_TOKENS,
    ...userTokens.slice(prefix),
  ];
  const { program, diagnostics: parseDiagnostics } = parse(tokens);
  return { program, tokens, lexDiagnostics, parseDiagnostics };
}
