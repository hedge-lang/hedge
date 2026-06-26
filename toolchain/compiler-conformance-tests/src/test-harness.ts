import { compile, type CompileResult, isSome } from "@hedge-lang/compiler";

export const SLICE_NUMBER: number = 1;

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
      stdout.push(
        typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]),
      );
    },
  };

  const jsValue = javascript.value.startsWith("#!")
    ? `// ${javascript.value}`
    : javascript.value;

  try {
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
export function getErrorMessages(result: CompileResult): string[] {
  return result.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
}
