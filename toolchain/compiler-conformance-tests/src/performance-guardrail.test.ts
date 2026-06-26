import { performance } from "node:perf_hooks";

import { compile } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

const PERFORMANCE_CORPUS: readonly string[] = [
  `fn main() { print("hello"); }`,
  `fn main() { let x = 1 + 2 * 3; print(x); }`,
  `fn main() { if true { print("a"); } else { print("b"); } }`,
  `pub fn add(x: i32, y: i32) -> i32 { x + y }`,
  `fn main() { let x = { let a = 1; let b = 2; a + b }; print(x); }`,
];

function runBatch(iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    for (const source of PERFORMANCE_CORPUS) {
      compile(source);
    }
  }
  return performance.now() - start;
}

describe("performance guardrails", (): void => {
  it("single corpus pass remains under a coarse budget", (): void => {
    const elapsedMs = runBatch(1);
    expect(elapsedMs).toBeLessThan(3000);
  });

  it("repeated corpus compilation stays within regression guardrail budget", (): void => {
    const elapsedMs = runBatch(20);
    expect(elapsedMs).toBeLessThan(15000);
  });
});
