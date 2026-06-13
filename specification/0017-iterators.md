# Iterators

## The protocol

Iteration follows a single protocol: an iterator yields `Some(item)` until it is
exhausted, then `None`.

```hedge
trait Iterator {
  type Item;
  fn next(&write self) -> Option<Self::Item>;
}
```

A `for` loop consumes anything that implements `IntoIterator`, in three flavors:

- `for x in v` consumes `v` (`x: T`),
- `for x in &v` borrows it shared (`x: &T`),
- `for x in &write v` borrows it exclusively (`x: &write T`).

`for x in iter { body }` desugars to repeated `next()` calls until `None`.

## Iteration is borrow-checked

`for x in &v` borrows `v` for the whole loop, so mutating `v` mid-iteration is a
compile error; the concurrent-modification bug that JavaScript's `for…of` permits
is rejected here. To change elements while iterating, iterate `&write v` and
mutate through `x`.

## Adapters and consumers

Adapters are lazy and return new iterators: `map`, `filter`, `take`, `zip`,
`enumerate`, `chain`, … Consumers are terminal: `collect`, `fold`, `sum`,
`count`, `last`, `find`, `any`, `all`. This is the expression-oriented way to
reduce a sequence to a value:

```hedge
let total = (0..10).filter(|n| n % 2 == 0).sum();
let last  = (0..10).last();   // Option<i32>, None if the range were empty
```

Ranges (`0..10`, `0..=10`) are iterators, matching the `..=` range patterns.

## Generated code

A Hedge iterator maps onto JavaScript's iteration protocol: `next() -> Option`
corresponds to JS `next() -> { value, done }` (`Some(x)` ↔ `{ value: x, done:
false }`, `None` ↔ `{ done: true }`). So a Hedge iterator is a JavaScript
iterable, a `for … in` loop lowers to `for…of`, and an exported iterator is consumable by
JavaScript directly.

For hot cases the compiler specializes instead of allocating iterator objects:
`for x in 0..n` or `for x in &vec` lowers to a plain indexed loop. Inbound
JavaScript iterables remain subject to the primitive-only boundary rule, so
iteration interop is primarily outbound.
