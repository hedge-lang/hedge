import { assert } from "../assert.js";
import { messageOf } from "../diagnostics/index.js";
import { tokenize } from "../lexer/lexer.js";
import type { Token } from "../lexer/token.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import { analyze } from "../semantics/analyzer.js";
import type * as Semantics from "../semantics/ast.js";

export interface AnalyzedSource {
  readonly tokens: readonly Token[];
  readonly program: Semantics.Program;
}

/** Tokenize, parse, and semantically analyze `source`, asserting no parse or semantic-analysis error along the way. */
export function analyzeSource(source: string): AnalyzedSource {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(
    isSome(program),
    diagnostics[0] === undefined ? "Parse failed" : messageOf(diagnostics[0]),
  );
  const analysis = analyze(program.value, tokens);
  assert(
    analysis.diagnostics.every((d) => d.severity !== "error"),
    analysis.diagnostics.map((d) => messageOf(d)).join("; "),
  );
  return { tokens, program: analysis.program };
}
