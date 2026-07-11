interface FuzzFixtureConfig {
  readonly seeds: readonly number[];
  readonly smokeLength: number;
  readonly signatureLength: number;
  readonly signatureSeeds: readonly number[];
}

interface PerformanceFixtureConfig {
  readonly corpus: readonly string[];
  readonly singlePassBudgetMs: number;
  readonly repeatedPassBudgetMs: number;
  readonly repeatedIterations: number;
}

interface SourceMapActivationFixture {
  readonly id: string;
  readonly source: string;
  readonly expectedGeneratedSnippet: string;
}

interface ConformanceFixtureManifest {
  readonly version: string;
  readonly fuzz: FuzzFixtureConfig;
  readonly performance: PerformanceFixtureConfig;
  readonly sourceMapActivation: readonly SourceMapActivationFixture[];
}

export const CONFORMANCE_FIXTURE_MANIFEST: ConformanceFixtureManifest = {
  version: "2026.07.10.1",
  fuzz: {
    seeds: Array.from({ length: 80 }, (_, i): number => i + 1),
    smokeLength: 120,
    signatureLength: 180,
    signatureSeeds: [3, 7, 11, 19, 29, 47, 71],
  },
  performance: {
    corpus: [
      `fn main() { print("hello"); }`,
      `fn main() { let x = 1 + 2 * 3; print(x); }`,
      `fn main() { if true { print("a"); } else { print("b"); } }`,
      `pub fn add(x: i32, y: i32) -> i32 { x + y }`,
      `fn main() { let x = { let a = 1; let b = 2; a + b }; print(x); }`,
    ],
    singlePassBudgetMs: 3000,
    repeatedPassBudgetMs: 15000,
    repeatedIterations: 20,
  },
  sourceMapActivation: [
    {
      id: "map-main-callsite",
      source: `fn main() { print("x"); }`,
      expectedGeneratedSnippet: `main();`,
    },
    {
      id: "map-branch-expression",
      source: `fn main() { if true { print("yes"); } else { print("no"); } }`,
      expectedGeneratedSnippet: `if (true)`,
    },
    {
      id: "map-let-expression",
      source: `fn main() { let x = 1 + 2; print(x); }`,
      // i32 arithmetic wraps via `|0` (settled semantics) — the initializer
      // is not emitted verbatim as `1 + 2`.
      expectedGeneratedSnippet: `const x = ((1 + 2)|0);`,
    },
    {
      id: "map-function-decl",
      source: `pub fn add(x: i32, y: i32) -> i32 { x + y }`,
      expectedGeneratedSnippet: `function add(x, y)`,
    },
  ],
};
