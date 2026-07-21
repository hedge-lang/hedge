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
    expect(result.error.message).toContain("amp_amp");
  });

  it("still rejects a bare lifetime with no leading & in type position", (): void => {
    const { tokens } = tokenize("'a");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toContain("Slice 2");
    expect(result.error.message).toContain("lifetime");
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

  it("still rejects a slice type ([T], no semicolon) with the existing Slice 1 guardrail", (): void => {
    const { tokens } = tokenize("[i32]");
    const result = parseType(tokens, 0);
    assert(isErr(result), "Expected an error result");
    expect(result.error.message).toContain("slice types");
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
