import { describe, expect, it } from "vitest";

import { none } from "../option.js";
import { tokenToString } from "./token.js";
import type { Token } from "./token.js";

const span = { start: 0, end: 0 };

describe("tokenToString", (): void => {
  it("formats ident tokens", (): void => {
    const token: Token = { kind: "ident", span, text: "foo" };
    expect(tokenToString(token)).toBe("ident(foo)");
  });

  it("formats char tokens with their literal text", (): void => {
    const token: Token = { kind: "char", span, text: "'a'" };
    expect(tokenToString(token)).toBe("char('a')");
  });

  it("formats float tokens with their literal text", (): void => {
    const token: Token = { kind: "float", span, text: "1.5", suffix: none() };
    expect(tokenToString(token)).toBe("float(1.5)");
  });

  it("formats keyword tokens", (): void => {
    const token: Token = { kind: "keyword", span, text: "fn" };
    expect(tokenToString(token)).toBe("keyword(fn)");
  });

  it("formats int tokens", (): void => {
    const token: Token = {
      kind: "int",
      span,
      text: "42",
      radix: 10,
      suffix: none(),
    };
    expect(tokenToString(token)).toBe("int(42)");
  });

  it("formats string tokens", (): void => {
    const token: Token = { kind: "string", span, text: "hello" };
    expect(tokenToString(token)).toBe("string(hello)");
  });

  it("formats lifetime tokens", (): void => {
    const token: Token = { kind: "lifetime", span, text: "a" };
    expect(tokenToString(token)).toBe("lifetime(a)");
  });

  it("formats error tokens", (): void => {
    const token: Token = { kind: "error", span, text: "@" };
    expect(tokenToString(token)).toBe("error(@)");
  });

  it("formats eof as 'end of input'", (): void => {
    const token: Token = { kind: "eof", span };
    expect(tokenToString(token)).toBe("end of input");
  });

  it("formats symbol tokens by kind name", (): void => {
    const token: Token = { kind: "lparen", span };
    expect(tokenToString(token)).toBe("lparen");
  });

  it("escapes backslashes in text", (): void => {
    const token: Token = { kind: "ident", span, text: "a\\b" };
    expect(tokenToString(token)).toBe("ident(a\\\\b)");
  });

  it("escapes newlines in text", (): void => {
    const token: Token = { kind: "error", span, text: "a\nb" };
    expect(tokenToString(token)).toBe("error(a\\nb)");
  });

  it("escapes carriage returns in text", (): void => {
    const token: Token = { kind: "error", span, text: "a\rb" };
    expect(tokenToString(token)).toBe("error(a\\rb)");
  });

  it("escapes tabs in text", (): void => {
    const token: Token = { kind: "error", span, text: "a\tb" };
    expect(tokenToString(token)).toBe("error(a\\tb)");
  });

  it("escapes double quotes in text", (): void => {
    const token: Token = { kind: "string", span, text: 'say "hi"' };
    expect(tokenToString(token)).toBe('string(say \\"hi\\")');
  });
});
