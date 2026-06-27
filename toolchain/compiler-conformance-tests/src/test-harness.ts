import { compile, type CompileResult, isSome } from "@hedge-lang/compiler";
import { expect } from "vitest";

/**
 * A captured execution result from running compiled JS.
 */
export interface ExecutionResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

/**
 * Compile Hedge source and execute the resulting JavaScript in a controlled environment.
 * Captures output and errors for assertion.
 *
 * @param source Hedge source code
 * @returns Execution result with captured output, or null if compilation failed
 */
export function executeHedgeCode(source: string): ExecutionResult | null {
  const result = compile(source);
  if (!isSome(result.code)) {
    return null;
  }

  const { javascript } = result.code.value;
  if (!isSome(javascript)) {
    return null;
  }

  const stdout: string[] = [];
  const stderr: string[] = [];

  // Mock print() built-in for Slice 1
  const globalEnv = {
    print: (...args: unknown[]): void => {
      stdout.push(args.join(""));
    },
  };

  const jsValue = javascript.value.startsWith("#!")
    ? `// ${javascript.value}`
    : javascript.value;

  try {
    // new Function cannot parse ESM `export` statements. Execution tests are
    // therefore limited to programs without `pub` items. When pub-fn execution
    // tests are needed, replace this with SourceTextModule from node:vm
    // (requires --experimental-vm-modules in the vitest pool config) and make
    // executeHedgeCode async. Tracked: https://github.com/hedge-lang/hedge/issues/127
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...Object.keys(globalEnv), jsValue);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    fn(...Object.values(globalEnv));
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    stderr.push(error instanceof Error ? error.message : String(error));
    return { exitCode: 1, stdout, stderr };
  }
}

/**
 * Compile Hedge source and return the compiled result with code and diagnostics.
 *
 * @param source Hedge source code
 * @returns CompileResult with diagnostics and optional code
 */
export function compileHedgeCode(source: string): CompileResult {
  return compile(source);
}

/**
 * Check if compilation produced errors.
 *
 * @param result CompileResult from compileHedgeCode
 * @returns true if any error diagnostics exist
 */
export function hasCompileErrors(result: CompileResult): boolean {
  return result.diagnostics.some((d) => d.severity === "error");
}

/**
 * Get all error messages from diagnostics.
 *
 * @param result CompileResult
 * @returns Array of error messages
 */
function getErrorMessages(result: CompileResult): string[] {
  return result.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
}

export function assertRunsTo(source: string, expectedStdout: string[]): void {
  const result = executeHedgeCode(source);
  expect(result, "program failed to compile").not.toBeNull();
  expect(result?.exitCode, "program threw at runtime").toBe(0);
  expect(result?.stdout).toEqual(expectedStdout);
}

export function assertRejects(source: string): void {
  const result = compileHedgeCode(source);
  expect(hasCompileErrors(result), "expected compile errors but got none").toBe(
    true,
  );
}

export function assertRejectsWithMessage(
  source: string,
  messageFragment: string,
): void {
  const result = compileHedgeCode(source);
  expect(hasCompileErrors(result), "expected compile errors but got none").toBe(
    true,
  );
  expect(
    getErrorMessages(result).some((m) => m.includes(messageFragment)),
    `no error contained "${messageFragment}"`,
  ).toBe(true);
}

export function assertNoCascade(source: string): void {
  const result = compileHedgeCode(source);
  const errors = getErrorMessages(result);
  expect(hasCompileErrors(result)).toBe(true);
  expect(errors.length, "expected exactly 1 error (no cascade)").toBe(1);
}

export function assertCompilesClean(source: string): CompileResult {
  const result = compileHedgeCode(source);
  expect(
    result.diagnostics.filter((d) => d.severity === "error"),
    "expected zero errors",
  ).toHaveLength(0);
  return result;
}
