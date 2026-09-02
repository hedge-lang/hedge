import { describe, it, expect } from "vitest";
import { assert } from "../assert.js";
import { none, some } from "../option.js";
import { isErr } from "../result.js";
import { tokenize } from "../lexer/lexer.js";
import { parseType } from "./type.js";

describe("parseType - reference types", (): void => {
  it("parses &i32 as a shared reference with no lifetime annotation", (): void => {
    const { tokens } = tokenize("&i32");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      mutable: false,
      lifetime: none(),
      referent: { kind: "NamedType", path: { segments: ["i32"] } },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses &mut i32 as an exclusive reference with no lifetime annotation", (): void => {
    const { tokens } = tokenize("&mut i32");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      mutable: true,
      lifetime: none(),
      referent: { kind: "NamedType", path: { segments: ["i32"] } },
    });
  });

  it("parses &'a i32 with an explicit lifetime, stored without the leading quote", (): void => {
    const { tokens } = tokenize("&'a i32");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      mutable: false,
      lifetime: some({ kind: "Lifetime", name: "a" }),
      referent: { kind: "NamedType", path: { segments: ["i32"] } },
    });
  });

  it("parses &'a mut i32 with lifetime preceding mut, per the grammar", (): void => {
    const { tokens } = tokenize("&'a mut i32");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      mutable: true,
      lifetime: some({ kind: "Lifetime", name: "a" }),
      referent: { kind: "NamedType", path: { segments: ["i32"] } },
    });
  });

  it("rejects && rather than silently mis-parsing it as a double reference, since the lexer emits && as one amp_amp token with no split-on-reparse", (): void => {
    const { tokens } = tokenize("&&i32");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toBe("expected a type, found `amp_amp`");
  });

  it("still rejects a bare lifetime with no leading & in type position", (): void => {
    const { tokens } = tokenize("'a");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toBe(
      "lifetime annotations are not yet supported",
    );
  });
});

describe("parseType - array types", (): void => {
  it("parses [i32; 3] as a fixed-size array type", (): void => {
    const { tokens } = tokenize("[i32; 3]");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ArrayType",
      elementType: { kind: "NamedType", path: { segments: ["i32"] } },
      length: { kind: "IntLiteral", value: "3" },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("still rejects a slice type ([T], no semicolon) with the existing guardrail", (): void => {
    const { tokens } = tokenize("[i32]");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toBe(
      "slice types (`[T]`) are not yet supported",
    );
  });

  it("parses [[i32; 2]; 3] as a nested array type", (): void => {
    const { tokens } = tokenize("[[i32; 2]; 3]");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ArrayType",
      elementType: {
        kind: "ArrayType",
        elementType: { kind: "NamedType", path: { segments: ["i32"] } },
        length: { kind: "IntLiteral", value: "2" },
      },
      length: { kind: "IntLiteral", value: "3" },
    });
  });

  it("parses a non-literal (identifier) array length, since semantic analysis const-folds it", (): void => {
    const { tokens } = tokenize("[i32; N]");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ArrayType",
      elementType: { kind: "NamedType", path: { segments: ["i32"] } },
      length: { kind: "PathExpression", path: { segments: ["N"] } },
    });
  });
});

describe("parseType - generic type arguments", (): void => {
  it("parses Vec<T> as a named type with one type argument", (): void => {
    const { tokens } = tokenize("Vec<T>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Vec"] },
      typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses Foo<Foo<T>>, splitting the trailing >> across both nesting levels", (): void => {
    const { tokens } = tokenize("Foo<Foo<T>>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Foo"] },
      typeArguments: [
        {
          kind: "NamedType",
          path: { segments: ["Foo"] },
          typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
        },
      ],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses Foo<T, U> as a multi-argument type-argument list", (): void => {
    const { tokens } = tokenize("Foo<T, U>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Foo"] },
      typeArguments: [
        { kind: "NamedType", path: { segments: ["T"] } },
        { kind: "NamedType", path: { segments: ["U"] } },
      ],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("still produces the lifetime guardrail diagnostic for Ref<'a, T>", (): void => {
    const { tokens } = tokenize("Ref<'a, T>");
    const lt = tokens.find((t) => t.kind === "lt");
    assert(lt !== undefined, "Expected to find a lt token");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toBe(
      "lifetime arguments are not yet supported",
    );
    expect(result.error.span).toEqual(some(lt.span));
  });

  it("parses Foo<Bar<Baz<T>>>, splitting the trailing >>> across all three nesting levels", (): void => {
    const { tokens } = tokenize("Foo<Bar<Baz<T>>>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Foo"] },
      typeArguments: [
        {
          kind: "NamedType",
          path: { segments: ["Bar"] },
          typeArguments: [
            {
              kind: "NamedType",
              path: { segments: ["Baz"] },
              typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
            },
          ],
        },
      ],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses Foo<> as a named type with zero type arguments", (): void => {
    const { tokens } = tokenize("Foo<>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Foo"] },
      typeArguments: [],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses Foo<T, U,> with a trailing comma before the close", (): void => {
    const { tokens } = tokenize("Foo<T, U,>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Foo"] },
      typeArguments: [
        { kind: "NamedType", path: { segments: ["T"] } },
        { kind: "NamedType", path: { segments: ["U"] } },
      ],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("fails fast without hanging on an unterminated type-argument list (Foo<T)", (): void => {
    const { tokens } = tokenize("Foo<T");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
  });

  it("parses &Vec<T>, propagating type arguments through a reference type", (): void => {
    const { tokens } = tokenize("&Vec<T>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      referent: {
        kind: "NamedType",
        path: { segments: ["Vec"] },
        typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
      },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses [Vec<T>; 3], propagating type arguments through an array element type", (): void => {
    const { tokens } = tokenize("[Vec<T>; 3]");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ArrayType",
      elementType: {
        kind: "NamedType",
        path: { segments: ["Vec"] },
        typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
      },
      length: { kind: "IntLiteral", value: "3" },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("correctly splits a shared >> when a reference-typed argument is itself nested inside an enclosing generic list (Container<&Foo<T>>)", (): void => {
    const { tokens } = tokenize("Container<&Foo<T>>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Container"] },
      typeArguments: [
        {
          kind: "ReferenceType",
          referent: {
            kind: "NamedType",
            path: { segments: ["Foo"] },
            typeArguments: [{ kind: "NamedType", path: { segments: ["T"] } }],
          },
        },
      ],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });
});

describe("parseType - dyn types", (): void => {
  it("parses dyn Draw as a dyn type naming Draw", (): void => {
    const { tokens } = tokenize("dyn Draw");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "DynType",
      bound: {
        kind: "PathTraitBound",
        path: { segments: ["Draw"] },
        typeArguments: [],
      },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses dyn From<i32>, carrying the bound's own type arguments", (): void => {
    const { tokens } = tokenize("dyn From<i32>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "DynType",
      bound: {
        kind: "PathTraitBound",
        path: { segments: ["From"] },
        typeArguments: [{ kind: "NamedType", path: { segments: ["i32"] } }],
      },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses dyn Foo<Bar<Baz>>, splitting the trailing >> across the bound's own nesting", (): void => {
    const { tokens } = tokenize("dyn Foo<Bar<Baz>>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "DynType",
      bound: {
        kind: "PathTraitBound",
        path: { segments: ["Foo"] },
        typeArguments: [
          {
            kind: "NamedType",
            path: { segments: ["Bar"] },
            typeArguments: [{ kind: "NamedType", path: { segments: ["Baz"] } }],
          },
        ],
      },
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("parses &dyn Draw as a shared reference to a dyn type", (): void => {
    const { tokens } = tokenize("&dyn Draw");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      mutable: false,
      referent: {
        kind: "DynType",
        bound: { kind: "PathTraitBound", path: { segments: ["Draw"] } },
      },
    });
  });

  it("parses &mut dyn Draw as an exclusive reference to a dyn type", (): void => {
    const { tokens } = tokenize("&mut dyn Draw");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ReferenceType",
      mutable: true,
      referent: {
        kind: "DynType",
        bound: { kind: "PathTraitBound", path: { segments: ["Draw"] } },
      },
    });
  });

  it("parses [dyn Draw; 3] with a dyn type as the array element type", (): void => {
    const { tokens } = tokenize("[dyn Draw; 3]");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "ArrayType",
      elementType: {
        kind: "DynType",
        bound: { kind: "PathTraitBound", path: { segments: ["Draw"] } },
      },
    });
  });

  it("parses Vec<dyn Draw> with a dyn type as a generic type argument", (): void => {
    const { tokens } = tokenize("Vec<dyn Draw>");
    const result = parseType(tokens, 0);
    assert(!isErr(result), "Expected a successful parse");
    expect(result.value.node).toMatchObject({
      kind: "NamedType",
      path: { segments: ["Vec"] },
      typeArguments: [
        {
          kind: "DynType",
          bound: { kind: "PathTraitBound", path: { segments: ["Draw"] } },
        },
      ],
    });
    expect(result.value.next).toBe(tokens.length - 1);
  });

  it("rejects a bare dyn with nothing after it", (): void => {
    const { tokens } = tokenize("dyn");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
  });

  it("rejects dyn 'a, since a dyn type must name a trait, not a lifetime", (): void => {
    const { tokens } = tokenize("dyn 'a");
    const lifetimeToken = tokens.find((t) => t.kind === "lifetime");
    assert(lifetimeToken !== undefined, "Expected to find a lifetime token");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toContain("trait");
    expect(result.error.span).toEqual(some(lifetimeToken.span));
  });

  it("rejects dyn 42, since the token after dyn is not a valid path", (): void => {
    const { tokens } = tokenize("dyn 42");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
  });
});

describe("parseType - a token that cannot begin a type", (): void => {
  it("reports what it expected and what it found, not a not-yet-supported message", (): void => {
    const { tokens } = tokenize(":");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.code).toBe("HEDGE-PARSE-004");
    expect(result.error.message).toBe("expected a type, found `colon`");
  });
});
