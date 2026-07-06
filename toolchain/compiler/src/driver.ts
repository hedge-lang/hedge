import type { Code } from "./codegen/output.js";
import { generate } from "./codegen/generator.js";
import type { Diagnostic } from "./diagnostics.js";
import { toJsim } from "./jsim/jsim.js";
import { tokenize } from "./lexer/lexer.js";
import type { Token } from "./lexer/token.js";
import { optimize } from "./optimization/optimizer.js";
import { none, some, type Option, isSome } from "./option.js";
import { checkBorrows } from "./ownership/borrowck.js";
import type { Program } from "./parser/ast.js";
import { parse } from "./parser/parser.js";
import { analyze } from "./semantics/analyzer.js";

export interface CompileResult {
  readonly diagnostics: readonly Diagnostic[];
  /** The generated output, or `none()` when any error diagnostic was reported. */
  readonly code: Option<Code>;
}

interface ParseSourceResult {
  readonly program: Option<Program>;
  readonly lexDiagnostics: readonly Diagnostic[];
  readonly parseDiagnostics: readonly Diagnostic[];
  readonly tokens: readonly Token[];
}

function parseSource(source: string): ParseSourceResult {
  const { tokens, diagnostics: lexDiagnostics } = tokenize(source);
  const { program, diagnostics: parseDiagnostics } = parse(tokens);
  return { program, lexDiagnostics, parseDiagnostics, tokens };
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
  const {
    program: programOpt,
    lexDiagnostics,
    parseDiagnostics,
    tokens,
  } = parseSource(source);
  if (!isSome(programOpt)) {
    return {
      diagnostics: [...lexDiagnostics, ...parseDiagnostics],
      code: none(),
    };
  }
  const program = programOpt.value;
  const analysis = analyze(program, tokens);
  // TODO: pass analysis.program (Semantics.Program) once the borrow checker
  // is updated to consume the semantic AST instead of the parser AST.
  // Tracked: https://github.com/hedge-lang/hedge/issues/128
  const borrowChecked = checkBorrows(program, tokens);
  const diagnostics = [
    ...lexDiagnostics,
    ...parseDiagnostics,
    ...analysis.diagnostics,
    ...borrowChecked,
  ];
  if (hasError(diagnostics)) {
    return { diagnostics, code: none() };
  }
  return {
    diagnostics,
    code: some(generate(toJsim(optimize(analysis.program)))),
  };
}
