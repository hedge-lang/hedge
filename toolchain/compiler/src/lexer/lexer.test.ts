import { describe, expect, it } from "vitest";

import { none, some } from "../option.js";
import { tokenize } from "./lexer.js";
import { type Token } from "./token.js";

describe("lexer", (): void => {
  it("tokenizes a simple let binding", (): void => {
    const { tokens } = tokenize("let x = 1;");

    expect(tokens).toHaveLength(6);
    expect(tokens).toMatchObject([
      { kind: "keyword", text: "let" },
      { kind: "ident", text: "x" },
      { kind: "eq" },
      { kind: "int", text: "1", radix: 10, suffix: none() },
      { kind: "semi" },
      { kind: "eof" },
    ]);
  });

  it("classifies hard keywords but not contextual ones", (): void => {
    const { tokens } = tokenize("fn write");

    expect(tokens).toMatchObject([
      { kind: "keyword", text: "fn" },
      { kind: "ident", text: "write" },
      { kind: "eof" },
    ]);
  });

  describe("keywords", () => {
    it.each([
      "as",
      "async",
      "await",
      "break",
      "const",
      "continue",
      "dyn",
      "else",
      "enum",
      "export",
      "extern",
      "false",
      "fn",
      "for",
      "if",
      "impl",
      "in",
      "let",
      "loop",
      "match",
      "move",
      "pub",
      "return",
      "self",
      "Self",
      "static",
      "struct",
      "super",
      "trait",
      "true",
      "type",
      "unsafe",
      "use",
      "where",
      "while",
    ])("%s", (keyword) => {
      const { tokens } = tokenize(keyword);
      const [first] = tokens;
      expect(first).toMatchObject({ kind: "keyword", text: keyword });
    });
  });

  it("records source spans", (): void => {
    const { tokens } = tokenize("abc");
    const [first] = tokens;

    expect(first).toMatchObject({ kind: "ident", span: { start: 0, end: 3 } });
  });

  it("parses the tracer bullet", (): void => {
    const { tokens } = tokenize(`
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
        const { tokens } = tokenize(`
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
        const { tokens } = tokenize(`
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
      it("returns a diagnostic if a block comment is not closed", () => {
        const tokens = tokenize(
          `/* this is a block comment without a closing delimiter`,
        );
        expect(tokens.diagnostics).toMatchObject([
          { severity: "error", message: "Unterminated block comment" },
        ]);
      });

      it("emits exactly one diagnostic for an unterminated block comment (no cascade)", () => {
        const result = tokenize("/* unclosed\nlet x = 1;");
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain("Unterminated");
      });

      it("includes block comments with a /** starter", () => {
        const { tokens } = tokenize(`
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
        const { tokens } = tokenize(`
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
        const { tokens } = tokenize(`
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
        const { tokens } = tokenize(`
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
      const { tokens } = tokenize("#[derive(Clone)] fn f() {}");

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
      const { tokens } = tokenize("/// Greeting\nfn f() {}");

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
      const { tokens } = tokenize("== != <= >=");
      expect(tokens).toMatchObject([
        { kind: "eq_eq" },
        { kind: "bang_eq" },
        { kind: "lt_eq" },
        { kind: "gt_eq" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes logical operators", () => {
      const { tokens } = tokenize("&& ||");
      expect(tokens).toMatchObject([
        { kind: "amp_amp" },
        { kind: "pipe_pipe" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes shift operators and their assign forms", () => {
      const { tokens } = tokenize("<< >> <<= >>=");
      expect(tokens).toMatchObject([
        { kind: "lt_lt" },
        { kind: "gt_gt" },
        { kind: "lt_lt_eq" },
        { kind: "gt_gt_eq" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes compound assignment operators", () => {
      const { tokens } = tokenize("+= -= *= /= %= &= |= ^=");
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
      const { tokens } = tokenize("-> => ::");
      expect(tokens).toMatchObject([
        { kind: "arrow" },
        { kind: "fat_arrow" },
        { kind: "path_sep" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes range operators", () => {
      const { tokens } = tokenize(".. ..=");
      expect(tokens).toMatchObject([
        { kind: "dot_dot" },
        { kind: "dot_dot_eq" },
        { kind: "eof" },
      ]);
    });

    it("does not greedily consume when single-char is correct", () => {
      const { tokens } = tokenize("< > = ! & |");
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
      const { tokens } = tokenize("'a");
      expect(tokens).toMatchObject([
        { kind: "lifetime", text: "a" },
        { kind: "eof" },
      ]);
    });

    it("tokenizes a named lifetime", () => {
      const { tokens } = tokenize("'static");
      expect(tokens).toMatchObject([
        { kind: "lifetime", text: "static" },
        { kind: "eof" },
      ]);
    });

    it("emits an error token for a bare single quote not followed by an identifier", () => {
      const result = tokenize("'");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain("Unexpected character");
      expect(result.tokens).toMatchObject([
        { kind: "error", text: "'" },
        { kind: "eof" },
      ]);

      const result2 = tokenize("' ");
      expect(result2.diagnostics).toHaveLength(1);
      expect(result2.diagnostics[0]?.message).toContain("Unexpected character");
    });
  });

  describe("identifiers", () => {
    describe("Unicode", () => {
      it("accepts a Unicode letter as IdentStart", () => {
        const { tokens } = tokenize("π");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "π" },
          { kind: "eof" },
        ]);
      });

      it("accepts Unicode identifier-continue characters", () => {
        const { tokens } = tokenize("café");
        expect(tokens[0]).toMatchObject({
          kind: "ident",
          text: "café",
          span: { start: 0, end: 4 },
        });
      });

      it("accepts ZWNJ (U+200C) as an identifier-continue character", () => {
        const { tokens } = tokenize("a‌b");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "a‌b" },
          { kind: "eof" },
        ]);
      });

      it("accepts ZWNJ via explicit \\u200C escape", () => {
        const { tokens } = tokenize("a\u200Cb");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "a\u200Cb" },
          { kind: "eof" },
        ]);
      });

      it("accepts ZWJ (U+200D) as an identifier-continue character", () => {
        const { tokens } = tokenize("a‍b");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "a‍b" },
          { kind: "eof" },
        ]);
      });

      it("accepts ZWJ via explicit \\u200D escape", () => {
        const { tokens } = tokenize("a\u200Db");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "a\u200Db" },
          { kind: "eof" },
        ]);
      });

      it("accepts $ as IdentStart", () => {
        expect(tokenize("$valid").tokens[0]).toMatchObject({
          kind: "ident",
          text: "$valid",
        });
      });

      it("accepts _ alone as an identifier", () => {
        expect(tokenize("_").tokens[0]).toMatchObject({
          kind: "ident",
          text: "_",
        });
      });

      it("accepts a non-Latin Unicode IdentStart (Cyrillic)", () => {
        expect(tokenize("б").tokens[0]).toMatchObject({
          kind: "ident",
          text: "б",
        });
      });
    });

    describe("raw identifiers", () => {
      it("lexes r#fn as an ident token with text 'fn'", () => {
        expect(tokenize("r#fn").tokens).toMatchObject([
          { kind: "ident", text: "fn" },
          { kind: "eof" },
        ]);
      });

      it("raw identifier span covers the r# prefix", () => {
        expect(tokenize("r#fn").tokens[0]).toMatchObject({
          span: { start: 0, end: 4 },
        });
      });

      it("lexes r#let as an ident", () => {
        expect(tokenize("r#let").tokens[0]).toMatchObject({
          kind: "ident",
          text: "let",
        });
      });

      it("lexes r#write the same as write", () => {
        const raw = tokenize("r#write").tokens[0];
        const plain = tokenize("write").tokens[0];
        expect(raw).toMatchObject({ kind: "ident", text: "write" });
        expect(plain).toMatchObject({ kind: "ident", text: "write" });
      });

      it("r# not followed by an ident-start is a lex error", () => {
        const { tokens, diagnostics } = tokenize("r# ");
        expect(tokens[0]).toMatchObject({
          kind: "error",
          text: "r#",
          span: { start: 0, end: 2 },
        });
        expect(diagnostics[0]?.message).toContain("r#");
      });

      it("r# followed by a digit is a lex error (digits are not IdentStart)", () => {
        const { tokens, diagnostics } = tokenize("r#1");
        expect(tokens[0]).toMatchObject({
          kind: "error",
          text: "r#",
          span: { start: 0, end: 2 },
        });
        expect(tokens[1]).toMatchObject({ kind: "int", text: "1" });
        expect(diagnostics[0]?.message).toContain("r#");
      });

      it("r# at end of input is a lex error", () => {
        const { tokens, diagnostics } = tokenize("r#");
        expect(tokens[0]).toMatchObject({
          kind: "error",
          text: "r#",
          span: { start: 0, end: 2 },
        });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.message).toContain("r#");
      });

      it("r#$ — raw ident starting with dollar sign", () => {
        expect(tokenize("r#$").tokens[0]).toMatchObject({
          kind: "ident",
          text: "$",
        });
      });

      it("r#_ — raw ident starting with underscore", () => {
        expect(tokenize("r#_").tokens[0]).toMatchObject({
          kind: "ident",
          text: "_",
        });
      });

      it("r#r — raw ident where the name is the sigil character", () => {
        expect(tokenize("r#r").tokens[0]).toMatchObject({
          kind: "ident",
          text: "r",
        });
      });

      it("r#true — boolean keyword escaped as raw ident", () => {
        expect(tokenize("r#true").tokens[0]).toMatchObject({
          kind: "ident",
          text: "true",
        });
      });

      it("r#false — boolean keyword escaped as raw ident", () => {
        expect(tokenize("r#false").tokens[0]).toMatchObject({
          kind: "ident",
          text: "false",
        });
      });

      it("r#π — raw ident with Unicode IdentStart", () => {
        expect(tokenize("r#π").tokens[0]).toMatchObject({
          kind: "ident",
          text: "π",
        });
      });
    });

    describe("keyword-prefix identifiers are not split", () => {
      it("let_count is a single ident, not keyword(let) + ident(_count)", () => {
        const { tokens } = tokenize("let_count");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "let_count" },
          { kind: "eof" },
        ]);
      });

      it("fn_helper is a single ident, not keyword(fn) + ident(_helper)", () => {
        const { tokens } = tokenize("fn_helper");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "fn_helper" },
          { kind: "eof" },
        ]);
      });

      it("in_scope is a single ident, not keyword(in) + ident(_scope)", () => {
        const { tokens } = tokenize("in_scope");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "in_scope" },
          { kind: "eof" },
        ]);
      });

      it("for_each is a single ident, not keyword(for) + ident(_each)", () => {
        const { tokens } = tokenize("for_each");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "for_each" },
          { kind: "eof" },
        ]);
      });

      it("let1 is a single ident, not keyword(let) + int(1)", () => {
        const { tokens } = tokenize("let1");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "let1" },
          { kind: "eof" },
        ]);
      });

      it("fn1 is a single ident, not keyword(fn) + int(1)", () => {
        const { tokens } = tokenize("fn1");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "fn1" },
          { kind: "eof" },
        ]);
      });

      it("truefalse is a single ident, not keyword(true) + keyword(false)", () => {
        const { tokens } = tokenize("truefalse");
        expect(tokens).toMatchObject([
          { kind: "ident", text: "truefalse" },
          { kind: "eof" },
        ]);
      });
    });

    describe("lifetime tokens with keyword text", () => {
      it.each(["fn", "let", "for", "while", "if"])(
        "'%s produces a lifetime token, not a keyword",
        (kw) => {
          const { tokens } = tokenize(`'${kw}`);
          expect(tokens[0]).toMatchObject({ kind: "lifetime", text: kw });
        },
      );
    });

    describe("reserved keywords", () => {
      it.each(["mut", "mod", "box", "macro", "yield"])(
        "classifies %s as a keyword token",
        (kw) => {
          expect(tokenize(kw).tokens[0]).toMatchObject({
            kind: "keyword",
            text: kw,
          });
        },
      );

      it("r#mut is a valid raw identifier", () => {
        expect(tokenize("r#mut").tokens[0]).toMatchObject({
          kind: "ident",
          text: "mut",
        });
      });
    });
  });

  describe("types", () => {
    describe.each([
      "i8",
      "u8",
      "i16",
      "u16",
      "i32",
      "u32",
      "i64",
      "u64",
      "f32",
      "f64",
      "str",
    ])("%s", (t) => {
      it(`parses \`let value: ${t};\``, () => {
        expect(tokenize(`let value: ${t};`).tokens).toMatchObject([
          { kind: "keyword", text: "let" },
          { kind: "ident", text: "value" },
          { kind: "colon" },
          { kind: "ident", text: t },
          { kind: "semi" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`let value: &${t};\``, () => {
        expect(tokenize(`let value: &${t};`).tokens).toMatchObject([
          { kind: "keyword", text: "let" },
          { kind: "ident", text: "value" },
          { kind: "colon" },
          { kind: "amp" },
          { kind: "ident", text: t },
          { kind: "semi" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`fn foo() -> ${t} {}\``, () => {
        expect(tokenize(`fn foo() -> ${t} {}`).tokens).toMatchObject([
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "foo" },
          { kind: "lparen" },
          { kind: "rparen" },
          { kind: "arrow" },
          { kind: "ident", text: t },
          { kind: "lbrace" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`fn foo<'a>() -> &'a ${t} {}\``, () => {
        expect(tokenize(`fn foo<'a>() -> &'a ${t} {}`).tokens).toMatchObject([
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "foo" },
          { kind: "lt" },
          { kind: "lifetime", text: "a" },
          { kind: "gt" },
          { kind: "lparen" },
          { kind: "rparen" },
          { kind: "arrow" },
          { kind: "amp" },
          { kind: "lifetime", text: "a" },
          { kind: "ident", text: t },
          { kind: "lbrace" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`fn foo(param: ${t}) {}`, () => {
        expect(tokenize(`fn foo(param: ${t}) {}`).tokens).toMatchObject([
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "foo" },
          { kind: "lparen" },
          { kind: "ident", text: "param" },
          { kind: "colon" },
          { kind: "ident", text: t },
          { kind: "rparen" },
          { kind: "lbrace" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`fn foo(param: &${t}) {}`, () => {
        expect(tokenize(`fn foo(param: &${t}) {}`).tokens).toMatchObject([
          { kind: "keyword", text: "fn" },
          { kind: "ident", text: "foo" },
          { kind: "lparen" },
          { kind: "ident", text: "param" },
          { kind: "colon" },
          { kind: "amp" },
          { kind: "ident", text: t },
          { kind: "rparen" },
          { kind: "lbrace" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`struct Foo(${t});\``, () => {
        expect(tokenize(`struct Foo(${t});`).tokens).toMatchObject([
          { kind: "keyword", text: "struct" },
          { kind: "ident", text: "Foo" },
          { kind: "lparen" },
          { kind: "ident", text: t },
          { kind: "rparen" },
          { kind: "semi" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`struct Foo { value: ${t} }\``, () => {
        expect(tokenize(`struct Foo { value: ${t} }`).tokens).toMatchObject([
          { kind: "keyword", text: "struct" },
          { kind: "ident", text: "Foo" },
          { kind: "lbrace" },
          { kind: "ident", text: "value" },
          { kind: "colon" },
          { kind: "ident", text: t },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`enum Foo { Variant(${t}) }\``, () => {
        expect(tokenize(`enum Foo { Variant(${t}) }`).tokens).toMatchObject([
          { kind: "keyword", text: "enum" },
          { kind: "ident", text: "Foo" },
          { kind: "lbrace" },
          { kind: "ident", text: "Variant" },
          { kind: "lparen" },
          { kind: "ident", text: t },
          { kind: "rparen" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });

      it(`parses \`enum Foo { Variant { value: ${t} } }\``, () => {
        expect(
          tokenize(`enum Foo { Variant { value: ${t} } }`).tokens,
        ).toMatchObject([
          { kind: "keyword", text: "enum" },
          { kind: "ident", text: "Foo" },
          { kind: "lbrace" },
          { kind: "ident", text: "Variant" },
          { kind: "lbrace" },
          { kind: "ident", text: "value" },
          { kind: "colon" },
          { kind: "ident", text: t },
          { kind: "rbrace" },
          { kind: "rbrace" },
          { kind: "eof" },
        ]);
      });
    });
  });

  it("tokenizes `pub(package) fn lib() {}`", () => {
    const { tokens, diagnostics } = tokenize("pub(package) fn lib() {}");
    expect(diagnostics).toHaveLength(0);
    expect(tokens).toMatchObject([
      { kind: "keyword", text: "pub" },
      { kind: "lparen" },
      { kind: "ident", text: "package" },
      { kind: "rparen" },
      { kind: "keyword", text: "fn" },
      { kind: "ident", text: "lib" },
      { kind: "lparen" },
      { kind: "rparen" },
      { kind: "lbrace" },
      { kind: "rbrace" },
      { kind: "eof" },
    ]);
  });
});

describe("string literals", () => {
  it("empty string produces a string token with empty text", () => {
    const { tokens } = tokenize('""');
    expect(tokens).toMatchObject([
      { kind: "string", text: "" },
      { kind: "eof" },
    ]);
  });

  it("unterminated string produces an error token and a diagnostic", () => {
    const { tokens, diagnostics } = tokenize('"hello');
    expect(tokens[0]).toMatchObject({ kind: "error" });
    expect(diagnostics[0]?.message).toContain("Unterminated");
  });

  describe("escape sequences", () => {
    it("\\n escape inside a string produces a single string token", () => {
      const { tokens } = tokenize('"hello\\nworld"');
      expect(tokens).toMatchObject([{ kind: "string" }, { kind: "eof" }]);
      expect(tokens).toHaveLength(2);
    });

    it("\\t escape", () => {
      const { tokens } = tokenize('"\\t"');
      expect(tokens).toMatchObject([
        { kind: "string", text: "\\t" },
        { kind: "eof" },
      ]);
    });

    it("escaped backslash \\\\", () => {
      // Hedge source: "\\" — a string containing one backslash
      const { tokens } = tokenize(`"\\\\"`);
      expect(tokens).toMatchObject([{ kind: "string" }, { kind: "eof" }]);
      expect(tokens).toHaveLength(2);
    });

    it('escaped double quote \\"', () => {
      // Hedge source: "\"hello\"" — escapes preserved in token text
      const { tokens } = tokenize(`"\\"hello\\""`);
      expect(tokens).toMatchObject([{ kind: "string" }, { kind: "eof" }]);
    });

    it("invalid escape \\q produces an error token and diagnostic", () => {
      const { tokens, diagnostics } = tokenize('"\\q"');
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("escape");
    });

    it("invalid escape \\q does not produce a second 'unterminated' diagnostic", () => {
      const { diagnostics } = tokenize('"\\q"');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("escape");
    });

    it("\\x escape needs exactly 2 hex digits", () => {
      const { tokens, diagnostics } = tokenize('"\\x4"');
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("hex");
    });

    it("\\u{} with no digits is an error", () => {
      const { tokens, diagnostics } = tokenize('"\\u{}"');
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("unicode");
    });

    describe("unicode escape range validation", () => {
      it("\\u{10FFFF} is the max valid code point", () => {
        const { tokens } = tokenize('"\\u{10FFFF}"');
        expect(tokens[0]).toMatchObject({ kind: "string" });
      });

      it("\\u{110000} (above max) is a lex error", () => {
        const { tokens, diagnostics } = tokenize('"\\u{110000}"');
        expect(tokens[0]).toMatchObject({ kind: "error" });
        expect(diagnostics[0]?.message).toContain("range");
      });

      it("\\u{D800} (low surrogate) is a lex error", () => {
        const { tokens, diagnostics } = tokenize('"\\u{D800}"');
        expect(tokens[0]).toMatchObject({ kind: "error" });
        expect(diagnostics[0]?.message).toContain("surrogate");
      });

      it("\\u{DFFF} (high surrogate) is a lex error", () => {
        const { tokens, diagnostics } = tokenize('"\\u{DFFF}"');
        expect(tokens[0]).toMatchObject({ kind: "error" });
        expect(diagnostics[0]?.message).toContain("surrogate");
      });

      it("\\u{1234567} (too many digits) is a lex error", () => {
        const { tokens, diagnostics } = tokenize('"\\u{1234567}"');
        expect(tokens[0]).toMatchObject({ kind: "error" });
        expect(diagnostics[0]?.message).toContain("too many digits");
      });
    });
  });

  describe("raw strings", () => {
    it('r"hello" is a string token with text hello', () => {
      const { tokens } = tokenize('r"hello"');
      expect(tokens).toMatchObject([
        { kind: "string", text: "hello" },
        { kind: "eof" },
      ]);
    });

    it('r#"say "hi""# is a string token preserving inner quotes', () => {
      const { tokens } = tokenize('r#"say "hi""#');
      expect(tokens).toMatchObject([
        { kind: "string", text: 'say "hi"' },
        { kind: "eof" },
      ]);
    });

    it('r##"hello"## is a valid raw string token', () => {
      const { tokens } = tokenize('r##"hello"##');
      expect(tokens).toMatchObject([
        { kind: "string", text: "hello" },
        { kind: "eof" },
      ]);
    });

    it('r##"say "# world"## preserves inner quote-hash that does not match closing delimiter', () => {
      const { tokens } = tokenize('r##"say "# world"##');
      expect(tokens).toMatchObject([
        { kind: "string", text: 'say "# world' },
        { kind: "eof" },
      ]);
    });

    it('r###"hey"### is a valid three-hash raw string', () => {
      const { tokens } = tokenize('r###"hey"###');
      expect(tokens).toMatchObject([
        { kind: "string", text: "hey" },
        { kind: "eof" },
      ]);
    });

    it('r##"unclosed"# emits an unterminated error (closing delimiter needs two hashes)', () => {
      const { tokens, diagnostics } = tokenize('r##"unclosed"#');
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("Unterminated raw string");
    });
  });
});

describe("integer literals", () => {
  it("zero", () => {
    expect(tokenize("0").tokens[0]).toMatchObject({
      kind: "int",
      text: "0",
      radix: 10,
      suffix: none(),
    });
  });

  it("multi-digit", () => {
    expect(tokenize("123").tokens[0]).toMatchObject({
      kind: "int",
      text: "123",
      radix: 10,
      suffix: none(),
    });
  });

  it("numeric separator 1_000", () => {
    expect(tokenize("1_000").tokens[0]).toMatchObject({
      kind: "int",
      text: "1_000",
      radix: 10,
      suffix: none(),
    });
  });

  it("leading zero (no validation at lex time)", () => {
    expect(tokenize("007").tokens[0]).toMatchObject({
      kind: "int",
      text: "007",
      radix: 10,
      suffix: none(),
    });
  });

  it("trailing separator", () => {
    expect(tokenize("1_").tokens[0]).toMatchObject({
      kind: "int",
      text: "1_",
      radix: 10,
      suffix: none(),
    });
  });

  it("consecutive separators", () => {
    expect(tokenize("1__2").tokens[0]).toMatchObject({
      kind: "int",
      text: "1__2",
      radix: 10,
      suffix: none(),
    });
  });

  it("integer followed immediately by an identifier splits into two tokens", () => {
    expect(tokenize("42foo").tokens).toMatchObject([
      { kind: "int", text: "42", radix: 10, suffix: none() },
      { kind: "ident", text: "foo" },
      { kind: "eof" },
    ]);
  });

  describe("hex literals", () => {
    it("basic hex uppercase", () => {
      expect(tokenize("0xFF").tokens).toMatchObject([
        { kind: "int", text: "0xFF", radix: 16, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("hex with separators", () => {
      expect(tokenize("0xDEAD_BEEF").tokens).toMatchObject([
        { kind: "int", text: "0xDEAD_BEEF", radix: 16, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("hex lowercase", () => {
      expect(tokenize("0xdeadbeef").tokens).toMatchObject([
        { kind: "int", text: "0xdeadbeef", radix: 16, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("hex zero", () => {
      expect(tokenize("0x0").tokens).toMatchObject([
        { kind: "int", text: "0x0", radix: 16, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("0x with no digits is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0x");
      expect(tokens[0]).toMatchObject({
        kind: "error",
        span: { start: 0, end: 2 },
      });
      expect(diagnostics[0]?.message).toContain("hex literal");
    });

    it("0x_ (leading separator) is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0x_F");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("hex");
    });

    it("0x_ with nothing after is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0x_");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("hex");
    });
  });

  describe("octal literals", () => {
    it("basic octal", () => {
      expect(tokenize("0o77").tokens).toMatchObject([
        { kind: "int", text: "0o77", radix: 8, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("octal with separator", () => {
      expect(tokenize("0o7_7").tokens).toMatchObject([
        { kind: "int", text: "0o7_7", radix: 8, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("0o with no digits is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0o");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("octal literal");
    });

    it("digit 8 in octal is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0o9");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("octal");
    });

    it("0o_ (leading separator) is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0o_7");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("octal");
    });
  });

  describe("binary literals", () => {
    it("basic binary", () => {
      expect(tokenize("0b1010").tokens).toMatchObject([
        { kind: "int", text: "0b1010", radix: 2, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("binary with separator", () => {
      expect(tokenize("0b1_010").tokens).toMatchObject([
        { kind: "int", text: "0b1_010", radix: 2, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("0b with no digits is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0b");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("binary literal");
    });

    it("digit 2 in binary is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0b2");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("binary");
    });

    it("0b_ (leading separator) is a lex error", () => {
      const { tokens, diagnostics } = tokenize("0b_1");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("binary");
    });
  });

  describe("integer suffixes", () => {
    it.each([
      "i8",
      "i16",
      "i32",
      "i64",
      "u8",
      "u16",
      "u32",
      "u64",
      "usize",
      "isize",
    ])("decimal with %s suffix", (suffix) => {
      expect(tokenize(`42${suffix}`).tokens).toMatchObject([
        { kind: "int", text: `42${suffix}`, radix: 10, suffix: some(suffix) },
        { kind: "eof" },
      ]);
    });

    it("hex with u8 suffix", () => {
      expect(tokenize("0xFFu8").tokens).toMatchObject([
        { kind: "int", text: "0xFFu8", radix: 16, suffix: some("u8") },
        { kind: "eof" },
      ]);
    });
  });
});

describe("float literals", () => {
  it("basic float 1.0", () => {
    expect(tokenize("1.0").tokens).toMatchObject([
      { kind: "float", text: "1.0", suffix: none() },
      { kind: "eof" },
    ]);
  });

  it("multi-digit float 3.14", () => {
    expect(tokenize("3.14").tokens).toMatchObject([
      { kind: "float", text: "3.14", suffix: none() },
      { kind: "eof" },
    ]);
  });

  it("zero integer part: 0.5", () => {
    expect(tokenize("0.5").tokens).toMatchObject([
      { kind: "float", text: "0.5", suffix: none() },
      { kind: "eof" },
    ]);
  });

  it("float with underscore in integer part: 1_000.5", () => {
    expect(tokenize("1_000.5").tokens).toMatchObject([
      { kind: "float", text: "1_000.5", suffix: none() },
      { kind: "eof" },
    ]);
  });

  describe("exponent forms", () => {
    it("lowercase e exponent", () => {
      expect(tokenize("1e10").tokens).toMatchObject([
        { kind: "float", text: "1e10", suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("uppercase E exponent", () => {
      expect(tokenize("1E10").tokens).toMatchObject([
        { kind: "float", text: "1E10", suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("exponent with negative sign", () => {
      expect(tokenize("1.5e-3").tokens).toMatchObject([
        { kind: "float", text: "1.5e-3", suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("exponent with positive sign", () => {
      expect(tokenize("1.5e+3").tokens).toMatchObject([
        { kind: "float", text: "1.5e+3", suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("dot form with exponent: 0.0e0", () => {
      expect(tokenize("0.0e0").tokens).toMatchObject([
        { kind: "float", text: "0.0e0", suffix: none() },
        { kind: "eof" },
      ]);
    });
  });

  describe("float suffixes", () => {
    it("f32 suffix on dot form", () => {
      expect(tokenize("1.0f32").tokens).toMatchObject([
        { kind: "float", text: "1.0f32", suffix: some("f32") },
        { kind: "eof" },
      ]);
    });

    it("f64 suffix on dot form", () => {
      expect(tokenize("1.5f64").tokens).toMatchObject([
        { kind: "float", text: "1.5f64", suffix: some("f64") },
        { kind: "eof" },
      ]);
    });

    it("f32 suffix on exponent form", () => {
      expect(tokenize("1e10f32").tokens).toMatchObject([
        { kind: "float", text: "1e10f32", suffix: some("f32") },
        { kind: "eof" },
      ]);
    });

    it("f64 suffix on bare integer form (DecInt FloatSuffix)", () => {
      expect(tokenize("42f64").tokens).toMatchObject([
        { kind: "float", text: "42f64", suffix: some("f64") },
        { kind: "eof" },
      ]);
    });
  });

  describe("float disambiguation", () => {
    it("trailing dot is int + dot, not a float", () => {
      expect(tokenize("1.")).toMatchObject({
        tokens: [
          { kind: "int", text: "1", radix: 10, suffix: none() },
          { kind: "dot" },
          { kind: "eof" },
        ],
      });
    });

    it("method call on int: 1.method → int dot ident", () => {
      expect(tokenize("1.method").tokens).toMatchObject([
        { kind: "int", text: "1", radix: 10, suffix: none() },
        { kind: "dot" },
        { kind: "ident", text: "method" },
        { kind: "eof" },
      ]);
    });

    it("method call on float: 1.5.method → float dot ident", () => {
      expect(tokenize("1.5.method").tokens).toMatchObject([
        { kind: "float", text: "1.5", suffix: none() },
        { kind: "dot" },
        { kind: "ident", text: "method" },
        { kind: "eof" },
      ]);
    });

    it("leading dot is not a float", () => {
      expect(tokenize(".5").tokens).toMatchObject([
        { kind: "dot" },
        { kind: "int", text: "5", radix: 10, suffix: none() },
        { kind: "eof" },
      ]);
    });

    it("1.e10 is int + dot + ident, not float (dot needs digits on both sides)", () => {
      expect(tokenize("1.e10").tokens).toMatchObject([
        { kind: "int", text: "1", radix: 10, suffix: none() },
        { kind: "dot" },
        { kind: "ident", text: "e10" },
        { kind: "eof" },
      ]);
    });
  });

  describe("malformed float exponents", () => {
    it("1e with no digits is a lex error", () => {
      const { tokens, diagnostics } = tokenize("1e");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("exponent");
    });

    it("1.0e with no digits is a lex error", () => {
      const { tokens, diagnostics } = tokenize("1.0e");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("exponent");
    });

    it("1e+ emits one diagnostic and no overlapping tokens", () => {
      const { tokens, diagnostics } = tokenize("1e+");
      expect(diagnostics).toHaveLength(1);
      let prevToken: Token | null = null;
      for (const token of tokens) {
        if (prevToken) {
          expect(token.span.start).toBeGreaterThanOrEqual(prevToken.span.end);
        }
        prevToken = token;
      }
    });

    it("1.0e- emits one diagnostic and no overlapping tokens", () => {
      const { tokens, diagnostics } = tokenize("1.0e-");
      expect(diagnostics).toHaveLength(1);
      let prevToken: Token | null = null;
      for (const token of tokens) {
        if (prevToken) {
          expect(token.span.start).toBeGreaterThanOrEqual(prevToken.span.end);
        }
        prevToken = token;
      }
    });
  });
});

describe("char literals", () => {
  it("simple letter", () => {
    expect(tokenize("'a'").tokens).toMatchObject([
      { kind: "char", text: "a" },
      { kind: "eof" },
    ]);
  });

  it("uppercase letter", () => {
    expect(tokenize("'Z'").tokens).toMatchObject([
      { kind: "char", text: "Z" },
      { kind: "eof" },
    ]);
  });

  it("digit character", () => {
    expect(tokenize("'0'").tokens).toMatchObject([
      { kind: "char", text: "0" },
      { kind: "eof" },
    ]);
  });

  it("space character", () => {
    expect(tokenize("' '").tokens).toMatchObject([
      { kind: "char", text: " " },
      { kind: "eof" },
    ]);
  });

  describe("escape sequences", () => {
    it("newline escape", () => {
      expect(tokenize("'\\n'").tokens).toMatchObject([
        { kind: "char", text: "\\n" },
        { kind: "eof" },
      ]);
    });

    it("tab escape", () => {
      expect(tokenize("'\\t'").tokens).toMatchObject([
        { kind: "char", text: "\\t" },
        { kind: "eof" },
      ]);
    });

    it("backslash escape", () => {
      expect(tokenize("'\\\\'").tokens).toMatchObject([
        { kind: "char", text: "\\\\" },
        { kind: "eof" },
      ]);
    });

    it("single-quote escape", () => {
      expect(tokenize("'\\''").tokens).toMatchObject([
        { kind: "char", text: "\\'" },
        { kind: "eof" },
      ]);
    });

    it("hex escape \\x41", () => {
      expect(tokenize("'\\x41'").tokens).toMatchObject([
        { kind: "char", text: "\\x41" },
        { kind: "eof" },
      ]);
    });

    it("unicode escape \\u{41}", () => {
      expect(tokenize("'\\u{41}'").tokens).toMatchObject([
        { kind: "char", text: "\\u{41}" },
        { kind: "eof" },
      ]);
    });

    it("null escape \\0", () => {
      expect(tokenize("'\\0'").tokens).toMatchObject([
        { kind: "char", text: "\\0" },
        { kind: "eof" },
      ]);
    });

    it("carriage return escape \\r", () => {
      expect(tokenize("'\\r'").tokens).toMatchObject([
        { kind: "char", text: "\\r" },
        { kind: "eof" },
      ]);
    });

    it('double-quote escape \\"', () => {
      expect(tokenize("'\\\"'").tokens).toMatchObject([
        { kind: "char", text: '\\"' },
        { kind: "eof" },
      ]);
    });
  });

  describe("char/lifetime disambiguation", () => {
    it("'a (no closing quote) is still a lifetime", () => {
      expect(tokenize("'a").tokens).toMatchObject([
        { kind: "lifetime", text: "a" },
        { kind: "eof" },
      ]);
    });

    it("'static is a lifetime, not a char", () => {
      expect(tokenize("'static").tokens).toMatchObject([
        { kind: "lifetime", text: "static" },
        { kind: "eof" },
      ]);
    });

    it("'0' (digit) is a char literal", () => {
      expect(tokenize("'0'").tokens).toMatchObject([
        { kind: "char", text: "0" },
        { kind: "eof" },
      ]);
    });
  });

  describe("malformed char literals", () => {
    it("empty char literal '' is a lex error", () => {
      const { tokens, diagnostics } = tokenize("''");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("empty char");
    });

    it("unknown escape sequence is a lex error", () => {
      const { tokens, diagnostics } = tokenize("'\\q'");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("escape");
    });

    it("unknown escape in char literal does not produce a second error", () => {
      const { diagnostics } = tokenize("'\\q'");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("escape");
    });

    it("'\\u{110000}' (above max code point) is a lex error", () => {
      const { tokens, diagnostics } = tokenize("'\\u{110000}'");
      expect(tokens[0]).toMatchObject({ kind: "error" });
      expect(diagnostics[0]?.message).toContain("range");
    });

    it("'\\u{10FFFF}' (max valid code point) is valid", () => {
      expect(tokenize("'\\u{10FFFF}'").tokens[0]).toMatchObject({
        kind: "char",
        text: "\\u{10FFFF}",
      });
    });

    it("'ab' does not form a char literal — falls back to lifetime 'ab", () => {
      const { tokens } = tokenize("'ab'");
      // 'ab' is a lifetime named "ab" (whole ident body), then ' is an error
      expect(tokens[0]).toMatchObject({ kind: "lifetime", text: "ab" });
    });

    it("literal newline in char position is rejected — ' with \\n as n1 falls to error path", () => {
      // Source: '  newline  '  — n1 === "\n" blocks the single-char branch
      const { tokens } = tokenize("'\n'");
      expect(tokens[0]).toMatchObject({ kind: "error" });
    });

    it("astral-plane char '🦔' (U+1F994, 2 UTF-16 units) is a single char token", () => {
      const { tokens } = tokenize("'🦔'");
      expect(tokens).toMatchObject([
        { kind: "char", text: "🦔" },
        { kind: "eof" },
      ]);
      // span must cover ' + 🦔 (2 units) + ' = 4 source chars
      expect(tokens[0]?.span).toEqual({ start: 0, end: 4 });
    });
  });
});

describe("symbol tokens", () => {
  it.each([
    ["+", "plus"],
    ["-", "minus"],
    ["*", "star"],
    ["/", "slash"],
    ["%", "percent"],
    ["^", "caret"],
    [".", "dot"],
    [":", "colon"],
    ["@", "at"],
    ["?", "question"],
  ])("%s → %s", (src, kind) => {
    expect(tokenize(src).tokens[0]).toMatchObject({ kind });
  });

  it("unrecognized character ~ produces an error token and diagnostic", () => {
    const { tokens, diagnostics } = tokenize("~");
    expect(tokens[0]).toMatchObject({ kind: "error", text: "~" });
    expect(diagnostics[0]?.message).toContain("Unexpected");
  });

  it("null byte produces an error token", () => {
    const { tokens } = tokenize("\x00");
    expect(tokens[0]).toMatchObject({ kind: "error" });
  });
});

describe("lifetime edge cases", () => {
  it("'_ is a valid anonymous lifetime", () => {
    expect(tokenize("'_").tokens[0]).toMatchObject({
      kind: "lifetime",
      text: "_",
    });
  });

  it("'1 produces an error token because digits are not IdentStart", () => {
    const { tokens } = tokenize("'1");
    expect(tokens[0]).toMatchObject({ kind: "error" });
    expect(tokens[1]).toMatchObject({ kind: "int", text: "1" });
  });

  it("lifetime with multi-char Unicode body ('αβ)", () => {
    expect(tokenize("'αβ").tokens[0]).toMatchObject({
      kind: "lifetime",
      text: "αβ",
    });
  });

  it("lifetime immediately followed by colon ('a:)", () => {
    expect(tokenize("'a:").tokens).toMatchObject([
      { kind: "lifetime", text: "a" },
      { kind: "colon" },
      { kind: "eof" },
    ]);
  });
});

describe("keyword completeness", () => {
  it("Self lexes as a keyword", () => {
    expect(tokenize("Self").tokens[0]).toMatchObject({
      kind: "keyword",
      text: "Self",
    });
  });

  it.each([
    "as",
    "async",
    "await",
    "break",
    "const",
    "continue",
    "dyn",
    "else",
    "enum",
    "export",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "move",
    "pub",
    "return",
    "self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",
  ])("%s lexes as a keyword", (kw) => {
    expect(tokenize(kw).tokens[0]).toMatchObject({ kind: "keyword", text: kw });
  });
});

describe("whitespace handling", () => {
  it("empty source produces only an eof token", () => {
    const { tokens } = tokenize("");
    expect(tokens).toMatchObject([{ kind: "eof", span: { start: 0, end: 0 } }]);
    expect(tokens).toHaveLength(1);
  });

  it("tab character is skipped", () => {
    expect(tokenize("let\tx = 1;").tokens[0]).toMatchObject({
      kind: "keyword",
      text: "let",
    });
  });

  it("CR character is treated as whitespace", () => {
    expect(tokenize("let\rx = 1;").tokens[0]).toMatchObject({
      kind: "keyword",
      text: "let",
    });
  });

  it("CRLF sequence is skipped as two whitespace characters", () => {
    expect(tokenize("let\r\nx = 1;").tokens[0]).toMatchObject({
      kind: "keyword",
      text: "let",
    });
  });

  describe("CR-only line endings in line comments", () => {
    it("CR-only line ending terminates a line comment", () => {
      // parseLineComment only stops on \n; a bare \r causes the rest of source
      // to be silently consumed as comment content.
      const { tokens } = tokenize("// comment\rlet x = 1;");
      expect(tokens.some((t) => t.kind === "keyword" && t.text === "let")).toBe(
        true,
      );
    });
  });
});

describe("comment edge cases", () => {
  it("block comment nested three levels deep is ignored with no diagnostics", () => {
    const { tokens, diagnostics } = tokenize("/* a /* b /* c */ d */ e */");
    expect(tokens).toMatchObject([{ kind: "eof" }]);
    expect(diagnostics).toHaveLength(0);
  });

  it("block comment with unclosed inner comment is unterminated", () => {
    const { diagnostics } = tokenize("/* a /* */");
    expect(diagnostics[0]?.message).toContain("Unterminated");
  });

  it("CRLF after a line comment still tokenizes the following code", () => {
    const { tokens } = tokenize("// comment\r\nlet x = 1;");
    expect(tokens[0]).toMatchObject({ kind: "keyword", text: "let" });
  });
});

describe("raw identifier additional cases", () => {
  it("r#a1_$ — raw ident with mixed continue chars has correct span", () => {
    expect(tokenize("r#a1_$").tokens[0]).toMatchObject({
      kind: "ident",
      text: "a1_$",
      span: { start: 0, end: 6 },
    });
  });

  it("r#fn immediately followed by an operator splits correctly", () => {
    expect(tokenize("r#fn+").tokens).toMatchObject([
      { kind: "ident", text: "fn" },
      { kind: "plus" },
      { kind: "eof" },
    ]);
  });
});

describe("keyword adversarial", () => {
  it.each(["fn_write", "let_bind", "loop_package"])(
    "%s is a single ident token — keyword prefix must not split",
    (src) => {
      const { tokens } = tokenize(src);
      expect(tokens[0]).toMatchObject({ kind: "ident", text: src });
      expect(tokens).toHaveLength(2);
    },
  );

  it("fn immediately followed by ( produces keyword then lparen", () => {
    expect(tokenize("fn(").tokens).toMatchObject([
      { kind: "keyword", text: "fn" },
      { kind: "lparen" },
      { kind: "eof" },
    ]);
  });

  it.each(["write", "bind", "package", "unchecked"])(
    "contextual keyword %s lexes as an ident token",
    (src) => {
      expect(tokenize(src).tokens[0]).toMatchObject({
        kind: "ident",
        text: src,
      });
    },
  );

  it.each(["r#fn", "r#let", "r#Self", "r#true", "r#mut"])(
    "%s raw-escape produces an ident token with the r# prefix stripped from text",
    (src) => {
      expect(tokenize(src).tokens[0]).toMatchObject({
        kind: "ident",
        text: src.slice(2),
      });
    },
  );
});

describe("operator token spans", () => {
  it.each([
    ["<", "lt", 1],
    [">", "gt", 1],
    ["=", "eq", 1],
    ["!", "bang", 1],
    ["&", "amp", 1],
    ["|", "pipe", 1],
    ["+", "plus", 1],
    ["-", "minus", 1],
    ["*", "star", 1],
    ["/", "slash", 1],
    ["%", "percent", 1],
    ["^", "caret", 1],
    ["==", "eq_eq", 2],
    ["!=", "bang_eq", 2],
    ["<=", "lt_eq", 2],
    [">=", "gt_eq", 2],
    ["&&", "amp_amp", 2],
    ["||", "pipe_pipe", 2],
    ["<<", "lt_lt", 2],
    [">>", "gt_gt", 2],
    ["<<=", "lt_lt_eq", 3],
    [">>=", "gt_gt_eq", 3],
    ["+=", "plus_eq", 2],
    ["-=", "minus_eq", 2],
    ["*=", "star_eq", 2],
    ["/=", "slash_eq", 2],
    ["%=", "percent_eq", 2],
    ["&=", "amp_eq", 2],
    ["|=", "pipe_eq", 2],
    ["^=", "caret_eq", 2],
  ])('"%s" → %s with span {0, %i}', (src, kind, length) => {
    expect(tokenize(src).tokens[0]).toMatchObject({
      kind,
      span: { start: 0, end: length },
    });
  });
});

describe("operator tokens in expression contexts", () => {
  it("arithmetic: a + b", () => {
    expect(tokenize("a + b").tokens).toMatchObject([
      { kind: "ident", text: "a" },
      { kind: "plus" },
      { kind: "ident", text: "b" },
      { kind: "eof" },
    ]);
  });

  it("arithmetic: a - b", () => {
    expect(tokenize("a - b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "minus" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("arithmetic: a * b", () => {
    expect(tokenize("a * b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "star" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("arithmetic: a / b", () => {
    expect(tokenize("a / b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "slash" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("arithmetic: a % b", () => {
    expect(tokenize("a % b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "percent" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("comparison: 1 == 2", () => {
    expect(tokenize("1 == 2").tokens).toMatchObject([
      { kind: "int" },
      { kind: "eq_eq" },
      { kind: "int" },
      { kind: "eof" },
    ]);
  });

  it("comparison: 1 != 2", () => {
    expect(tokenize("1 != 2").tokens).toMatchObject([
      { kind: "int" },
      { kind: "bang_eq" },
      { kind: "int" },
      { kind: "eof" },
    ]);
  });

  it("comparison: a < b", () => {
    expect(tokenize("a < b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "lt" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("comparison: a > b", () => {
    expect(tokenize("a > b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "gt" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("comparison: a <= b", () => {
    expect(tokenize("a <= b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "lt_eq" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("comparison: a >= b", () => {
    expect(tokenize("a >= b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "gt_eq" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("logical: a && b", () => {
    expect(tokenize("a && b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "amp_amp" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("logical: a || b", () => {
    expect(tokenize("a || b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "pipe_pipe" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("bitwise: a & b", () => {
    expect(tokenize("a & b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "amp" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("bitwise: a ^ b", () => {
    expect(tokenize("a ^ b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "caret" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("bitwise: a | b", () => {
    expect(tokenize("a | b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "pipe" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("shift: a << b", () => {
    expect(tokenize("a << b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "lt_lt" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("shift: a >> b", () => {
    expect(tokenize("a >> b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "gt_gt" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("assignment: x = 1", () => {
    expect(tokenize("x = 1").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "eq" },
      { kind: "int" },
      { kind: "eof" },
    ]);
  });

  it.each([
    ["x += 1", "plus_eq"],
    ["x -= 1", "minus_eq"],
    ["x *= 2", "star_eq"],
    ["x /= 2", "slash_eq"],
    ["x %= 3", "percent_eq"],
    ["x &= y", "amp_eq"],
    ["x |= y", "pipe_eq"],
    ["x ^= y", "caret_eq"],
    ["x <<= 1", "lt_lt_eq"],
    ["x >>= 1", "gt_gt_eq"],
  ])("compound assignment: %s", (src, opKind) => {
    expect(tokenize(src).tokens[1]).toMatchObject({ kind: opKind });
  });

  it("mixed logical: a && b || c", () => {
    expect(tokenize("a && b || c").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "amp_amp" },
      { kind: "ident" },
      { kind: "pipe_pipe" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("mixed bitwise: a & b ^ c | d", () => {
    expect(tokenize("a & b ^ c | d").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "amp" },
      { kind: "ident" },
      { kind: "caret" },
      { kind: "ident" },
      { kind: "pipe" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("mixed arithmetic: a * b + c", () => {
    expect(tokenize("a * b + c").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "star" },
      { kind: "ident" },
      { kind: "plus" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });
});

describe("operator token disambiguation — adversarial", () => {
  it("=== splits as eq_eq then eq (no triple-equals token)", () => {
    expect(tokenize("===").tokens).toMatchObject([
      { kind: "eq_eq" },
      { kind: "eq" },
      { kind: "eof" },
    ]);
  });

  it("!== splits as bang_eq then eq", () => {
    expect(tokenize("!==").tokens).toMatchObject([
      { kind: "bang_eq" },
      { kind: "eq" },
      { kind: "eof" },
    ]);
  });

  it("&&= splits as amp_amp then eq (no logical-and-assign token)", () => {
    expect(tokenize("&&=").tokens).toMatchObject([
      { kind: "amp_amp" },
      { kind: "eq" },
      { kind: "eof" },
    ]);
  });

  it("||= splits as pipe_pipe then eq (no logical-or-assign token)", () => {
    expect(tokenize("||=").tokens).toMatchObject([
      { kind: "pipe_pipe" },
      { kind: "eq" },
      { kind: "eof" },
    ]);
  });

  it("** splits as star then star (no exponentiation token)", () => {
    expect(tokenize("**").tokens).toMatchObject([
      { kind: "star" },
      { kind: "star" },
      { kind: "eof" },
    ]);
  });

  it("-- splits as minus then minus (no decrement token)", () => {
    expect(tokenize("--").tokens).toMatchObject([
      { kind: "minus" },
      { kind: "minus" },
      { kind: "eof" },
    ]);
  });

  it("++ splits as plus then plus (no increment token)", () => {
    expect(tokenize("++").tokens).toMatchObject([
      { kind: "plus" },
      { kind: "plus" },
      { kind: "eof" },
    ]);
  });

  it("... splits as dot_dot then dot (no JS spread/rest token)", () => {
    expect(tokenize("...").tokens).toMatchObject([
      { kind: "dot_dot" },
      { kind: "dot" },
      { kind: "eof" },
    ]);
  });

  it("adjacent operators without whitespace: 1+-2", () => {
    expect(tokenize("1+-2").tokens).toMatchObject([
      { kind: "int" },
      { kind: "plus" },
      { kind: "minus" },
      { kind: "int" },
      { kind: "eof" },
    ]);
  });

  it("comparison without whitespace: a>=b", () => {
    expect(tokenize("a>=b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "gt_eq" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("shift without whitespace: a<<b", () => {
    expect(tokenize("a<<b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "lt_lt" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });

  it("compound shift-assign without whitespace: a<<=b", () => {
    expect(tokenize("a<<=b").tokens).toMatchObject([
      { kind: "ident" },
      { kind: "lt_lt_eq" },
      { kind: "ident" },
      { kind: "eof" },
    ]);
  });
});
