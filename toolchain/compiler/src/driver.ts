import type { Code } from "./codegen/output.js";
import { generate } from "./codegen/generator.js";
import type { Diagnostic } from "./diagnostics.js";
import { toJsim } from "./jsim/jsim.js";
import { tokenize } from "./lexer/lexer.js";
import type { Token } from "./lexer/token.js";
import { optimize } from "./optimization/optimizer.js";
import { none, some, type Option, isSome } from "./option.js";
import { checkBorrows } from "./ownership/borrowck.js";
import { analyzeOwnership } from "./ownership/move-check.js";
import type { Program } from "./parser/ast.js";
import { parse } from "./parser/parser.js";
import { analyze } from "./semantics/analyzer.js";

export interface CompileResult {
  readonly diagnostics: readonly Diagnostic[];
  /** The generated output, or `none()` when any error diagnostic was reported. */
  readonly code: Option<Code>;
}

export interface CompileOptions {
  /**
   * Report a warning diagnostic at every site where a conditional move
   * needed a runtime drop flag instead of being resolved statically (see
   * specification/0007-drop-and-raii.md's "Conditional moves" section).
   * Defaults to false. Currently a no-op without loops (ROADMAP Slice 6):
   * every conditional move a loop-free program can express is resolved by
   * static duplication (move-check.ts's attributeConditionalMoves), so no
   * program compilable today can ever trigger this warning.
   */
  readonly warnDropFlags?: boolean;
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
export function compile(
  source: string,
  options: CompileOptions = {},
): CompileResult {
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
  const borrowChecked = checkBorrows(analysis.program, tokens);
  const ownership = hasError(analysis.diagnostics)
    ? { diagnostics: [], functions: new Map() }
    : analyzeOwnership(analysis.program, tokens, options);
  const diagnostics = [
    ...lexDiagnostics,
    ...parseDiagnostics,
    ...analysis.diagnostics,
    ...borrowChecked,
    ...ownership.diagnostics,
  ];
  if (hasError(diagnostics)) {
    return { diagnostics, code: none() };
  }
  return {
    diagnostics,
    code: some(
      generate(toJsim(optimize(analysis.program), tokens, ownership.functions)),
    ),
  };
}
