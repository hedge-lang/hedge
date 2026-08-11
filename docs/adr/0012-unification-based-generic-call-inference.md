# 0012. Unification-based inference for generic call and construction sites

- Status: Accepted
- Date: 2026-08-10

## Context

Call sites check concrete-vs-concrete only: `analyzer.ts`'s
`checkPositionalCallArgs` (shared by calls and struct/enum-variant
construction) runs each argument through `typesEqual`, with no type
variable, substitution, or solving. Generic parameters parse, but
`analyzer.ts` never reads `genericParams`: a name matching a declared
generic parameter is not yet recognized as a valid type anywhere a
signature is checked, so a bare generic-named parameter (`x: T`), one
reference hop to it (`&T`), and a declared generic in a compound type
position (`Vec<T>`, `&[T]`) are all rejected today. This design assumes a
bare generic-named parameter and a single reference hop to one resolve as
ordinary types by the time it is implemented — a separate, already-scoped
prerequisite — and covers unification once both a call's argument and its
callee's declared parameter type are resolvable. Compound generic
positions stay out of scope regardless. No prior art in this repo.

## Decision

**Representation**: type variables stay internal to a new
`toolchain/compiler/src/semantics/infer.ts` (`InferType = Semantics.Type |
TypeVariable`, `Substitution = Map<number, Semantics.Type>`) rather than
joining the exported `Semantics.Type` union, so downstream exhaustive
switches (`typesEqual`, `describeType`, `jsim.ts`, `TYPE_CAPABILITIES`)
need no case for it. One variable per generic-parameter name per call
site, shared across all its occurrences.

**Collection**: `collectCallConstraints`, called from
`checkPositionalCallArgs` when `genericParams` is non-empty, handles only
the parameter shapes described above. Turbofish arguments (arity must
match exactly, no `_` placeholder exists) seed the substitution first;
each argument's constraint is then unified in.

**Solving**: Robinson `unify`, online rather than batch-collect-then-solve
— each constraint unifies into a single running `Substitution`
left-to-right, so a later disagreement (argument or turbofish) is
reported as the conflict, matching rustc's blame convention. Includes an
occurs-check (see Consequences). `resolveInferredType` substitutes any
remaining variable back to a concrete type once solving completes.

**Diagnostics**: an unsolved variable reuses the existing "type cannot be
inferred" diagnostic (same class as an unannotated empty array literal
today); a conflicting binding is a different class and gets a new
diagnostic code, with `relatedSpans` pointing at the original binding
site.

## Alternatives considered

- **`TypeVariable` as a `Semantics.Type` variant** — rejected:
  pollutes every downstream switch with a case that can never reach
  codegen.
- **Batch collect-then-solve** — rejected: buys nothing for a
  single-call-site problem and muddies blame attribution.
- **A `_` turbofish placeholder now** — rejected: no grammar support
  exists yet.
- **Solving nested generic positions (`Vec<T>`) now** — rejected: still
  blocked on the existing type-position generics guardrail.

## Consequences

- This design takes for granted that a bare generic-named parameter and a
  single reference hop to one resolve as ordinary types before its own
  implementation begins. If that prerequisite lands with a different
  scope boundary (for example, if it also covers a compound generic
  position), this ADR's own scope boundary needs revisiting alongside it.
- `TypeVariable` never leaks past `infer.ts` — not compiler-enforced, so
  flag it in review when the implementation lands.
- No spec changes; this is implementation-only.
- The occurs-check is dead code until type-position generics land; a
  future change touching that should revisit this ADR rather than drift
  from it.
- Struct/enum-variant construction shares this pass with calls, so a
  future change to one needs to consider the other.
