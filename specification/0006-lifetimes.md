# Lifetimes

References are first-class: a reference can be passed to a function, returned from
one, and stored in a struct field. A lifetime is the span over which a reference
remains valid, and it is part of a declaration's signature. The borrowing
behavior of a function or type can therefore be read from its signature alone,
without consulting any implementation, and editing a body can never silently
change it.

Lifetimes exist only inside Hedge. They have no runtime representation and are
erased before code generation, and references never cross the JavaScript boundary
(see [JavaScript Interactions](0003-javascript-interactions.md)).

## Elision

Most signatures need no annotations, because the compiler supplies them by three
rules:

1. Each unannotated reference parameter is given its own lifetime.
2. If there is exactly one reference parameter, its lifetime is given to every
   reference in the return type.
3. In a method, a `&self` or `&write self` receiver's lifetime is given to every
   reference in the return type.

```hedge
fn first(s: &str) -> &str        // rule 2: the result borrows s
fn peek(&self) -> &Token         // rule 3: the result borrows self
```

## When annotations are required

When the rules cannot determine where a returned reference borrows from, the
signature is ambiguous and is rejected. The fix is to state the relationship
explicitly, since the compiler never infers borrowing from the body. Lifetimes
are written with a leading apostrophe.

```hedge
fn longest(a: &str, b: &str) -> &str                // error: ambiguous result
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str   // result lives as long as
                                                    // both inputs
```

## Lifetimes in structs

A struct that stores a reference is parameterized by that reference's lifetime,
and an instance cannot outlive what it borrows. The parameter propagates to
anything that holds the struct.

```hedge
struct Cursor<'a> {
  source: &'a str,
  pos: usize,
}
```

## Variance

Subtyping in Hedge comes only from lifetimes — a longer lifetime is usable
wherever a shorter one is expected — and variance is the rule set governing how
that subtyping passes through compound types. The compiler infers it from how a
type uses each parameter; it is never annotated. A position is covariant when a
longer lifetime may be supplied where a shorter one is expected, contravariant
when only a shorter one may, and invariant when neither substitution is sound.

- `&'a T` is covariant in both `'a` and `T`.
- `&'a write T` is covariant in `'a` but invariant in `T`. This is the
  load-bearing case: were a mutable borrow covariant in `T`, a shorter-lived
  reference could be stored through it into a longer-lived slot.
- Owned containers and structs are covariant in their parameters where those
  parameters are used covariantly, with a type's variance derived field by field.
- Function types are covariant in their return and contravariant in their
  arguments.
- Interior-mutability types, once added, are invariant.

Variance is a purely compile-time property, unaffected by the JavaScript target
because lifetimes are erased. It still matters under garbage collection: unsound
variance would not corrupt memory, but it would allow a `&write` to be aliased or
a value to be observed after its `Drop` had run, breaking the exclusivity and
deterministic-cleanup guarantees the language depends on.
