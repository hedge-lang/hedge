import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MESSAGE_MODULE = resolve(
  import.meta.dirname,
  "../toolchain/compiler/src/diagnostics/message.ts",
);

/**
 * The diagnostic message module renders DiagnosticKind to English and must
 * stay decoupled from the compiler's AST/IR layers, so a rewording can never
 * pull semantic types into scope or create an import cycle back through a
 * pass that emits diagnostics.
 */
describe("diagnostics/message.ts import isolation", (): void => {
  const source = readFileSync(MESSAGE_MODULE, "utf8");
  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line));

  it("imports only from the diagnostics module itself", (): void => {
    const forbidden = importLines.filter((line) =>
      /"\.\.\/(semantics|parser|lexer|jsim|ownership|codegen|optimization)\//.test(
        line,
      ),
    );

    expect(forbidden).toEqual([]);
  });

  it("takes no value import from sibling diagnostic modules (type-only is fine)", (): void => {
    const valueSiblingImports = importLines.filter(
      (line) =>
        /"\.\/(diagnostic|code)\.js"/.test(line) &&
        !/^\s*import type\b/.test(line),
    );

    expect(valueSiblingImports).toEqual([]);
  });
});
