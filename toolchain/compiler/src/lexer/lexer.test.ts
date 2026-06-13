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

  it("parses the tracer bullet", (): void => {
    const tokens = tokenize(`
      fn main() {
        let greeting = "Hello, world!";
        print(greeting);
      }
    `);

    expect(tokens).toMatchObject([
      { kind: "keyword", text: "fn" },
      { kind: "ident", text: "main" },
      { kind: "punct", text: "(" },
      { kind: "punct", text: ")" },
      { kind: "punct", text: "{" },
      { kind: "keyword", text: "let" },
      { kind: "ident", text: "greeting" },
      { kind: "punct", text: "=" },
      { kind: "string", text: "Hello, world!" },
      { kind: "punct", text: ";" },
      { kind: "ident", text: "print" },
      { kind: "punct", text: "(" },
      { kind: "ident", text: "greeting" },
      { kind: "punct", text: ")" },
      { kind: "punct", text: ";" },
      { kind: "punct", text: "}" },
      { kind: "eof" },
    ]);
  });

  describe("comments", () => {
    describe("line comments", () => {
      it("excludes normal comments", () => {
        const tokens = tokenize(`
        a;
            // This is a comment
            // This is another comment with trailing whitespace  
            //This is a comment without leading whitespace
            b;
        `);

        expect(tokens).toMatchObject([
          { kind: "ident", text: "a" },
          { kind: "punct", text: ";" },
          { kind: "ident", text: "b" },
          { kind: "punct", text: ";" },
          { kind: "eof" },
        ]);
      });
    });

    describe("block comments", () => {
      it("excludes normal comments", () => {
        const tokens = tokenize(`
        a;
            /* This is a comment
            This is another comment with trailing whitespace   */
            /* This is a second comment */
            b;
        `);

        expect(tokens).toMatchObject([
          { kind: "ident", text: "a" },
          { kind: "punct", text: ";" },
          { kind: "ident", text: "b" },
          { kind: "punct", text: ";" },
          { kind: "eof" },
        ]);
      });
      it("throws an error if a block comment is not closed", () => {
        expect(() =>
          tokenize(`/* this is a block comment without a closing delimiter`),
        ).toThrow("Unterminated block comment");
      });

      it("includes block comments with a /** starter", () => {
        const tokens = tokenize(`
        a;
            /** This is a comment
            This is another comment with trailing whitespace   */
            b;
        `);
        expect(tokens).toMatchObject([
          {
            kind: "ident",
            text: "a",
          },
          { kind: "punct", text: ";" },
          {
            kind: "doc-outer",
            text: "This is a comment\nThis is another comment with trailing whitespace",
          },
          { kind: "ident", text: "b" },
          { kind: "punct", text: ";" },
          { kind: "eof" },
        ]);
      });

      it("includes block comments with a /*! starter", () => {
        const tokens = tokenize(`
          fn example() {
            /*! 
             * This is a comment
             * This is another comment with trailing whitespace   
             */
          }
        `);

        expect(tokens).toMatchObject([
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "example" },
          { kind: "punct", text: "(" },
          { kind: "punct", text: ")" },
          { kind: "punct", text: "{" },
          {
            kind: "doc-inner",
            text: "* This is a comment\n* This is another comment with trailing whitespace",
          },
          { kind: "punct", text: "}" },
          { kind: "eof" },
        ]);
      });
    });

    describe("doc comments", () => {
      it("creates a comment object", () => {
        const tokens = tokenize(`
          /// This is a doc comment
          /// With two lines
          ///   And some indentation
          fn example() {}
        `);

        expect(tokens).toMatchObject([
          {
            kind: "doc-outer",
            text: "This is a doc comment\nWith two lines\n  And some indentation",
          },
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "example" },
          { kind: "punct", text: "(" },
          { kind: "punct", text: ")" },
          { kind: "punct", text: "}" },
          { kind: "eof" },
        ]);
      });

      it("parses internal doc comments", () => {
        const tokens = tokenize(`
          fn example() {
            //! This is an internal doc comment
            //! With two lines
            //!   And some indentation
          }
        `);

        expect(tokens).toMatchObject([
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "example" },
          { kind: "punct", text: "(" },
          { kind: "punct", text: ")" },
          { kind: "punct", text: "{" },
          {
            kind: "doc-inner",
            text: "This is an internal doc comment\nWith two lines\n  And some indentation",
          },
          { kind: "punct", text: "}" },
          { kind: "eof" },
        ]);
      });
    });
  });
});
