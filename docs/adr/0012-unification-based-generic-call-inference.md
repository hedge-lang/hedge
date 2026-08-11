# 0012. Unification-based inference for generic call and construction sites

- Status: Accepted
- Date: 2026-08-10

## Context

Call sites check argument types against declared parameter types by
structural equality, with no type variable, substitution, or solving. Ordinary
calls and positional (tuple-shaped) construction share one check; a separate
check handles named-field construction, matching by field name instead of
position, but just as concretely. Generic parameters parse, but signature
checking never recognizes them as valid types, so it rejects a bare
generic-named parameter (`x: T`), a single reference hop to one (`&T`), and a
compound generic type position (`Vec<T>`, `&[T]`) outright.

This design assumes two prerequisites:

1. The bare and single-hop shapes resolve as ordinary types; and
2. A callee's declared generic-parameter names stay visible at its call sites
   (compound positions stay out of scope regardless).

It covers unification both ways: a call's arguments against the callee's
parameter types, and, where the call itself sits in a position with an
already-known expected type (a `let` binding's annotation, or the enclosing
function's return type), that expected type against the callee's return type.
Both directions cover only the same shapes.

## Decision

**Representation**: a type variable is an internal bookkeeping device for
this pass that never joins Hedge's type system, so nothing downstream of
inference needs a case for one. This pass creates one variable per
generic-parameter name per call site, shared across every occurrence of
that name.

**Collection**: constraint collection runs for a callee with declared
generic parameters and covers only the parameter shapes described above.
An explicit turbofish type-argument list, when present, must match the
callee's generic-parameter count exactly and seeds its bindings first. An
expected type already known from the call's position — a `let` binding's
annotation, or the enclosing function's return type — seeds next,
unifying against the callee's return type. Each argument's constraint
then unifies in, left to right; for named-field construction, each
field's constraint unifies the same way, matching by field name instead
of position.

**Solving**: this pass runs classical Robinson-style unification online
rather than batch-collect-then-solve — each constraint folds into a
single running set of bindings in the seeding order above, so it reports
a later disagreement (from turbofish, from an expected return type, or
from an argument) as the conflict, matching rustc's blame convention. It
includes an occurs-check (see Consequences). Once solving completes, any
variable still standing in for a parameter's or return type resolves to
its bound concrete type.

**Diagnostics**: an unsolved variable reuses the existing "type cannot be
inferred" diagnostic, the same class an unannotated empty array literal
already triggers; a conflicting binding gets a new, distinct diagnostic
code instead, with a secondary note pointing back at the original
binding site.

## Alternatives considered

- **Making a type variable a member of the language's type system** pollutes
  every downstream switch over that type with a case that can never
  legitimately reach codegen.
- **Batch collect-then-solve** buys nothing for a single-call-site problem and
  muddies blame attribution.
- **A `_` turbofish placeholder** currently lacks grammar support.
- **Solving nested generic positions (`Vec<T>`) now**: the existing
  type-position generics guardrail still blocks it.

## Consequences

- If either prerequisite above lands with a different scope boundary (e.g., if
  type resolution also covers a compound generic position), this ADR's scope
  boundary needs revisiting alongside it.
- The internal type-variable representation must never leak outside this
  inference pass (e.g., into a diagnostic or codegen) but nothing about this
  design forces that structurally, so it's worth flagging when the
  implementation lands.
- The occurs-check cannot fire under this design's scope; every binding
  comes from an already-concrete type, so nothing self-referential can
  arise. Firing it once nested positions land needs a representation
  that can nest a variable, which this ADR does not provide; a future
  change should not assume otherwise.
- Both positional and named-field struct/enum-variant construction share
  this pass with ordinary calls, so a future change to any one path
  needs to consider the others.
