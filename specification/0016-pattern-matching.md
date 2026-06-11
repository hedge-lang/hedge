# Pattern Matching

Pattern matching deconstructs a value and binds its parts. It appears in `match`,
`if let`, `while let`, and, for patterns that always match, in `let` and
function parameters.

## Binding modes

The form of the scrutinee sets the default mode for the bindings in its patterns:

* `match x { … }` binds from an owned scrutinee, so bindings **move** out (a
  partial move of `x`; Copy types copy).
* `match &x { … }` matches a read-borrow, so bindings are **read-borrows**; `x`
  is untouched.
* `match &write x { … }` matches a write-borrow, so bindings are
  **write-borrows**; `x` must hold `write`.

Pattern bindings use the same vocabulary as `let`: `name` is read-only,
`write name` is writable, `&name` is a read-borrow, `&write name` is a
write-borrow. These sigils are the whole vocabulary; there is no separate
binding keyword.

A binding may override the default with those sigils, for example borrowing one
field of an owned scrutinee while moving another. That is occasionally useful for
a mixed arm; most matches use the default mode throughout.

`..` ignores fields or elements you do not bind:

```hedge
match resp { Response { body, .. } => use(body) }
```

## Exhaustiveness

A `match` must cover every possible value, or it is a compile error;
exhaustiveness is the point of having sum types. `_` is the catch-all that closes
a match.

* An arm that can never match (already covered by earlier arms) is an error.
* A guarded arm (`pattern if cond`) does not count toward exhaustiveness, since
  it is conditional; an unguarded arm or `_` must still cover its pattern.

An enum marked `#[non_exhaustive]` (see [Enums](0014-enums.md)) is open to future
variants, so an exhaustive `match` on it from another package must include a `_`
arm.

## Refutability

A pattern is **irrefutable** if it always matches, such as a binding, `_`, or
destructuring a statically-known shape. It is **refutable** if it can fail: a
literal, a range, a variant of a multi-variant enum, or a dynamic-length slice
pattern.

`let` and function parameters require irrefutable patterns. `match`, `if let`,
and `while let` accept refutable ones.

```hedge
let Point { x, y } = p;            // ok: irrefutable
let [first, .., last] = xs;        // error: refutable (xs may be too short)
if let [first, .., last] = xs { }  // ok: runs only when xs has >= 2 elements
```

A fixed-length array gives a statically-known shape, so a same-length pattern is
irrefutable; a dynamic slice or [`Vec`](0012-collections.md) has a runtime length, so fixed-shape slice
patterns over it are refutable.

## Pattern kinds

* **Literals:** numbers, bools, chars, strings, and named constants.
* **Wildcard:** `_`.
* **Bindings:** `name`, with the capability sigils above.
* **Structs:** `Point { x, y }`, shorthand fields, `Point { x, .. }`.
* **Tuples and tuple structs:** `(a, b)`, `Pair(a, b)`.
* **Enum variants:** `Some(x)`, `Message::Move(a, b)`, `Message::Quit`.
* **Or-patterns:** `1 | 2 | 3`, `Ok(x) | Recovered(x)`. Every alternative must
  bind the same names with the same types and modes.
* **Ranges:** inclusive only, `1..=5`, `'a'..='z'`.
* **`@` bindings:** `n @ 1..=5` binds `n` while testing the subpattern.
* **Slices:** `[first, .., last]`, `[head, ..tail]`. A borrowing rest binding
  borrows a contiguous sub-slice; it does not yield independently writable
  elements.
* **Guards:** `pattern if cond`.

There is no separate reference pattern. The scrutinee form already drives binding
modes, and `&`/`&write` in a pattern mean "bind by borrow"; a second meaning for
`&` would only confuse.

## Generated code

A `match` on an enum lowers to a `switch` on the discriminant. An exhaustive
match needs no runtime fallback, though codegen may emit a throwing default as
defense-in-depth. A slice pattern lowers to a length guard plus index
extraction.