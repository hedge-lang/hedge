# 0003. Deterministic Drop via the Symbol.dispose protocol

- Status: Accepted
- Date: 2026-06-12

## Context

Drop must run deterministically at computed points (last use, reverse
declaration order, drop flags for conditional moves, on every exit path),
matching the spec rather than as garbage-collected finalization.

## Decision

Lower Drop to the `Symbol.dispose` protocol. Use `using` for the common
block-scoped case, and emit explicit `[Symbol.dispose]()` calls at the precise
drop points the CFG computes (drop flags, early drop, last-use before block end).
Async Drop uses `Symbol.asyncDispose` / `await using` analogously.

## Alternatives considered

- **GC finalization (`FinalizationRegistry`) for cleanup**: non-deterministic;
  rejected. `FinalizationRegistry` is used only for debug leak warnings at the JS
  boundary.
- **Rely on `using` alone**: block-scoped, so it cannot express drop flags,
  early drop, or last-use points; insufficient for the spec's precision.

## Consequences

- Determinism and precision are preserved while using the standard protocol;
  `using` is sugar for the common case, explicit disposer calls cover the rest.
- The `SuppressedError`-on-throw-during-unwind behavior, a freebie from `using`,
  is owned explicitly by generated `finally` blocks where disposer calls are
  emitted manually.
- Depends on a recent runtime feature; downleveling is an optional post-pass.
