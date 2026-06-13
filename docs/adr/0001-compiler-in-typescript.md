# 0001. Implement the compiler in TypeScript

- Status: Accepted
- Date: 2026-06-12

## Context

Hedge must eventually be self-hosting (the compiler written in Hedge), and it
targets the JavaScript/TypeScript ecosystem. It is a solo effort aimed at a
production-quality tool. The implementation language was contested (TypeScript vs.
Rust).

## Decision

Write the compiler in TypeScript.

## Alternatives considered

- **Rust**: well-suited to compiler construction (sum types, performance,
  `chalk`/`oxc`/`swc`). Rejected as the bootstrap language because self-hosting
  makes the _production_ compiler JS/Node regardless, so Rust never reaches
  production and would mean implementing the hard parts (borrow checker, trait
  solver) twice, once in Rust and once in Hedge.
- **OCaml/Haskell**: excellent for compilers, but an ecosystem mismatch with a
  JS-targeting, npm-native toolchain.

## Consequences

- The bootstrap compiler shares its ecosystem and runtime (Node, JS) with the
  runtime library it emits and the eventual self-hosted compiler.
- The self-hosting port is unusually clean: Hedge enums compile to TypeScript
  discriminated unions, so a discriminated-union-based compiler maps ~1:1.
- `tsc` is the existence proof that a checker of this complexity is maintainable
  in TypeScript.
- Cost: weaker compiler-construction ergonomics than Rust, mitigated by the
  [coding standard](../coding-standard.md) and regained at self-host.
- Reversible only by dropping the self-hosting requirement.
