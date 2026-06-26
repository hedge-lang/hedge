import { compile, parse, tokenize } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_{}()[];:,+-*/<>=!&|\"'` \n\t/";

function fuzzSource(seed: number, length: number): string {
  const rng = mulberry32(seed);
  const chars: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(rng() * CHARSET.length);
    chars.push(CHARSET[index] ?? "x");
  }
  return chars.join("");
}

function severitySignature(source: string): string {
  const result = compile(source);
  return result.diagnostics.map((d) => d.severity).join(",");
}

describe("parser/lexer fuzz stability", (): void => {
  it("seeded fuzz inputs do not throw in tokenize/parse/compile pipeline", (): void => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const source = fuzzSource(seed, 120);
      expect(() => {
        const { tokens } = tokenize(source);
        parse(tokens);
        compile(source);
      }).not.toThrow();
    }
  });

  it("diagnostic severity signature is deterministic for fixed seeded inputs", (): void => {
    for (const seed of [3, 7, 11, 19, 29, 47, 71]) {
      const source = fuzzSource(seed, 180);
      const a = severitySignature(source);
      const b = severitySignature(source);
      expect(a).toBe(b);
    }
  });
});
