import type * as JSIM from "../jsim/ast.js";
import { toJsim } from "../jsim/jsim.js";
import { analyzeSource } from "./analyze-source.js";

/**
 * Lex, parse, and semantically analyze `source`, then lower it to JSIM,
 * asserting no error along the way.
 */
export function jsimSource(source: string): JSIM.Program {
  const { program, tokens } = analyzeSource(source);
  return toJsim(program, tokens);
}
