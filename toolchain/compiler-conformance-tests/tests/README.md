# Fixture-based test harness

The three-category test harness contains golden JS snapshots, execution
tests, and a must-fail corpus. This is also the long-term self-hosting
validation mechanism: both the TypeScript bootstrap and, eventually, a
self-hosted Hedge compiler must run the same `.hedge` fixtures here and
produce identical output.

Fixtures are auto-discovered by `toolchain/compiler-conformance-tests/src/fixture-harness.ts`
and driven by `golden-fixtures.test.ts`, `execution-fixtures.test.ts`, and
`must-fail-fixtures.test.ts`. Dropping a new `.hedge` file into a category
directory below is enough to add a fixture; a missing sibling expected-file
is a hard test failure, not a skip, and each category asserts at least 3
fixtures exist.

## Category contract

### `golden/`

The `<name>.hedge` fixture is compiled and the emitted JavaScript is compared
to the corresponding `<name>.expected.js` file. This provides the scaffolding
to demonstrate that the self-hosted Hedge compiler produces byte-identical
JavaScript text for the same `.hedge` source.

### `execution/`

The `<name>.hedge` fixture is compiled and executed, with the output compared
to the corresponding `<name>.expected.json` file, which must match the format
`{ "exitCode": number, "stdout": string }`. The `.expected.json` files are
hand-authored, and deliberately excluded from snapshot regeneration (see below).

Fixtures should stick to plain `fn main() { ... }` programs without `pub`
items, since `pub` items compile to ESM `export` statements, which this
CommonJS-style temp-file execution can't run.

A future alternate backend satisfies this category by producing the same
real process exit code and stdout when its emitted JavaScript is run the
same way.

### `must-fail/`

The `<name>.hedge` fixture must fail to compile (`code: none()`), producing
diagnostic `severity: message` lines that are compared against the
corresponding `<name>.expected.stderr` file. Fixtures here must be genuine
T1 conformance-surface rejections (name resolution, type errors, struct
validation, borrow conflicts, etc.), never a "not supported until Slice N"
syntax guardrail.

A future alternate backend satisfies this category by also reporting
`code: none()` and rendering matching diagnostic text for the same source.

## Regenerating snapshots

Regenerate golden and must-fail snapshots using Vitest's native update flag:

```sh
npx vitest run -u        # from toolchain/compiler-conformance-tests/
```

Always read a newly-generated or newly-updated `.expected.*` file in review
rather than trusting the diff alone, since a first-run snapshot always passes,
even if the fixture or the compiler has a bug.

## Wiring self-hosting parity in later slices

`src/dual-compiler-parity.test.ts` already implements "run the same corpus
through two backends, diff the output," gated behind the
`HEDGE_SELF_HOSTED_COMPILER_CMD` environment variable, but today only over
an inline `corpus: string[]`. Once self-hosting work begins, that harness is
the intended place to also read `.hedge` fixtures from this directory and run
them through both backends.

## A note on line endings

`.gitattributes` normalizes checked-in files to `eol=lf` on commit, so
authoring on Windows/WSL doesn't produce spurious snapshot mismatches once
committed. A snapshot regenerated on a native Windows checkout before its
first commit may briefly contain CRLF in the working tree.
