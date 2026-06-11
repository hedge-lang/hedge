# Hedge

Hedge is a statically typed programming language with ownership, borrowing,
lifetimes, and deterministic cleanup. It compiles directly to JavaScript and
emits corresponding TypeScript declarations.

## Status

**Current state:** Not yet ready for production use. Specification work is
ongoing, and parser and compiler implementation are underway.
Track progress in [ROADMAP.md](ROADMAP.md).

You can find additional resources in the following places:

- [`specification/`](specification/0000-index.md): the language
  specification (Draft v0.1).
- [`docs/`](docs/): architecture decision records, design notes,
  and the contributor coding standard.

## What it looks like

```hedge
struct Counter { value: i32 }

impl Counter {
  fn new() -> Self { Counter { value: 0 } }
  fn increment(&write self) { self.value = self.value + 1 }
}

fn main() {
  let write c = Counter::new();
  c.increment();
}
```

## Why Hedge?

JavaScript and TypeScript make it easy to build and ship software, but many
classes of bugs remain difficult to prevent. Accidental mutation, shared state,
resource leaks, invalid object lifetimes, and unclear ownership relationships
are typically enforced through convention, code review, and testing rather than
the type system.

Hedge moves these guarantees into the compiler.

Ownership, borrowing, and deterministic cleanup allow the compiler to verify
how data and resources are used throughout a program before it runs. Many bugs
that would otherwise appear in production become compile-time errors.

Hedge is designed to provide these guarantees without abandoning the JavaScript
ecosystem. Hedge programs compile directly to JavaScript, generate
corresponding TypeScript declarations, and interoperate with existing
JavaScript and TypeScript code through a controlled boundary.

If you value the reach and ecosystem of JavaScript but want stronger guarantees
around ownership, mutation, lifetimes, and resource management, Hedge is
designed for that use case.

## Design Principles

- Data structures define their own ownership rules.
- Ownership and borrowing are enforced entirely at compile time.
- Deterministic cleanup runs at statically determined points.
- A primitive-only boundary isolates untrusted JavaScript.
- Standard JavaScript and corresponding `.d.ts` declarations are
  generated from Hedge's type model.

## License

Dual-licensed under either of

- MIT license ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option. Unless you explicitly state otherwise, any contribution
intentionally submitted for inclusion in this project shall be dual-licensed as
above, without any additional terms or conditions.
