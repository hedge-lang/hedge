# 0012. Unification-based inference for generic call and construction sites

- Status: Accepted
- Date: 2026-08-10

## Context

Call sites check argument types against declared parameter types by
structural equality, with no type variable, substitution, or solving; the same
check backs both ordinary calls and struct/enum-variant construction. Generic
parameters parse but are never recognized as valid types during signature
checking, so a bare generic-named parameter (`x: T`), a single reference hop to
one (`&T`), and a compound generic type position (`Vec<T>`, `&[T]`) are all
rejected.

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
this pass — it never joins Hedge's type system, so nothing downstream of
inference needs a case for one. One variable is created per
generic-parameter name per call site, shared across every occurrence of
that name.

**Collection**: constraint collection runs for a callee with declared
generic parameters, restricted to the parameter shapes described above.
An explicit turbofish type-argument list, when present, must match the
callee's generic-parameter count exactly and seeds its bindings first. An
expected type already known from the call's position — a `let` binding's
annotation, or the enclosing function's return type — seeds next,
unifying against the callee's return type. Each argument's constraint
then unifies in, left to right.

**Solving**: classical Robinson-style unification, run online rather than
batch-collect-then-solve — each constraint folds into a single running
set of bindings in the seeding order above, so a later disagreement (from
turbofish, from an expected return type, or from an argument) is reported
as the conflict, matching rustc's blame convention. Includes an
occurs-check (see Consequences). Once solving completes, any variable
still standing in for a parameter's or return type resolves back to the
concrete type it was bound to.

**Diagnostics**: an unsolved variable reuses the existing "type cannot be
inferred" diagnostic (the same class already used for an unannotated
empty array literal); a conflicting binding is a distinct class and gets
a new diagnostic code, with a secondary note pointing back at the
original binding site.

## Alternatives considered

- **Making a type variable a member of the language's type system** pollutes
  every downstream switch over that type with a case that can never
  legitimately reach codegen.
- **Batch collect-then-solve** buys nothing for a single-call-site problem and
  muddies blame attribution.
- **A `_` turbofish placeholder** currently lacks grammar support.
- **Solving nested generic positions (`Vec<T>`)** is still blocked on the
  existing type-position generics guardrail.

## Consequences

- If either prerequisite above lands with a different scope boundary (e.g., if
  type resolution also covers a compound generic position), this ADR's scope
  boundary needs revisiting alongside it.
- The internal type-variable representation must never leak outside this
  inference pass (e.g., into a diagnostic or codegen) but nothing about this
  design forces that structurally, so it's worth flagging when the
  implementation lands.
- The occurs-check is dead code until type-position generics land; a future
  change touching that should revisit this ADR rather than drift from it.
- Struct/enum-variant construction shares this pass with calls, so a future
  change to one needs to consider the other.
