import { performance } from "node:perf_hooks";

import { compile } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";
import { CONFORMANCE_FIXTURE_MANIFEST } from "./fixtures/manifest.js";

function runBatch(iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    for (const source of CONFORMANCE_FIXTURE_MANIFEST.performance.corpus) {
      compile(source);
    }
  }
  return performance.now() - start;
}

describe("performance guardrails", (): void => {
  it("single corpus pass remains under a coarse budget", (): void => {
    const elapsedMs = runBatch(1);
    expect(elapsedMs).toBeLessThan(
      CONFORMANCE_FIXTURE_MANIFEST.performance.singlePassBudgetMs,
    );
  });

  it("repeated corpus compilation stays within regression guardrail budget", (): void => {
    const elapsedMs = runBatch(
      CONFORMANCE_FIXTURE_MANIFEST.performance.repeatedIterations,
    );
    expect(elapsedMs).toBeLessThan(
      CONFORMANCE_FIXTURE_MANIFEST.performance.repeatedPassBudgetMs,
    );
  });
});
