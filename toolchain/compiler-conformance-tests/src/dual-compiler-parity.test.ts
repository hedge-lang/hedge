import { spawnSync } from "node:child_process";

import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

import { shellSplit } from "./shell-split.js";

const SELF_HOSTED_COMPILER_CMD = process.env["HEDGE_SELF_HOSTED_COMPILER_CMD"];

interface NormalizedDiagnostic {
  readonly severity: string;
  readonly message: string;
  readonly spanKind: string;
  readonly code: string | null;
}

interface ParityCompileOutput {
  readonly javascript: string | null;
  readonly typedef: string | null;
  readonly diagnostics: readonly NormalizedDiagnostic[];
}

function extractDiagnosticCode(diagnostic: unknown): string | null {
  if (typeof diagnostic !== "object" || diagnostic === null) {
    return null;
  }
  if (!Object.hasOwn(diagnostic, "code")) {
    return null;
  }
  const value = (diagnostic as Record<string, unknown>)["code"];
  return typeof value === "string" ? value : null;
}

function extractOptionString(optionValue: unknown): string | null {
  if (typeof optionValue !== "object" || optionValue === null) {
    return null;
  }
  const record = optionValue as Record<string, unknown>;
  if (record["kind"] !== "Some" || typeof record["value"] !== "string") {
    return null;
  }
  return record["value"];
}

function compileWithBootstrap(source: string): ParityCompileOutput {
  const result = compile(source);
  const javascript =
    isSome(result.code) && isSome(result.code.value.javascript)
      ? result.code.value.javascript.value
      : null;
  const typedef =
    isSome(result.code) && isSome(result.code.value.typedef)
      ? result.code.value.typedef.value
      : null;
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    spanKind: diagnostic.span.kind,
    code: extractDiagnosticCode(diagnostic),
  }));
  return { javascript, typedef, diagnostics };
}

function parseSelfHostedOutput(value: unknown): ParityCompileOutput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Self-hosted compiler JSON payload must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record["diagnostics"])) {
    throw new Error("Self-hosted compiler payload missing diagnostics[]");
  }
  const javascript = extractOptionString(record["javascript"]);
  const typedef = extractOptionString(record["typedef"]);
  const diagnostics = record["diagnostics"].map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Self-hosted diagnostic entry must be an object");
    }
    const diagnostic = entry as Record<string, unknown>;
    if (
      typeof diagnostic["severity"] !== "string" ||
      typeof diagnostic["message"] !== "string" ||
      typeof diagnostic["spanKind"] !== "string"
    ) {
      throw new Error("Self-hosted diagnostic entry has invalid shape");
    }
    const code = extractDiagnosticCode(diagnostic);
    return {
      severity: diagnostic["severity"],
      message: diagnostic["message"],
      spanKind: diagnostic["spanKind"],
      code,
    };
  });
  return { javascript, typedef, diagnostics };
}

function compileWithSelfHosted(source: string): ParityCompileOutput {
  if (typeof SELF_HOSTED_COMPILER_CMD !== "string") {
    throw new Error("Missing HEDGE_SELF_HOSTED_COMPILER_CMD");
  }
  const [cmd, ...cmdArgs] = shellSplit(SELF_HOSTED_COMPILER_CMD);
  const run = spawnSync(cmd ?? SELF_HOSTED_COMPILER_CMD, cmdArgs, {
    input: source,
    encoding: "utf8",
  });
  if (run.error !== undefined) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error(
      `Self-hosted compiler exited with status ${String(run.status)}: ${run.stderr}`,
    );
  }
  return parseSelfHostedOutput(JSON.parse(run.stdout) as unknown);
}

describe("dual-compiler parity harness", (): void => {
  const corpus = [
    `fn main() { print("hello"); }`,
    `fn main() { let x = 1 + 2 * 3; print(x); }`,
    `fn main() { print(missing_name); }`,
  ];

  it.skipIf(typeof SELF_HOSTED_COMPILER_CMD !== "string")(
    "compares bootstrap and self-hosted compiler outputs on shared corpus",
    (): void => {
      // Harness boundary prerequisite: HEDGE_SELF_HOSTED_COMPILER_CMD must be
      // configured to run the self-hosted compiler and emit JSON.
      for (const source of corpus) {
        const bootstrap = compileWithBootstrap(source);
        const selfHosted = compileWithSelfHosted(source);
        expect(selfHosted.javascript).toBe(bootstrap.javascript);
        expect(selfHosted.typedef).toBe(bootstrap.typedef);
      }
    },
  );

  it.skipIf(typeof SELF_HOSTED_COMPILER_CMD !== "string")(
    "compares bootstrap and self-hosted compiler diagnostics parity",
    (): void => {
      // Harness boundary prerequisite: HEDGE_SELF_HOSTED_COMPILER_CMD must be
      // configured to run the self-hosted compiler and emit JSON.
      for (const source of corpus) {
        const bootstrap = compileWithBootstrap(source);
        const selfHosted = compileWithSelfHosted(source);
        expect(selfHosted.diagnostics).toEqual(bootstrap.diagnostics);
      }
    },
  );
});
