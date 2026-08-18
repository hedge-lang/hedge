import { describe, expect, it } from "vitest";
import { assert } from "../../assert.js";
import { tokenize } from "../../lexer/lexer.js";
import type { Token } from "../../lexer/token.js";
import type * as Semantics from "../../semantics/ast.js";
import { analyzeSource } from "../../testing/analyze-source.js";
import {
  findExpressionEndTokenId,
  findStatementEndTokenId,
  findMatchingCloseBraceTokenId,
  leftmostExpressionTokenId,
  resolveSpan,
} from "./span.js";

function trailingBinaryExpression(source: string): Semantics.BinaryExpression {
  const { program } = analyzeSource(source);
  const main = program.items.find(
    (item): item is Semantics.FunctionDef =>
      item.kind === "Function" && item.signature.name.text === "main",
  );
  assert(main !== undefined, "Expected a main function");
  const trailing = main.body.trailingExpression;
  assert(trailing.kind === "Some", "Expected a trailing expression");
  assert(
    trailing.value.kind === "BinaryExpression",
    "Expected a BinaryExpression",
  );
  return trailing.value;
}

function tokensOf(source: string): readonly Token[] {
  return tokenize(source).tokens;
}

function findFirstTokenId(
  tokens: readonly Token[],
  predicate: (t: Token) => boolean,
): number {
  const id = tokens.findIndex(predicate);
  if (id === -1) throw new Error("token not found");
  return id;
}

describe("findMatchingCloseBraceTokenId", (): void => {
  it("finds the immediately matching close brace", (): void => {
    const tokens = tokensOf("fn main() { let x = 1; }");
    const open = findFirstTokenId(tokens, (t) => t.kind === "lbrace");
    const close = findMatchingCloseBraceTokenId(tokens, open);
    expect(tokens[close]?.kind).toBe("rbrace");
    expect(tokens[close + 1]?.kind).toBe("eof");
  });

  it("skips nested brace pairs to find its own match", (): void => {
    const tokens = tokensOf(
      "fn main() { let p = Boxed { value: 1 }; print(p); }",
    );
    const open = findFirstTokenId(tokens, (t) => t.kind === "lbrace");
    const close = findMatchingCloseBraceTokenId(tokens, open);
    expect(tokens[close]?.kind).toBe("rbrace");
    expect(tokens[close + 1]?.kind).toBe("eof");
  });
});

describe("findStatementEndTokenId", (): void => {
  it("returns the trailing semicolon for a simple let", (): void => {
    const tokens = tokensOf("fn main() { let x = 1 + 2; print(x); }");
    const letId = findFirstTokenId(
      tokens,
      (t) => t.kind === "keyword" && t.text === "let",
    );
    const end = findStatementEndTokenId(tokens, letId);
    expect(tokens[end]?.kind).toBe("semi");
    // the semicolon found belongs to the let statement, not the print() call
    expect(tokens[end - 1]?.kind).toBe("int");
  });

  it("does not stop at a semicolon nested inside a struct literal's braces", (): void => {
    const tokens = tokensOf(
      "fn main() { let p = Boxed { value: 1 }; print(p); }",
    );
    const letId = findFirstTokenId(
      tokens,
      (t) => t.kind === "keyword" && t.text === "let",
    );
    const end = findStatementEndTokenId(tokens, letId);
    expect(tokens[end]?.kind).toBe("semi");
    expect(tokens[end - 1]?.kind).toBe("rbrace");
  });
});

describe("findExpressionEndTokenId", (): void => {
  it("stops before the statement-terminating semicolon", (): void => {
    const tokens = tokensOf("fn main() { let x = 1 + 2; print(x); }");
    const startId = findFirstTokenId(tokens, (t) => t.kind === "int");
    const end = findExpressionEndTokenId(tokens, startId);
    expect(tokens[end]?.kind).toBe("int");
    expect(tokens[end]).toMatchObject({ text: "2" });
  });

  it("stops before a comma when the expression is a call argument", (): void => {
    const tokens = tokensOf("fn main() { print(1 + 2, 3); }");
    const startId = findFirstTokenId(tokens, (t) => t.kind === "int");
    const end = findExpressionEndTokenId(tokens, startId);
    expect(tokens[end]).toMatchObject({ kind: "int", text: "2" });
  });

  it("stops before a closing paren belonging to an enclosing call", (): void => {
    const tokens = tokensOf("fn main() { print(1 + 2); }");
    const startId = findFirstTokenId(tokens, (t) => t.kind === "int");
    const end = findExpressionEndTokenId(tokens, startId);
    expect(tokens[end]).toMatchObject({ kind: "int", text: "2" });
  });
});

describe("leftmostExpressionTokenId", (): void => {
  it("returns a non-binary expression's own tokenId", (): void => {
    const expr = trailingBinaryExpression("fn main() -> i32 { 1 + 2 }");
    expect(leftmostExpressionTokenId(expr.right)).toBe(expr.right.tokenId);
  });

  it("descends through the left operand of a binary chain", (): void => {
    // 1 + 2 + 3 parses as (1 + 2) + 3, so the outer BinaryExpression's
    // own tokenId is the second `+` operator, not `1`.
    const source = "fn main() -> i32 { 1 + 2 + 3 }";
    const tokens = tokensOf(source);
    const outer = trailingBinaryExpression(source);
    assert(outer.left.kind === "BinaryExpression");
    const oneTokenId = findFirstTokenId(
      tokens,
      (t) => t.kind === "int" && t.text === "1",
    );
    expect(leftmostExpressionTokenId(outer)).toBe(oneTokenId);
  });
});

describe("resolveSpan", (): void => {
  it("spans from the start token's start to the end token's end", (): void => {
    const tokens = tokensOf("let x = 1 + 2;");
    const span = resolveSpan(tokens, 0, tokens.length - 2);
    expect(span.start).toBe(tokens[0]?.span.start);
    expect(span.end).toBe(tokens[tokens.length - 2]?.span.end);
  });
});
