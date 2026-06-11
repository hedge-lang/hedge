# Compiler coding standard

The compiler is written in TypeScript
([ADR 0001](adr/0001-compiler-in-typescript.md)) but must port cleanly to
Hedge for self-hosting (see [`ROADMAP.md`](../ROADMAP.md)). Write "Hedge-shaped
TypeScript": stay within the subset of TypeScript that maps directly onto Hedge.
This is binding from the first commit; retrofitting the discipline is a rewrite.

## Rules

- **Model data as discriminated unions**, tagged with a literal `kind`/`tag`
  field. These map 1:1 onto Hedge enums.
- **Exhaustive matching**: `switch` on the discriminant with a `never` default
  guard. No reliance on fall-through.
- **No TypeScript-only type-level magic** in compiler logic: no
  conditional/mapped/template-literal type gymnastics, nothing without a Hedge
  equivalent.
- **Explicit dispatch** over inheritance or `this`-polymorphism. Prefer free
  functions over data to method hierarchies.
- **Immutable-by-default data**; produce new values rather than mutating, except
  in clearly-scoped, performance-critical passes.
- **Errors are values** where it maps to Hedge's `Result`/diagnostics model;
  reserve `throw` for genuine internal-compiler-error bugs (ICEs).
- **No structural-typing tricks** that Hedge's nominal model cannot express.

## Enforced in tooling

Encode what can be mechanical, so tooling enforces the standard where possible:

- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
  `exactOptionalPropertyTypes`.
- ESLint: switch-exhaustiveness, no `any`, no non-null assertions, and restriction
  of the type-level features listed above.

## Rationale

Every TypeScript-only idiom in the compiler is debt that comes due at self-host.
Constraining the code to a Hedge-shaped subset makes the eventual port a
translation rather than a rewrite.
