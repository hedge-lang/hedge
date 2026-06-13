# Architecture Decision Records

This directory records architecturally-significant decisions: the kind that are
hard to reverse, change the [specification](../../specification/0000-index.md), or
settle a real fork between alternatives. Routine choices do not get an ADR.

## Process

- Copy [`0000-template.md`](0000-template.md), give it the next number, fill it in.
- An ADR is immutable once `Accepted`. To change a decision, write a new ADR that
  supersedes it and mark the old one `Superseded by NNNN`.
- When an ADR changes the spec, also update the affected chapter and the
  [spec changelog](../../specification/CHANGELOG.md).
- ADRs [0001](0001-compiler-in-typescript.md)-[0010](0010-documentation-architecture.md)
  were ratified together on 2026-06-12 during the initial architecture hardening
  pass.

## Index

| #                                                     | Title                                                         | Status   |
| ----------------------------------------------------- | ------------------------------------------------------------- | -------- |
| [0001](0001-compiler-in-typescript.md)                | Implement the compiler in TypeScript                          | Accepted |
| [0002](0002-cfg-mir-nll-borrow-checking.md)           | Lower to a CFG/MIR IR with NLL borrow checking                | Accepted |
| [0003](0003-deterministic-drop-via-symbol-dispose.md) | Deterministic Drop via the Symbol.dispose protocol            | Accepted |
| [0004](0004-thin-js-floor-std-in-hedge.md)            | Thin JS runtime floor; standard library in Hedge              | Accepted |
| [0005](0005-direct-js-emission.md)                    | Emit JavaScript directly, no TypeScript-compiler hand-off     | Accepted |
| [0006](0006-recursive-descent-pratt-parser.md)        | Hand-written recursive-descent + Pratt parser                 | Accepted |
| [0007](0007-own-js-ast-printer.md)                    | Own a small JS-AST and printer for code generation            | Accepted |
| [0008](0008-keyword-evolution-policy.md)              | Keyword evolution via raw identifiers and versioned additions | Accepted |
| [0009](0009-test-strategy.md)                         | Golden + execution + must-fail test corpus                    | Accepted |
| [0010](0010-documentation-architecture.md)            | Documentation architecture and living-spec process            | Accepted |
