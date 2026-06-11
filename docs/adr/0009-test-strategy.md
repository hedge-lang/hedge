# 0009. Golden + execution + must-fail test corpus

- Status: Accepted
- Date: 2026-06-12

## Context

The spec has no worked examples with expected output, and the language's value is
in *rejecting* bad programs. The test harness is also the means of validating
self-hosting.

## Decision

For each input, snapshot the emitted JavaScript (golden), run it in Node and
assert the runtime result (execution), and maintain a corpus of programs that must
be rejected with expected diagnostics (must-fail). Build this from commit one and
develop test-first.

## Alternatives considered

- **Per-stage unit tests only**: good for pinpointing, but misses integration and
  never verifies the emitted JS runs correctly.
- **Execution tests only**: skips rejection cases and lets wrong-JS-that-outputs-
  right slip through.

## Consequences

- The must-fail corpus is the borrow checker's proof.
- The same corpus validates self-hosting: run it through both the TS bootstrap and
  the self-hosted compiler and assert identical output.
