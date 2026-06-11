# 0007. Own a small JS-AST and printer for code generation

- Status: Accepted
- Date: 2026-06-12

## Context

Code generation must emit readable, idiomatic JavaScript with source maps from the
first emit (spec `0022`), and must port to Hedge for self-hosting.

## Decision

Define a small typed JS-AST (discriminated-union nodes, an ESTree-ish subset) and
print it with a printer that tracks each node's originating Hedge span. The
pipeline is MIR → JS-AST → text.

## Alternatives considered

- **String-builder + source-map library**: fastest start, but hand-tracked
  offsets are error-prone and structured lowerings get messy.
- **Existing codegen lib (`@babel/generator`, `astring`, TS printer)**: mature
  with source maps, but couples to their AST/output style and is a heavy
  dependency to reimplement in Hedge.

## Consequences

- Source maps fall out of the printer by construction.
- Clean handling of non-trivial lowerings (block-expr → IIFE, `match` → `switch`,
  drop insertion, `{v}` cells).
- Ports to Hedge with no external codegen dependency.
