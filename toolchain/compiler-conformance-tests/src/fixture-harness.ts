import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Diagnostic,
  messageOf,
  renderRelatedLabel,
} from "@hedge-lang/compiler";
import { isSome } from "@hedge-lang/compiler";

import { compileHedgeCode } from "./test-harness.js";

export interface GoldenFixture {
  readonly name: string;
  readonly sourcePath: string;
  readonly expectedPath: string;
}

export interface ExecutionFixture {
  readonly name: string;
  readonly sourcePath: string;
  readonly expectedPath: string;
}

export interface ExecutionExpectation {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface MustFailFixture {
  readonly name: string;
  readonly sourcePath: string;
  readonly expectedPath: string;
  /** Structured `[{code, kind, relatedSpans}]` snapshot, reword-proof. */
  readonly expectedDiagPath: string;
}

const TESTS_DIR = fileURLToPath(new URL("../tests", import.meta.url));
const EXECUTION_RUNTIME_PATH = join(TESTS_DIR, "execution-runtime.cjs");

function discoverFixtures(
  categoryDir: string,
  expectedExt: string,
): { name: string; sourcePath: string; expectedPath: string }[] {
  return readdirSync(categoryDir)
    .filter((f) => f.endsWith(".hedge"))
    .map((f) => basename(f, ".hedge"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      sourcePath: join(categoryDir, `${name}.hedge`),
      expectedPath: join(categoryDir, `${name}${expectedExt}`),
    }));
}

export function discoverGoldenFixtures(): GoldenFixture[] {
  return discoverFixtures(join(TESTS_DIR, "golden"), ".expected.js");
}

export function discoverExecutionFixtures(): ExecutionFixture[] {
  return discoverFixtures(join(TESTS_DIR, "execution"), ".expected.json");
}

export function readExecutionExpectation(path: string): ExecutionExpectation {
  return JSON.parse(readFileSync(path, "utf8")) as ExecutionExpectation;
}

/**
 * Compile a fixture, prepend the print-runtime shim (no real `print`
 * implementation exists until stdlib lands in Slice 5), and run the result
 * as a real Node subprocess so the reported exit code is genuine.
 */
export function runExecutionFixture(fixture: ExecutionFixture): {
  readonly exitCode: number;
  readonly stdout: string;
} {
  const source = readFileSync(fixture.sourcePath, "utf8");
  const result = compileHedgeCode(source);
  if (!isSome(result.code) || !isSome(result.code.value.javascript)) {
    throw new Error(
      `execution fixture "${fixture.name}" failed to compile: ${result.diagnostics
        .map((d) => messageOf(d))
        .join("; ")}`,
    );
  }

  const shim = readFileSync(EXECUTION_RUNTIME_PATH, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "hedge-execution-fixture-"));
  try {
    const scriptPath = join(dir, "fixture.cjs");
    const { javascript } = result.code.value;
    // The shebang is only meaningful as the file's first line; once the
    // print-runtime shim is prepended it would otherwise be invalid mid-file
    // syntax, so neutralize it the same way test-harness.ts's in-process
    // runner does.
    const jsValue = javascript.value.startsWith("#!")
      ? `// ${javascript.value}`
      : javascript.value;
    writeFileSync(scriptPath, `${shim}\n${jsValue}`);
    const spawned = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (spawned.error) {
      throw spawned.error;
    }
    if (spawned.signal) {
      throw new Error(
        `execution fixture "${fixture.name}" termianted by signal ${spawned.signal}`,
        { cause: spawned },
      );
    }
    return { exitCode: spawned.status ?? 1, stdout: spawned.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function discoverMustFailFixtures(): MustFailFixture[] {
  return discoverFixtures(join(TESTS_DIR, "must-fail"), ".expected.stderr").map(
    (fixture) => ({
      ...fixture,
      expectedDiagPath: fixture.expectedPath.replace(
        /\.expected\.stderr$/,
        ".expected.diag.json",
      ),
    }),
  );
}

/**
 * The reword-proof view of a rejection: each diagnostic's `code`, its
 * structured `kind`, and its related spans reduced to `{labelKind, spanStart}`.
 * A wording change never touches this; only a change to the diagnostic a
 * fixture actually produces does.
 */
export function structuredDiagnostics(
  diagnostics: readonly Diagnostic[],
): string {
  const structured = diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    kind: diagnostic.kind,
    relatedSpans: diagnostic.relatedSpans.map((related) => ({
      labelKind: related.label.kind,
      spanStart: related.span.start,
    })),
  }));
  return `${JSON.stringify(structured, null, 2)}\n`;
}

/**
 * Mirrors toolchain/cli/src/util/render.ts's renderDiagnostics, reimplemented
 * locally to avoid a cross-package dependency on @hedge-lang/cli.
 */
export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return `${diagnostics.map(renderDiagnostic).join("\n")}\n`;
}

function renderDiagnostic(diagnostic: Diagnostic): string {
  const code = `[${diagnostic.code}]`;
  const lines = [`${diagnostic.severity}${code}: ${messageOf(diagnostic)}`];
  for (const related of diagnostic.relatedSpans) {
    lines.push(
      `  = note: ${renderRelatedLabel(related.label)} at offset ${related.span.start}`,
    );
  }
  return lines.join("\n");
}
