# Structs

A struct is a named product type. Its value is a single region (see
[Execution Model](0002-execution-model.md)) whose fields are tracked as
independent places for the purpose of moves and borrows.

## Capabilities

Capabilities belong to the binding rather than to the field: `let mut s` makes
the whole struct mutable and `let s` makes it read-only, and the fields inherit the
struct's capability, since there is no per-field capability. Moves and borrows are
nonetheless tracked per field, which is what makes partial moves and disjoint field
borrows possible.

## Borrowing fields

Borrows of statically distinct places do not conflict, so distinct fields may be
borrowed at once, including more than one `&mut`:

```hedge
let mut p = Point { x: 0, y: 0 };
let a = &mut p.x;
let b = &mut p.y;   // distinct place, no conflict
```

Three boundaries qualify this. A borrow of a field excludes any overlapping borrow,
so `&mut s.a` excludes both `&s` and any other borrow of `s.a`. A `&self` or
`&mut self` method borrows the whole struct, because disjointness is not inferred
through a call; it holds only for direct field access, and the signature, not the
body, is the contract. Dynamic indices are not statically distinct, so
`&mut arr[0]` and `&mut arr[1]` conflict, since the compiler cannot prove the
indices differ.

## Privacy

Fields are private by default and exposed with `pub`, relative to the defining
module; finer scoping belongs to the Modules design. Privacy controls visibility
only and is orthogonal to capabilities: `pub` means a field can be named and read
from outside, while whether it can be mutated still depends on the binding's
capability. There is no `pub mut`, so to expose a field for reading while keeping
it under the type's control, keep it private and offer a method. A struct with any
field the caller cannot see cannot be built with a struct literal from outside its
module, and is instead constructed through an associated function.

A struct may be marked `#[non_exhaustive]` so that adding a public field later is not a
breaking change for other packages, since the marker forces them to construct
through a function and to use `..` in patterns. A struct that already has a private
field is `#[non_exhaustive]` in effect, so the marker matters only for an all-public
struct. The same modifier applies to the more common enum case (see
[Enums](0014-enums.md)).

## Construction

```hedge
let p = Point { x: 0, y: 0 };
let p = Point { x, y };          // field shorthand
let q = Point { x: 1, ..p };     // update: remaining fields moved from p
```

All fields must be initialized. The update form `..base` moves the unmentioned
fields out of `base`, copying them for `Copy` types and otherwise leaving `base`
partially moved. Tuple and unit structs are written `struct Pair(i32, i32)`,
constructed `Pair(1, 2)`, and `struct Marker;`. There are no inline field defaults;
a default value comes from a constructor or a `Default` implementation. Construction
produces an OWNED value, and the binding decides its capability.

## impl and methods

Behavior lives in `impl` blocks, which hold associated functions, called without a
receiver as `Type::f()`, and methods, called on a receiver as `value.m()`:

```hedge
impl Point {
  fn new(x: i32, y: i32) -> Self { Point { x, y } }   // associated function
  fn x(&self) -> i32 { self.x }                        // method
  fn shift(&mut self, dx: i32) { self.x = self.x + dx }
}
```

A receiver composes from the borrow and capability vocabulary:

| Receiver    | Meaning                      |
| ----------- | ---------------------------- |
| `self`      | consume (move in), read-only |
| `mut self`  | consume (move in), writable  |
| `&self`     | shared (read) borrow         |
| `&mut self` | exclusive (write) borrow     |

There is no `bind self`. Call sites auto-reference the receiver, so `p.x()` takes
`&p`, `p.shift(1)` takes `&mut p` and therefore requires `p` to hold `mut`, and
`p.into_thing()` moves `p`. A type may have multiple `impl` blocks, and `Self` names
the implementing type. Methods are private by default and exposed with `pub`. Trait
implementations, written `impl Trait for Type`, are covered with traits.

## Newtypes

A single-field tuple struct over another type, such as `struct UserId(u64)`, is a
newtype: a distinct type that shares the representation of its inner value. A newtype
wrapping a primitive is zero-cost, represented as the bare inner value at runtime —
a `UserId` is a `number`, not `{ 0: number }` — with its own methods and trait
implementations dispatched statically. This gives type safety and custom behavior at
no runtime cost, and it is how the standard library defines refinement types such as
the `Finite` floats (see [Primitive Types](0010-primitive-types.md)).

## Cyclic data

A graph, doubly-linked list, or parent-pointer structure needs shared ownership,
which is deferred along with interior mutability. Until that lands, model such data
with indices into a [`Vec`](0012-collections.md), used as an arena, rather than with references between
nodes.
