/**
 * CI script: proof-traceability check.
 *
 * For each conformance rule that carries a `proofRefs` field, verify that each
 * theorem name appears in at least one file under `formal/coq/`.
 *
 * Exits 0 when:
 *   - `formal/coq/` does not yet exist (Phase 1 / Phase 2 — proofs not started)
 *   - all proofRefs resolve to a theorem name inside a .v file
 *
 * Exits 1 when a proofRef names a theorem that cannot be found in any .v file.
 *
 * Run: node --experimental-strip-types scripts/check-proof-refs.ts
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const COQDIR = join(REPO_ROOT, "formal", "coq");
const CONFORMANCE_INDEX = join(
  REPO_ROOT,
  "toolchain",
  "compiler-conformance-tests",
  "src",
  "conformance-index.ts",
);

// ---------------------------------------------------------------------------
// Parse proofRefs out of conformance-index.ts via the TS compiler API. Each
// conformance rule is an object literal with sibling `id` and `proofRefs`
// properties, so scoping the lookup to one object literal's own properties
// (rather than a regex spanning multiple rules) can't cross rule boundaries.
// ---------------------------------------------------------------------------
function findProperty(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name
    ) {
      return prop;
    }
  }
  return undefined;
}

export function extractProofRefs(
  source: string,
  fileName: string = "conformance-index.ts",
): Map<string, string[]> {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = new Map<string, string[]>();

  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const idProp = findProperty(node, "id");
      const proofRefsProp = findProperty(node, "proofRefs");
      if (
        idProp !== undefined &&
        ts.isStringLiteral(idProp.initializer) &&
        proofRefsProp !== undefined &&
        ts.isArrayLiteralExpression(proofRefsProp.initializer)
      ) {
        const refs = proofRefsProp.initializer.elements
          .filter(ts.isStringLiteral)
          .map((el) => el.text);
        if (refs.length > 0) {
          result.set(idProp.initializer.text, refs);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

// ---------------------------------------------------------------------------
// Word-boundary theorem lookup — a plain substring check would count a
// theorem name found merely because it's a substring of a longer identifier
// (e.g. "Foo" inside "FooBarLemma").
// ---------------------------------------------------------------------------
export function theoremDeclaredIn(theorem: string, text: string): boolean {
  const escaped = theorem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

// ---------------------------------------------------------------------------
// Collect all .v files under formal/coq/ recursively.
// ---------------------------------------------------------------------------
async function collectVFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".v"))
    .map((e) => join(e.parentPath, e.name));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const source = await readFile(CONFORMANCE_INDEX, "utf-8");
  const proofRefsById = extractProofRefs(source);

  if (proofRefsById.size === 0) {
    console.log(
      "check-proof-refs: no proofRefs found in conformance-index.ts — no-op.",
    );
    return;
  }

  if (!existsSync(COQDIR)) {
    console.log(
      "check-proof-refs: formal/coq/ does not exist yet — proof traceability check deferred.",
    );
    console.log(`  Pending proof references (${proofRefsById.size} rule(s)):`);
    for (const [id, refs] of proofRefsById) {
      console.log(`    ${id}: ${refs.join(", ")}`);
    }
    return;
  }

  const vFiles = await collectVFiles(COQDIR);
  const vContents = await Promise.all(
    vFiles.map(async (f) => ({ file: f, text: await readFile(f, "utf-8") })),
  );

  let failures = 0;
  for (const [id, refs] of proofRefsById) {
    for (const theorem of refs) {
      const found = vContents.some(({ text }) =>
        theoremDeclaredIn(theorem, text),
      );
      if (!found) {
        console.error(
          `check-proof-refs: MISSING  rule ${id} references "${theorem}" but it appears in no .v file under formal/coq/`,
        );
        failures++;
      } else {
        console.log(`check-proof-refs: OK       rule ${id} → "${theorem}"`);
      }
    }
  }

  if (failures > 0) {
    console.error(
      `\ncheck-proof-refs: ${failures} unresolved proof reference(s). Add the theorem to the appropriate .v file or remove the proofRef.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("check-proof-refs: all proof references resolve.");
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
