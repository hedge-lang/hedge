# 0013. `#[derive]` is deferred to the macro system; standard traits carry no special compiler status

- Status: Accepted
- Date: 2026-09-03

## Context

`#[derive(...)]` bundles two mechanisms: generating implementations of a fixed,
well-known set of traits from a type's fields, and, in the general case, running
compile-time code to generate arbitrary implementations. Hedge defers macros and
compile-time code generation entirely
([specification/0000-index.md](../../specification/0000-index.md),
Deferred/Considered; `macro` is reserved but unused per
[ADR 0008](0008-keyword-evolution-policy.md)).

`ROADMAP.md` nonetheless listed `#[derive]` among the Slice 4 deliverables, and
[specification/0015-generics-and-traits.md](../../specification/0015-generics-and-traits.md)
describes it for `Clone`, `Eq`, `Copy`, `Default`, and others. The question was
whether to build `#[derive]` now as a compiler builtin over a hardcoded trait
set, or defer it.

Building it now would mean the compiler has two independent ways to produce an
implementation for a given `(trait, type)` pair — a hand-written `impl` and a
compiler-synthesized one — that it must then reconcile in coherence checking. It
also singles out a fixed set of traits for compiler-magic treatment that a later
macro system would have to absorb or run parallel to. And the payoff, less
boilerplate, is not realized until the trait system executes `impl` method bodies
(a separate, not-yet-done piece of work), so deferring costs no working
functionality.

## Decision

`#[derive]` is not built as a compiler builtin. It is deferred until the macro
system exists, and will be defined in terms of it: `#[derive(Clone)]` will invoke
a macro that emits an ordinary `impl Clone for T { ... }` block, which is then
checked for coherence exactly like a hand-written `impl`. There is no
derive-specific reconciliation path — the compiler has one way to state a trait
implementation (parsed `impl` syntax) and one coherence check over it.

`Clone`, `PartialEq`, `Eq`, `Default` (and later `PartialOrd`, `Ord`, `Hash`,
`Debug`) are ordinary traits with no special compiler status. Until the macro
system lands, an implementation is written explicitly, like any other trait
`impl`.

`Copy` is not a trait and its opt-in mechanism is a separate question, out of
scope here.

## Alternatives considered

- **Build `#[derive]` now as a closed compiler builtin over a hardcoded trait
  set.** Rejected: it creates a second path that produces a trait implementation,
  which coherence checking must reconcile against hand-written `impl`s; it bakes a
  compiler-magic special case for a fixed trait set that a later macro system
  would have to absorb; and its boilerplate-reduction payoff is unrealized until
  `impl` bodies are analyzed anyway, so nothing is lost by waiting.

- **Defer `#[derive]` but provide the standard-trait implementations as
  compiler-supplied magic `impl`s.** Rejected: the same special-set problem
  without even the `derive` syntax; those `impl`s would need bespoke handling in
  resolution, coherence, and codegen.

- **Keep `#[derive]` on the Slice 4 critical path.** Rejected: only one issue
  depends on it, and that issue is blocked several layers deep independently, so
  `#[derive]`'s absence does not move any schedule.

## Consequences

- Until the macro system lands, every type needing `Clone` / `PartialEq` / `Eq` /
  `Default` carries an explicit `impl`. The standard library's `Option` and
  `Result` carry these by hand; user types likewise. This is more boilerplate,
  accepted deliberately as the cost of not special-casing a trait set.
- The compiler has exactly one construct that introduces a trait implementation
  and one coherence check over it. When `#[derive]` arrives as a macro, its output
  is ordinary `impl` syntax and inherits that checking for free — the
  duplicate-detection the builtin approach would have needed bespoke code for.
- `#[derive]` is removed from the Slice 4 deliverables in `ROADMAP.md` and folded
  into the deferred macro work.
- [specification/0015-generics-and-traits.md](../../specification/0015-generics-and-traits.md)
  §Derive is updated to describe `derive` as macro-provided sugar over ordinary
  `impl`s, unavailable until the macro system lands.
- The recurring "is `#[derive]` a macro" question is settled: yes — it will be one,
  and the traits it targets have no special status before then.
