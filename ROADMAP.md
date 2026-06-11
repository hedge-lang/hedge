# Hedge Implementation Roadmap

This is the build plan for the Hedge compiler. The language is specified under
[`specification/`](specification/0000-index.md); this document is about *building
the compiler*, sequenced as vertical tracer-bullet slices.

## Locked architecture decisions

| Area              | Decision                                                                                                                                                                        |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Compiler language | **TypeScript** (self-hosting is the long-term goal; the production compiler is JS/Node regardless, so TS shares its ecosystem and ports cleanly via discriminated-union → enum) |
| Pipeline          | lex → parse → resolve → typecheck → **MIR/CFG** → JS-AST → printed JS + source maps                                                                                             |
| Parser            | **hand-written recursive descent + Pratt** over the grammar appendix                                                                                                            |
| Borrow checking   | **NLL on a CFG/MIR**; the same IR carries drop-point analysis and optimization                                                                                                  |
| Drop              | **deterministic**, via `Symbol.dispose`: `using` for the common case, explicit `[Symbol.dispose]()` calls at computed drop points (drop flags, early drop, last-use)            |
| Codegen           | **own a small JS-AST + printer**; source maps by construction; ports to Hedge                                                                                                   |
| Std / prelude     | **thin trusted JS floor + std-in-Hedge ASAP** (the feasible path to a pure-Hedge end state)                                                                                     |
| Tests             | **golden JS snapshots + execution tests + must-fail corpus**; doubles as the self-hosting validation harness                                                                    |

## Cross-cutting, from commit one
- **Test harness**: every slice adds golden (emitted JS), execution (run in Node, assert result), and must-fail (rejected programs + expected diagnostics) cases.
- **Source maps**: tracked in the printer from the first emit, not bolted on.
- **Diagnostics infrastructure**: spans + structured errors with recovery (spec `0001` error-reporting stage), built early so every later stage reports well.
- **The must-fail corpus grows with each ownership rule** — it is the borrow checker's proof.

## Slices

Each slice is end-to-end (parses → checks → emits runnable JS) and ships with its
test cases. Order follows dependency, not spec chapter order.

### Slice 1 — Tracer bullet
`fn`, `i32`/`bool`, `let` + move semantics, `struct`, calls, arithmetic, `if`,
blocks → runnable JS + source maps, under the full test harness. Trivial CFG with
move/init checking and scope-end drop. **No borrows, generics, traits, or enums.**
Goal: prove the whole pipeline cheaply and lock the architecture.
Spec: `0008`, `0009`, `0010`, `0011-structs`-equivalent (structs only).

### Slice 2 — Borrows, references, lifetimes
`&` / `&write`, the **NLL borrow checker** on the CFG, lifetime elision and
explicit lifetimes, drop flags for conditional moves, `*` deref, `{v}` cells for
`&write` primitives. The riskiest stage, now against a working pipeline.
Spec: `0002`, `0004`, `0005`, `0006`, `0007`.

### Slice 3 — Enums & pattern matching
Monomorphic enums, `match` with exhaustiveness/refutability, or-patterns, ranges,
`@`, slice patterns, binding modes. Enables `Option`/`Result` shape.
Spec: `0014-enums`, `0016-pattern-matching`.

### Slice 4 — Generics & traits
Erased generics with **witness passing**, `dyn Trait` value layout, trait
resolution, coherence/orphan rule, `where` clauses, `#[derive]`, associated
types, selective monomorphization. **Design the witness/dyn/closure ABI here.**
Generic enums (`Option<T>`) follow once this lands.
Spec: `0013-generics-and-traits` (renumbered `0015`).

### Slice 5 — Collections, strings, the intrinsic floor
The trusted `extern "js"` intrinsic layer (array/string/Map/Math). `Vec`, slices,
fixed arrays; `str` + `${}` interpolation (`Display`). **std-in-Hedge begins** —
`Option`, `Result`, `Iterator` adapters written in Hedge.
Spec: `0011-strings`, `0012-collections`, `0015-iterators` (renumbered `0017`).

### Slice 6 — Error handling & control flow
`Result`/`Option`, `?`, `From` conversion, `panic`/`catch_unwind`, `loop`/`while`/
`for`, loop labels + `break 'l value`, the never type.
Spec: `0018-error-handling` (renumbered `0020`), `0008`.

### Slice 7 — Modules & name resolution
File-as-module tree, `use` + `as` renaming, raw identifiers (`r#`), `pub` /
`pub(package)` visibility, `pub use`. **Write the name-resolution algorithm here.**
Spec: `0016-modules` (renumbered `0018`).

### Slice 8 — Async
`async fn` / `await` → `Promise`, borrows held across `await`, detached tasks
(owned captures only), async `Drop` (`await using` / `Symbol.asyncDispose`).
Spec: `0017-async` (renumbered `0019`).

### Slice 9 — JS interop & declaration generation
`export "js"` / `extern "js"`, runtime guards (primitive-only), `unchecked`,
`unsafe`, the JS-reserved-word/`as` boundary rules, `.d.ts` generation from
Hedge's type model.
Spec: `0003`, `0019`–`0021` (renumbered `0021`–`0023`).

### Slice 10 — Toolchain
`hedge` CLI (build/test/run/add/publish over npm), the test runner, npm package
format + Hedge metadata artifact, optional downleveling post-pass.
Spec: `0022-toolchain` (renumbered `0024`).

### Milestone — Self-hosting
Once the language is capable (≈ through slice 7), port the compiler from
TypeScript to Hedge. Validate by running the **same golden/execution/must-fail
corpus** through both the TS bootstrap and the self-hosted compiler and asserting
identical output. Keep the TS bootstrap as the reference until the Hedge compiler
is proven, then retire it.

## Design notes to write as you reach them
These are deliberately deferred until the slice that needs them, to avoid
specifying ahead of implementation:
- **Witness / `dyn Trait` / closure runtime ABI** (slice 4).
- **Name resolution algorithm** — shadowing, glob conflicts, prelude injection (slice 7).
- **Coercions list** — deref coercion, closure → `fn`, lifetime subtyping.
- **Operator → trait mapping table.**
- **Formal typing / inference rules**, and the precise meaning of `unsafe` / `unchecked`.

## First action
Validate the grammar appendix (`specification/0025-grammar.md`) with a throwaway
tree-sitter pass to flush ambiguities, then start Slice 1: lexer → Pratt parser →
resolver → typechecker → trivial CFG → JS-AST → printer, TDD'd against the harness.
