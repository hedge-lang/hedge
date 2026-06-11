# Hedge Language Specification (Draft v0.1)

## Overview

Hedge is a statically-typed language that compiles to JavaScript and emits
TypeScript declarations alongside it. It provides an ownership and borrowing
model with deterministic cleanup, and enforces it entirely at compile time, so
the discipline adds no runtime machinery of its own. Ownership is resolved
statically wherever it can be; a runtime cost remains only where behavior is
genuinely dynamic, such as a drop flag for a conditional partial move or a
validation guard at the JavaScript boundary.

JavaScript is a foreign environment, and safe Hedge code is insulated from
arbitrary JavaScript objects and behavior. The boundary between the two is
explicit, and the compiled output is ordinary JavaScript and TypeScript, meant
to be consumed as such.

## Who Hedge is for

People who want ownership, borrowing, lifetimes, and deterministic cleanup, but
want their code to run as plain JavaScript and TypeScript — no WASM, no extra
runtime.

## What shapes the design

Hedge is inspired by Rust, but it isn't a port. The model bends where the
underlying JavaScript runtime makes a different choice cheaper or safer: no
allocator to manage, since the runtime reclaims memory; a guarded boundary to
untrusted JS; and no WASM layer to design around. Borrowing lives in a function's signature, never in
its body, so a type's rules can be read without reading its code.

# Design Principles

1. [Compilation](0001-compilation.md)
2. [Execution Model](0002-execution-model.md)
3. [JavaScript Interactions](0003-javascript-interactions.md)
4. [Mutability](0004-mutability.md)
5. [Borrows](0005-borrows.md)
6. [Lifetimes](0006-lifetimes.md)
7. [Drop & RAII](0007-drop-and-raii.md)
8. [Expressions & Control Flow](0008-expressions-and-control-flow.md)
9. [Functions & Closures](0009-functions-and-closures.md)
10. [Primitive Types](0010-primitive-types.md)
11. [Strings](0011-strings.md)
12. [Collections](0012-collections.md)
13. [Structs](0013-structs.md)
14. [Enums](0014-enums.md)
15. [Generics & Traits](0015-generics-and-traits.md)
16. [Pattern matching](0016-pattern-matching.md)
17. [Iterators](0017-iterators.md)
18. [Modules](0018-modules.md)
19. [Async functions](0019-async.md)
20. [Result & Option](0020-error-handling.md)
21. [JavaScript export generation](0021-javascript-export-generation.md)
22. [TypeScript declaration generation](0022-typescript-declaration-generation.md)
23. [Safe/unsafe JavaScript boundaries](0023-safe-unsafe-boundaries.md)

Deferred/Considered:

* Macros
* Compile-time code generation
* Generic associated types (GATs)
* Trait specialization (overlapping impls)
* Const generics
* Interior mutability
* Async mutex / RW-lock (for shared state, with interior mutability)
* Shared-memory numeric buffers (SharedArrayBuffer) with atomics
* User-defined unsafe blocks
* Custom allocators
* Pinning

## Beyond the Language

* [Toolchain & Packaging](0024-toolchain-and-packaging.md)

## Appendix

* [Grammar](0025-grammar.md)
