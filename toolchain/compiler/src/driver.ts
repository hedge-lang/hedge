import type { Code } from "./codegen/output.js";
import { generate } from "./codegen/generator.js";
import type { Diagnostic } from "./diagnostics.js";
import { toJsim } from "./jsim/jsim.js";
import { tokenize } from "./lexer/lexer.js";
import { optimize } from "./optimization/optimizer.js";
import { none, some, type Option } from "./option.js";
import { checkBorrows } from "./ownership/borrowck.js";
import type { Program } from "./parser/ast.js";
import { parse } from "./parser/parser.js";
import { err, isErr, ok, type Result } from "./result.js";
import { analyze } from "./semantics/analyzer.js";

export interface CompileResult {
  readonly diagnostics: readonly Diagnostic[];
  /** The generated output, or `none()` when any error diagnostic was reported. */
  readonly code: Option<Code>;
}

function toDiagnostic(error: unknown): Diagnostic {
  return {
    severity: "error",
    message: error instanceof Error ? error.message : "Unknown compiler error.",
    tokenId:
      typeof error === "object" &&
      error &&
      "tokenId" in error &&
      typeof error.tokenId === "number"
        ? error.tokenId
        : 0,
  };
}

function parseSource(source: string): {
  outcome: Result<Program, Diagnostic>;
  lexDiagnostics: readonly Diagnostic[];
} {
  const { tokens, diagnostics: lexDiagnostics } = tokenize(source);
  const result = parse(tokens);
  if (isErr(result)) {
    return { outcome: err(toDiagnostic(result.error)), lexDiagnostics };
  }
  return { outcome: ok(result.value), lexDiagnostics };
}

function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic: Diagnostic): boolean => diagnostic.severity === "error",
  );
}

/**
 * Compile Hedge source to JavaScript. Runs the full pipeline — lex, parse,
 * resolve, borrow-check, optimize, generate — and collects diagnostics. `code`
 * is `none()` when any error diagnostic is reported.
 */
export function compile(source: string): CompileResult {
  const { outcome: parseOutcome, lexDiagnostics } = parseSource(source);
  if (isErr(parseOutcome)) {
    return {
      diagnostics: [...lexDiagnostics, parseOutcome.error],
      code: none(),
    };
  }
  const program = parseOutcome.value;
  const diagnostics = [
    ...lexDiagnostics,
    ...analyze(program).diagnostics,
    ...checkBorrows(program),
  ];
  if (hasError(diagnostics)) {
    return { diagnostics, code: none() };
  }
  return { diagnostics, code: some(generate(toJsim(optimize(program)))) };
}
