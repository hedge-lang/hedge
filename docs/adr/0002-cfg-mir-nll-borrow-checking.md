# 0002. Lower to a CFG/MIR IR with NLL borrow checking

- Status: Accepted
- Date: 2026-06-12

## Context

The specification commits to non-lexical, last-use borrows ("a borrow lasts until
its last use"). The compiler needs an analysis substrate for borrow checking,
drop-point computation, and optimization.

## Decision

Lower the typed AST to a control-flow-graph IR (a MIR analog) and perform borrow
checking as dataflow with last-use (NLL) regions over it.

## Alternatives considered

- **Lexical-scope borrows on the AST, migrate to NLL later**: Rust's historical
  path. Ships faster but over-rejects spec-valid programs and means implementing
  borrow checking twice.
- **Polonius / location-based (datalog)**: most precise, but research-grade and
  overkill for a first compiler.

## Consequences

- Matches the spec's last-use semantics with no borrow-checker rewrite.
- The same CFG carries conditional drop-flag analysis (spec 0007) and the
  optimization pass (spec 0001), so it is owed work rather than extra.
- Slice 1 builds move/init checking already aimed at this IR (even if its CFG is
  trivial), so borrows in slice 2 slot onto an existing substrate.
