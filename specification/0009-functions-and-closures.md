# Functions & Closures

## Functions

A named function is declared with `fn` and is itself a first-class value: it can
be bound, passed, and returned, and it has the function type `fn(T) -> R`.

```hedge
fn add(a: i32, b: i32) -> i32 { a + b }
let op: fn(i32, i32) -> i32 = add;
```

## Closures

A closure is written `|params| body`, with either an expression body or a block,
and with optional type annotations:

```hedge
|x| x + 1
|x: i32| -> i32 { x + 1 }
|| compute()
```

The `|x|` form rather than `(x) =>` keeps `=>` unambiguously the match-arm
separator.

### Capture

A closure captures each variable it references by the least capability its body
requires, inferred per variable. A variable that is only read is captured by `&`
and shared-borrowed for the closure's life; a variable that is mutated is captured
by `&mut` and exclusively borrowed; a variable that is consumed is captured by
move. Writing `move |…| …` forces every capture to be taken by value. Capture is
disjoint, so using `s.x` captures the place `s.x` rather than all of `s`.

### Call capability

How a closure captures determines how it may be called, paralleling method
receivers:

| Captures                       | Trait     | Call receiver |
| ------------------------------ | --------- | ------------- |
| only `&` (or `Copy`)           | `Fn`      | `&self`       |
| any `&mut`                     | `FnWrite` | `&mut self`   |
| anything by move (consumes it) | `FnOnce`  | `self`        |

A non-capturing closure coerces to a plain `fn(T) -> R`.

### Escaping closures

A closure that escapes its scope — by being returned, stored, or handed to a
spawned task — must own its captures, taken with `move`, because a borrowed source
could be gone before the closure runs. A closure that stays within its scope may
capture by borrow, tracked like any other borrow. This is the same rule that
governs detached async tasks (see [Async](0019-async.md)).

### Async closures

`async |x| …` is a closure whose body is asynchronous; it returns a `Promise` and
is an ordinary async JavaScript arrow. The same capture and escape rules apply.

## Recursion

A function may call itself, but JavaScript engines do not guarantee tail-call
optimization, so deep recursion can overflow the stack. Prefer iteration or an
iterator where the depth is unbounded.

## Generated code and Drop

Closures compile to native JavaScript closures that close over their captures; the
runtime reclaims a closure's memory once it is unreachable. A `&mut` capture of a
primitive is the `{ v }` cell used for mutable primitive borrows (see
[Borrows](0005-borrows.md)). A closure owns its by-move captures, so a closure
holding a `Drop` value is itself a `Drop` value, dropped at the end of its scope
and running the captures' cleanup then.
