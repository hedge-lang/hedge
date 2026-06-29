# Safe / Unsafe JavaScript Boundaries

This consolidates the boundary's safety contract. The mechanics of each direction
are in [JavaScript Interactions](0003-javascript-interactions.md).

## The contract

JavaScript is foreign and untrusted. Hedge does not reason about its aliases,
getters, proxies, or prototypes, and protects its own model with a few rules at
the boundary.

- **Primitives only, inward:** only primitive values may cross from JavaScript
  into Hedge. Complex objects cannot, since they would let JavaScript alias or
  mutate data behind Hedge's back.
- **No references across:** neither `&T` nor `&mut T` crosses in either
  direction; JavaScript has no notion of a borrow, and letting one cross would
  surrender Hedge's ownership guarantees. A borrowing struct cannot cross either.
- **Owned values may go out:** Hedge may hand an owned value to JavaScript, at
  which point it gives up ownership and JavaScript may do as it likes. Hedge
  emits no declaration implying otherwise.
- **Runtime guards:** each export checks its inbound arguments against the
  primitive-only rule before running.

## Opting out: `unchecked`

A boundary that has been audited, or is performance-critical, can drop its guard
per function:

```hedge
export "js" unchecked
fn fast_path(n: i32) -> i32 { … }
```

## Unsafe imports

JavaScript functionality that cannot satisfy these rules, such as DOM and browser
APIs or arbitrary objects, is reached through `unsafe` declarations:

```hedge
extern "js" {
  unsafe fn query_selector(node: Document, selector: &str) -> Element;
}
```

`unsafe` marks the boundary where Hedge's guarantees stop and the author takes
responsibility.

## Cleanup

A `Drop` value sent out cannot rely on JavaScript to clean it up. It crosses
through an explicit conversion that attaches `[Symbol.dispose]`, and a debug
build warns if such a value is collected without being disposed. See
[Drop & RAII](0007-drop-and-raii.md).
