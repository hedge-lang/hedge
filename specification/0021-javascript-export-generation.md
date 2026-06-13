# JavaScript Export Generation

This describes the runtime JavaScript Hedge emits at the boundary. The type
surface is in
[TypeScript Declaration Generation](0022-typescript-declaration-generation.md),
and the safety rules in
[Safe/Unsafe Boundaries](0023-safe-unsafe-boundaries.md).

## The export surface

`export "js" fn name(…)` emits an exported JavaScript function. Nothing crosses
to JavaScript unless explicitly exported; there is no automatic export of a
module's items or a type's methods.

Names are emitted exactly as written: no mangling, no case conversion. An export
may instead set its JavaScript-facing name with `as`, as in
`export "js" build as createWidget`. This covers the two cases the verbatim rule
cannot: two exports that would otherwise share a name (a compile error), and a
Hedge name that is a JavaScript reserved word (`class`, `default`, `delete`),
which cannot be exported verbatim and must be given a different name with `as`. A
Hedge name that is itself a Hedge keyword is written with the raw-identifier form
`r#name`, whose `r#` is lexical and not part of the emitted name.

## Entry point

A package is a library by default: it exposes its `export "js"` items and nothing
runs on its own. A package that defines `fn main()` also produces an entry module
that runs `main` when loaded. `main` may return `()` or `Result<(), E>`, where an
`Err` surfaces as a thrown error or nonzero exit, and may be `async`, in which
case it lowers to top-level `await`.

## Methods

A method is exported as a free function taking its receiver as the first
argument. `p.distance()` is internal sugar; across the boundary it is
`distance(p)`. There is no `this` and no prototype.

Trait methods do not cross the boundary on their own, since JavaScript has no
traits.
To expose one, export a named wrapper that calls it, disambiguating inside:

```hedge
fn area_of(s: &Shape) -> f64 { Geometry::area(s) }
export "js" area_of
```

## Values

- Owned values handed out become plain JavaScript objects; Hedge gives up
  ownership (see [Safe/Unsafe Boundaries](0023-safe-unsafe-boundaries.md)).
- `Option` maps to the value or `null`.
- `Result` throws its `Err` synchronously, or rejects the returned promise for an
  `async` function, and unwraps `Ok`.
- An `async fn` is a `Promise`-returning function.

## Guards

Every export validates its inbound arguments against the primitive-only rule
before running, unless the function is marked `unchecked`. See
[Safe/Unsafe Boundaries](0023-safe-unsafe-boundaries.md).

## Cleanup

A `Drop` value sent out is given a `[Symbol.dispose]` so JavaScript can release
it with `using`; see [Drop & RAII](0007-drop-and-raii.md).
