# Toolchain & Packaging

This is the ecosystem direction rather than a language feature, but it shapes the
compiler's architecture, so it is recorded here.

## Packages are npm packages

Hedge lives inside npm rather than building a separate registry. A Hedge package
is an npm package, resolved and versioned by npm's own tooling and lockfile. This
keeps Hedge native to the ecosystem it targets: one registry, one publish, both
audiences.

A published package contains three artifacts:

- **Compiled JavaScript:** the runtime, for everyone.
- **`.d.ts`:** for JavaScript and TypeScript consumers.
- **Hedge metadata:** ownership, lifetime, and borrow signatures plus generic
  bodies, for Hedge consumers.

The third artifact is essential: a `.d.ts` is erased, so a Hedge package that
depended on another through only its `.d.ts` would lose all ownership and borrow
information at the package boundary. The Hedge metadata preserves it, the way a
compiled library ships analysis metadata alongside its object code. Dependencies
are consumed pre-compiled: the metadata is read for cross-package borrow checking
and monomorphization, and dependencies are not recompiled from scratch.

## Manifest

A package is configured by its `package.json`, with Hedge-specific settings under
a `hedge` field. There is no separate generated manifest to drift out of sync,
and Hedge dependencies and plain JavaScript dependencies share one npm dependency
list. The `hedge` CLI tells them apart by inspecting each resolved package for the
Hedge-metadata artifact: packages that carry it are analyzed in full; packages
that do not are reached through `extern "js"` bindings.

## Metadata format

The metadata artifact is the bundled Hedge source for now, the simplest complete
option, and an opaque, replaceable detail that does not affect the language. A
compiled interface format (public signatures plus the `pub` generic bodies needed
for specialization, private bodies omitted) is the later optimization, for
encapsulation and package size. Full closed-source encapsulation is inherently
limited: cross-package monomorphization requires shipping generic bodies, so a
compiled format hides only non-generic code.

## CLI

A `hedge` CLI wraps the lifecycle (build, test, run, add, publish) over npm
underneath, giving a Cargo-like experience without a separate registry.

## Consuming JavaScript packages

Existing npm and JavaScript packages are reached through `extern "js"` bindings
(see [JavaScript Interactions](0003-javascript-interactions.md)). A
`.d.ts`-to-`extern` generator is the intended path for binding the typed
ecosystem with low ceremony.

## Debugging, testing, and runtime target

- **Source maps** are emitted alongside the compiled JavaScript, so stack traces
  and debuggers map back to Hedge source rather than generated code; this is part
  of code generation from the start, not an afterthought.
- **Testing** is built into the toolchain: a `#[test]` attribute marks test functions
  and `hedge test` runs them, rather than relying on a separate JavaScript runner.
- **Runtime target.** The generated code uses recent JavaScript features:
  `using`/`Symbol.dispose` (Drop), typed arrays, `BigInt`, `WeakMap`, and
  `FinalizationRegistry`. The minimum target is configurable,
  with downleveling or polyfills for older environments; the `using`/`Symbol.dispose`
  dependency for Drop is the sharpest such edge.
