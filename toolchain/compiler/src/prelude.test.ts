import { describe, expect, it } from "vitest";

import { assert } from "./assert.js";
import { tokenize } from "./lexer/lexer.js";
import { isSome } from "./option.js";
import { parse } from "./parser/parser.js";
import { PRELUDE_SOURCE } from "./prelude.js";
import { analyze } from "./semantics/analyzer.js";

describe("std prelude", (): void => {
  it("parses and analyzes with zero diagnostics", (): void => {
    const { tokens, diagnostics: lexDiagnostics } = tokenize(PRELUDE_SOURCE);
    expect(lexDiagnostics).toEqual([]);
    const { program, diagnostics: parseDiagnostics } = parse(tokens);
    expect(parseDiagnostics).toEqual([]);
    assert(isSome(program), "prelude failed to parse");
    expect(analyze(program.value, tokens).diagnostics).toEqual([]);
  });

  it("declares exactly Clone, PartialEq, Eq, Default, and Drop as traits", (): void => {
    const { tokens } = tokenize(PRELUDE_SOURCE);
    const { program } = parse(tokens);
    assert(isSome(program), "prelude failed to parse");
    const traitNames = program.value.items
      .filter((item) => item.kind === "Trait")
      .map((item) => item.name.text);
    expect(traitNames).toEqual(["Clone", "PartialEq", "Eq", "Default", "Drop"]);
  });

  it("gives PartialEq an `eq` method and Eq a PartialEq supertrait", (): void => {
    const { tokens } = tokenize(PRELUDE_SOURCE);
    const { program } = parse(tokens);
    assert(isSome(program), "prelude failed to parse");
    const traits = program.value.items.filter((item) => item.kind === "Trait");
    const partialEq = traits.find((item) => item.name.text === "PartialEq");
    const eq = traits.find((item) => item.name.text === "Eq");
    assert(
      partialEq !== undefined && eq !== undefined,
      "PartialEq and Eq must both be declared",
    );
    const partialEqMethods = partialEq.items
      .filter((member) => member.kind === "FunctionSignature")
      .map((member) => member.name.text);
    expect(partialEqMethods).toEqual(["eq"]);
    expect(
      eq.supertraits.map((bound) =>
        bound.kind === "PathTraitBound" ? bound.path.segments.join("::") : "",
      ),
    ).toEqual(["PartialEq"]);
  });
});
