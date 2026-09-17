import { describe, expect, it } from "vitest";

import { assert } from "./assert.js";
import { tokenize } from "./lexer/lexer.js";
import { isNone, isSome } from "./option.js";
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

  it("declares exactly Clone, PartialEq, Eq, PartialOrd, Ord, Default, Drop, Neg, Not, and the ten Assign traits", (): void => {
    const { tokens } = tokenize(PRELUDE_SOURCE);
    const { program } = parse(tokens);
    assert(isSome(program), "prelude failed to parse");
    const traitNames = program.value.items
      .filter((item) => item.kind === "Trait")
      .map((item) => item.name.text);
    expect(traitNames).toEqual([
      "Clone",
      "PartialEq",
      "Eq",
      "PartialOrd",
      "Ord",
      "Default",
      "Drop",
      "Neg",
      "Not",
      "AddAssign",
      "SubAssign",
      "MulAssign",
      "DivAssign",
      "RemAssign",
      "BitAndAssign",
      "BitOrAssign",
      "BitXorAssign",
      "ShlAssign",
      "ShrAssign",
    ]);
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

  it("gives PartialOrd a `partial_cmp` method with a PartialEq supertrait, and Ord a `cmp` method with Eq and PartialOrd supertraits", (): void => {
    const { tokens } = tokenize(PRELUDE_SOURCE);
    const { program } = parse(tokens);
    assert(isSome(program), "prelude failed to parse");
    const traits = program.value.items.filter((item) => item.kind === "Trait");
    const partialOrd = traits.find((item) => item.name.text === "PartialOrd");
    const ord = traits.find((item) => item.name.text === "Ord");
    assert(
      partialOrd !== undefined && ord !== undefined,
      "PartialOrd and Ord must both be declared",
    );
    const partialOrdMethods = partialOrd.items
      .filter((member) => member.kind === "FunctionSignature")
      .map((member) => member.name.text);
    expect(partialOrdMethods).toEqual(["partial_cmp"]);
    expect(
      partialOrd.supertraits.map((bound) =>
        bound.kind === "PathTraitBound" ? bound.path.segments.join("::") : "",
      ),
    ).toEqual(["PartialEq"]);
    const ordMethods = ord.items
      .filter((member) => member.kind === "FunctionSignature")
      .map((member) => member.name.text);
    expect(ordMethods).toEqual(["cmp"]);
    expect(
      ord.supertraits.map((bound) =>
        bound.kind === "PathTraitBound" ? bound.path.segments.join("::") : "",
      ),
    ).toEqual(["Eq", "PartialOrd"]);
  });

  it("declares an Ordering enum with Less, Equal, and Greater unit variants", (): void => {
    const { tokens } = tokenize(PRELUDE_SOURCE);
    const { program } = parse(tokens);
    assert(isSome(program), "prelude failed to parse");
    const ordering = program.value.items.find(
      (item) => item.kind === "Enum" && item.name.text === "Ordering",
    );
    assert(ordering?.kind === "Enum", "Ordering must be declared as an enum");
    expect(ordering.variants.map((variant) => variant.name.text)).toEqual([
      "Less",
      "Equal",
      "Greater",
    ]);
    expect(ordering.variants.every((variant) => isNone(variant.body))).toBe(
      true,
    );
  });
});
