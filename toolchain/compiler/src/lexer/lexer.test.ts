import { describe, expect, it } from "vitest";

import { tokenize } from "./lexer.js";

describe("lexer", (): void => {
  it("tokenizes a simple let binding", (): void => {
    const { tokens } = tokenize("let x = 1;");

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
    const { tokens } = tokenize("fn write");

    expect(tokens).toMatchObject([
      { kind: "keyword", text: "fn" },
      { kind: "ident", text: "write" },
      { kind: "eof" },
    ]);
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

      it("continues lexing after an unterminated block comment", () => {
        const { tokens, diagnostics } = tokenize("/* unclosed\nlet x = 1;");
        expect(diagnostics).toHaveLength(1);
        expect(tokens.find((t) => t.kind === "keyword")).toBeDefined();
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

  describe("BUG: backslash truncates string prematurely", () => {
    it("backslash inside a string should not split it into multiple tokens", () => {
      // isStringEnd stops on '\' with no continuation logic, so "hello\nworld"
      // currently produces string("hello") + junk tokens instead of one string token.
      const { tokens } = tokenize('"hello\\nworld"');
      expect(tokens).toMatchObject([{ kind: "string" }, { kind: "eof" }]);
      expect(tokens).toHaveLength(2);
    });

    it("string containing only a backslash is a single terminated token", () => {
      // source is the 3-char sequence  "\"  (opening-quote, backslash, closing-quote)
      const { tokens } = tokenize(`"\\"`);
      expect(tokens).toMatchObject([{ kind: "string" }, { kind: "eof" }]);
      expect(tokens).toHaveLength(2);
    });
  });
});

describe("integer literals", () => {
  it("zero", () => {
    expect(tokenize("0").tokens[0]).toMatchObject({ kind: "int", text: "0" });
  });

  it("multi-digit", () => {
    expect(tokenize("123").tokens[0]).toMatchObject({
      kind: "int",
      text: "123",
    });
  });

  it("numeric separator 1_000", () => {
    expect(tokenize("1_000").tokens[0]).toMatchObject({
      kind: "int",
      text: "1_000",
    });
  });

  it("leading zero (no validation at lex time)", () => {
    expect(tokenize("007").tokens[0]).toMatchObject({
      kind: "int",
      text: "007",
    });
  });

  it("trailing separator (no validation at lex time)", () => {
    expect(tokenize("1_").tokens[0]).toMatchObject({ kind: "int", text: "1_" });
  });

  it("consecutive separators (no validation at lex time)", () => {
    expect(tokenize("1__2").tokens[0]).toMatchObject({
      kind: "int",
      text: "1__2",
    });
  });

  it("integer followed immediately by an identifier splits into two tokens", () => {
    expect(tokenize("42foo").tokens).toMatchObject([
      { kind: "int", text: "42" },
      { kind: "ident", text: "foo" },
      { kind: "eof" },
    ]);
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
    "export",
    "extern",
    "impl",
    "in",
    "loop",
    "match",
    "move",
    "return",
    "self",
    "static",
    "super",
    "trait",
    "type",
    "unsafe",
    "use",
    "where",
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

  describe("BUG: CR-only line ending swallows code into comment body", () => {
    it("CR-only line ending should terminate a line comment", () => {
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
