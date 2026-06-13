import { describe, expect, it } from "vitest";

import { tokenize } from "./lexer.js";

describe("lexer", (): void => {
  it("tokenizes a simple let binding", (): void => {
    const tokens = tokenize("let x = 1;");

    expect(tokens).toHaveLength(6);
    expect(tokens).toMatchObject([
      { kind: "keyword", text: "let" },
      { kind: "ident", text: "x" },
      { kind: "punct", text: "=" },
      { kind: "int", text: "1" },
      { kind: "punct", text: ";" },
      { kind: "eof", text: "" },
    ]);
  });

  it("classifies hard keywords but not contextual ones", (): void => {
    const tokens = tokenize("fn write");

    expect(tokens).toMatchObject([
      { kind: "keyword", text: "fn" },
      { kind: "ident", text: "write" },
      { kind: "eof" },
    ]);
  });

  it("records source spans", (): void => {
    const [first] = tokenize("abc");

    expect(first).toMatchObject({ kind: "ident", span: { start: 0, end: 3 } });
  });
});
