# 0011. `mut` replaces `bind`/`write` for mutability declaration

- Status: Accepted
- Date: 2026-06-29

## Context

The earlier mutability model split mutation into two orthogonal capabilities:
`bind` (rebinding the slot) and `write` (mutating contents or taking `&write`
borrows). This produced four `let` forms. The distinction has type-system value
for collection types but the cognitive overhead is high: Rust developers expect
`mut`, the `bind`-without-write case is rare in practice, and the rule that
`x = 2` requires `bind` rather than `write` is counterintuitive. ADR-0008
already reserved `mut` in the keyword set, anticipating this convergence.

## Decision

Replace `let bind`/`let write`/`let bind write` with a single `let mut`. Replace
`&write` with `&mut`. A `mut` binding grants both reassignment and content
mutation. The borrow model (shared/exclusive) and the ownership state machine are
unchanged; only the surface syntax collapses.

## Alternatives considered

- **Keep `bind`/`write` separate**: preserves the `const x: T[]` vs `let x:
readonly T[]` distinction without annotation. Rejected: friction too high,
  real-world benefit of the split cases does not justify the cost.
- **Rename `bind` → `mut`, keep `write`**: partial improvement. Rejected: still
  requires users to learn two modifiers; the split case remains rare.

## Consequences

- `let mut` covers all mutation needs; the language is immediately familiar to
  Rust developers.
- The two primary `.d.ts` forms are preserved: `let x: [T]` → `const x:
readonly T[]`; `let mut x: [T]` → `let x: T[]`. The two intermediate forms
  (`const x: T[]` and `let x: readonly T[]`) are no longer expressible in Hedge
  surface syntax; this trade-off is acceptable given their rarity.
- `specification/0004-mutability.md` required a conceptual rewrite.
- All `let write`/`let bind`/`&write` occurrences in spec, tests, and compiler
  source are mechanical find-replace.
