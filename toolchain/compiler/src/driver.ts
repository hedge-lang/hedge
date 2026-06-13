import type { Code } from "./codegen/output.js";
import { generate } from "./codegen/generator.js";
import type { Diagnostic } from "./diagnostics.js";
import { tokenize } from "./lexer/lexer.js";
import { optimize } from "./optimization/optimizer.js";
import { checkBorrows } from "./ownership/borrowck.js";
import type { Program } from "./parser/ast.js";
import { parse } from "./parser/parser.js";
import { analyze } from "./semantics/analyzer.js";

export interface CompileResult {
  readonly diagnostics: readonly Diagnostic[];
  /** The generated output, or `null` when any error diagnostic was reported. */
  readonly code: Code | null;
}

type ParseOutcome =
  | { readonly ok: true; readonly program: Program }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

function toDiagnostic(error: unknown): Diagnostic {
  return {
    severity: "error",
    message: error instanceof Error ? error.message : "Unknown compiler error.",
    tokenId: 0,
  };
}

function parseSource(source: string): ParseOutcome {
  try {
    return { ok: true, program: parse(tokenize(source)) };
  } catch (error) {
    return { ok: false, diagnostic: toDiagnostic(error) };
  }
}

function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic: Diagnostic): boolean => diagnostic.severity === "error",
  );
}

/**
 * Compile Hedge source to JavaScript. Runs the full pipeline — lex, parse,
 * resolve, borrow-check, optimize, generate — and collects diagnostics. `code`
 * is `null` when lexing/parsing throws or any error diagnostic is reported.
 */
export function compile(source: string): CompileResult {
  const outcome = parseSource(source);
  if (!outcome.ok) {
    return { diagnostics: [outcome.diagnostic], code: null };
  }
  const { program } = outcome;
  const diagnostics = [
    ...analyze(program).diagnostics,
    ...checkBorrows(program),
  ];
  if (hasError(diagnostics)) {
    return { diagnostics, code: null };
  }
  return { diagnostics, code: generate(optimize(program)) };
}
