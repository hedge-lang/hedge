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
// Parse proofRefs out of conformance-index.ts without importing it.
// Looks for: proofRefs: [ "name1", "name2", ... ]
// ---------------------------------------------------------------------------
// TODO: replace regex extraction with the TypeScript compiler API — the
// current [\s\S]*? can cross rule boundaries when a rule between two proofRefs
// rules lacks its own proofRefs field. Tracked: https://github.com/hedge-lang/hedge/issues/129
function extractProofRefs(source: string): Map<string, string[]> {
  const rulePattern = /id:\s*"([^"]+)"[\s\S]*?proofRefs:\s*\[([\s\S]*?)]/g;
  const stringPattern = /"([^"]+)"/g;
  const result = new Map<string, string[]>();

  for (const ruleMatch of source.matchAll(rulePattern)) {
    const id = ruleMatch[1];
    const listText = ruleMatch[2];
    if (id === undefined || listText === undefined) continue;
    const refs: string[] = [];
    for (const strMatch of listText.matchAll(stringPattern)) {
      if (strMatch[1] !== undefined) refs.push(strMatch[1]);
    }
    if (refs.length > 0) result.set(id, refs);
  }
  return result;
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
const source = await readFile(CONFORMANCE_INDEX, "utf-8");
const proofRefsById = extractProofRefs(source);

if (proofRefsById.size === 0) {
  console.log(
    "check-proof-refs: no proofRefs found in conformance-index.ts — no-op.",
  );
  process.exit(0);
}

if (!existsSync(COQDIR)) {
  console.log(
    "check-proof-refs: formal/coq/ does not exist yet — proof traceability check deferred.",
  );
  console.log(`  Pending proof references (${proofRefsById.size} rule(s)):`);
  for (const [id, refs] of proofRefsById) {
    console.log(`    ${id}: ${refs.join(", ")}`);
  }
  process.exit(0);
}

const vFiles = await collectVFiles(COQDIR);
const vContents = await Promise.all(
  vFiles.map(async (f) => ({ file: f, text: await readFile(f, "utf-8") })),
);

let failures = 0;
for (const [id, refs] of proofRefsById) {
  for (const theorem of refs) {
    // TODO: use word-boundary regex instead of includes to avoid substring
    // false positives. Tracked: https://github.com/hedge-lang/hedge/issues/129
    const found = vContents.some(({ text }) => text.includes(theorem));
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
  process.exit(1);
}

console.log("check-proof-refs: all proof references resolve.");
