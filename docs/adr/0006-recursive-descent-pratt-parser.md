# 0006. Hand-written recursive-descent + Pratt parser

- Status: Accepted
- Date: 2026-06-12

## Context

The parser is built in slice 1 over the grammar appendix (spec `0025`) and must
port to Hedge for self-hosting.

## Decision

Write the parser by hand as a recursive-descent parser with Pratt
(precedence-climbing) expression parsing.

## Alternatives considered

- **Parser generator (PEG/ANTLR/tree-sitter)**: grammar-as-source-of-truth and
  fast to stand up, but weaker errors, a heavy dependency, and no generator in
  Hedge (the parser would be rewritten anyway).
- **Parser combinators**: composable, but typically weaker errors and
  performance.

## Consequences

- Best error messages and full control (the production standard: Rust, `tsc`, Go).
- Pratt parsing maps directly onto the precedence table in spec `0025`.
- Ports cleanly to Hedge with no external dependency.
- The grammar appendix is the reference; a throwaway tree-sitter pass is used once
  to flush ambiguities.
