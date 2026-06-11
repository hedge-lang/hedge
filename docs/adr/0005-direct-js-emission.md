# 0005. Emit JavaScript directly, no TypeScript-compiler hand-off

- Status: Accepted
- Date: 2026-06-12

## Context

An early framing had code generation emit TypeScript and delegate to `tsc` for the
final JavaScript and `.d.ts`. But the compiler already type-checks and erases its
own types, and the `.d.ts` surface is a deliberate semantic mapping from Hedge's
type model.

## Decision

Code generation emits JavaScript directly and emits `.d.ts` from Hedge's own type
model. There is no TypeScript compiler in the pipeline. Downleveling for older
runtimes is an optional post-pass (esbuild/SWC/Babel).

## Alternatives considered

- **Hedge → TypeScript → `tsc` → JS + .d.ts**: rejected: `tsc`'s value is its
  checker (already done); it would produce the wrong `.d.ts` (implementation
  types, not Hedge's semantic surface); it degrades source maps across two hops;
  and it couples the language to an external tool's evolving emit.

## Consequences

- A single authoritative source map (Hedge → JS).
- Full control over output idiom and the `.d.ts` surface.
- Updated spec `0001` to remove the `tsc` hand-off.
