import { describe, expect, it } from "vitest";

import { tokenize } from "./lexer.js";

describe("lexer", (): void => {
  it("tokenizes a simple let binding", (): void => {
    const tokens = tokenize("let x = 1;");

    expect(tokens).toHaveLength(6);
    expect(tokens).toMatchObject([
      { kind: "keyword", text: "let" },
      { kind: "ident", text: "x" },
      { kind: "eq" },
      { kind: "int", text: "1" },
      { kind: "semi" },
      { kind: "eof" },
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
      { kind: "lparen" },
      { kind: "rparen" },
      { kind: "lbrace" },
      { kind: "keyword", text: "let" },
      { kind: "ident", text: "greeting" },
      { kind: "eq" },
      { kind: "string", text: "Hello, world!" },
      { kind: "semi" },
      { kind: "ident", text: "print" },
      { kind: "lparen" },
      { kind: "ident", text: "greeting" },
      { kind: "rparen" },
      { kind: "semi" },
      { kind: "rbrace" },
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
          { kind: "semi" },
          { kind: "ident", text: "b" },
          { kind: "semi" },
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
          { kind: "semi" },
          { kind: "ident", text: "b" },
          { kind: "semi" },
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
          { kind: "semi" },
          { kind: "hash" },
          { kind: "lbracket" },
          { kind: "ident", text: "doc" },
          { kind: "lparen" },
          { kind: "string", text: "This is a comment" },
          { kind: "comma" },
          {
            kind: "string",
            text: "            This is another comment with trailing whitespace   ",
          },
          { kind: "rparen" },
          { kind: "rbracket" },
          { kind: "ident", text: "b" },
          { kind: "semi" },
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
          { kind: "lparen" },
          { kind: "rparen" },
          { kind: "lbrace" },
          { kind: "hash" },
          { kind: "bang" },
          { kind: "lbracket" },
          { kind: "ident", text: "doc" },
          { kind: "lparen" },
          { kind: "string", text: "" },
          { kind: "comma" },
          { kind: "string", text: "* This is a comment" },
          { kind: "comma" },
          {
            kind: "string",
            text: "* This is another comment with trailing whitespace   ",
          },
          { kind: "comma" },
          { kind: "string", text: "" },
          { kind: "rparen" },
          { kind: "rbracket" },
          { kind: "rbrace" },
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
          { kind: "hash" },
          { kind: "lbracket" },
          { kind: "ident", text: "doc" },
          { kind: "lparen" },
          { kind: "string", text: "This is a doc comment" },
          { kind: "comma" },
          { kind: "string", text: "With two lines" },
          { kind: "comma" },
          { kind: "string", text: "  And some indentation" },
          { kind: "rparen" },
          { kind: "rbracket" },
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "example" },
          { kind: "lparen" },
          { kind: "rparen" },
          { kind: "lbrace" },
          { kind: "rbrace" },
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
          { kind: "lparen" },
          { kind: "rparen" },
          { kind: "lbrace" },
          { kind: "hash" },
          { kind: "bang" },
          { kind: "lbracket" },
          { kind: "ident", text: "doc" },
          { kind: "lparen" },
          { kind: "string", text: "This is an internal doc comment" },
          { kind: "comma" },
          { kind: "string", text: "With two lines" },
          { kind: "comma" },
          { kind: "string", text: "  And some indentation" },
          { kind: "rparen" },
          { kind: "rbracket" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });
    });
  });

  describe("attributes", () => {
    it("tokenizes #[derive(Clone)] as discrete punctuation and identifiers", () => {
      const tokens = tokenize("#[derive(Clone)] fn f() {}");

      expect(tokens).toMatchObject([
        { kind: "hash" },
        { kind: "lbracket" },
        { kind: "ident", text: "derive" },
        { kind: "lparen" },
        { kind: "ident", text: "Clone" },
        { kind: "rparen" },
        { kind: "rbracket" },
        { kind: "keyword", text: "fn" },
        { kind: "ident", text: "f" },
        { kind: "lparen" },
        { kind: "rparen" },
        { kind: "lbrace" },
        { kind: "rbrace" },
        { kind: "eof" },
      ]);
    });

    it("lowers a single-line doc comment into a #[doc(...)] sequence", () => {
      const tokens = tokenize("/// Greeting\nfn f() {}");

      expect(tokens).toMatchObject([
        { kind: "hash" },
        { kind: "lbracket" },
        { kind: "ident", text: "doc" },
        { kind: "lparen" },
        { kind: "string", text: "Greeting" },
        { kind: "rparen" },
        { kind: "rbracket" },
        { kind: "keyword", text: "fn" },
        { kind: "ident", text: "f" },
        { kind: "lparen" },
        { kind: "rparen" },
        { kind: "lbrace" },
        { kind: "rbrace" },
        { kind: "eof" },
      ]);
    });
  });

  describe("multi-char operators", () => {
    it("tokenizes comparison operators", () => {
      const tokens = tokenize("== != <= >=");
      expect(tokens).toMatchObject([
        { kind: "eq_eq" },
        { kind: "bang_eq" },
        { kind: "lt_eq" },
        { kind: "gt_eq" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes logical operators", () => {
      const tokens = tokenize("&& ||");
      expect(tokens).toMatchObject([
        { kind: "amp_amp" },
        { kind: "pipe_pipe" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes shift operators and their assign forms", () => {
      const tokens = tokenize("<< >> <<= >>=");
      expect(tokens).toMatchObject([
        { kind: "lt_lt" },
        { kind: "gt_gt" },
        { kind: "lt_lt_eq" },
        { kind: "gt_gt_eq" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes compound assignment operators", () => {
      const tokens = tokenize("+= -= *= /= %= &= |= ^=");
      expect(tokens).toMatchObject([
        { kind: "plus_eq" },
        { kind: "minus_eq" },
        { kind: "star_eq" },
        { kind: "slash_eq" },
        { kind: "percent_eq" },
        { kind: "amp_eq" },
        { kind: "pipe_eq" },
        { kind: "caret_eq" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes arrow, fat_arrow, and path_sep", () => {
      const tokens = tokenize("-> => ::");
      expect(tokens).toMatchObject([
        { kind: "arrow" },
        { kind: "fat_arrow" },
        { kind: "path_sep" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes range operators", () => {
      const tokens = tokenize(".. ..=");
      expect(tokens).toMatchObject([
        { kind: "dot_dot" },
        { kind: "dot_dot_eq" },
        { kind: "eof" },
      ]);
    });

    it("does not greedily consume when single-char is correct", () => {
      const tokens = tokenize("< > = ! & |");
      expect(tokens).toMatchObject([
        { kind: "lt" },
        { kind: "gt" },
        { kind: "eq" },
        { kind: "bang" },
        { kind: "amp" },
        { kind: "pipe" },
        { kind: "eof" },
      ]);
    });
  });

  describe("lifetime tokens", () => {
    it("tokenizes a lifetime", () => {
      const tokens = tokenize("'a");
      expect(tokens).toMatchObject([
        { kind: "lifetime", text: "a" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes a named lifetime", () => {
      const tokens = tokenize("'static");
      expect(tokens).toMatchObject([
        { kind: "lifetime", text: "static" },
        { kind: "eof" },
      ]);
    });

    it("throws on a bare single quote not followed by an identifier", () => {
      expect(() => tokenize("'")).toThrow("Unexpected character");
      expect(() => tokenize("' ")).toThrow("Unexpected character");
    });
  });
});
