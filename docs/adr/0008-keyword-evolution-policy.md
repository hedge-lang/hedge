# 0008. Keyword evolution via raw identifiers and versioned additions

- Status: Accepted
- Date: 2026-06-12

## Context

A language needs to add keywords over time without breaking existing code, and to
let users use a keyword as an identifier when needed. Rust achieves this with
editions + raw identifiers + contextual keywords.

## Decision

Keep a small, stable keyword set. Provide raw identifiers (`r#name`) as the escape
hatch. Introduce new keywords only at major language versions; raw identifiers
guarantee such additions cannot permanently break code. Reserve only `as`, `mut`,
`mod`, `box` for diagnostics. Adopt Rust-style editions only if later needed.

## Alternatives considered

- **Full Rust-style editions from the start**: maximum flexibility, but inherits
  edition machinery and keyword-soup complexity.
- **Frozen minimalist (no raw identifiers, no editions)**: simplest, but adding a
  keyword later is a breaking change with no escape hatch.

## Consequences

- Forward-safe without edition machinery.
- `as` doubles as the rename keyword (`use`/`export`) and as the escape for the
  JS-reserved-word export collision.
- Reverses an earlier inclination to skip raw identifiers.
