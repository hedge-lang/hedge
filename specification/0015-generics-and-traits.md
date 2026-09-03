# Generics & Traits

## Generics

Functions, structs, enums, and impls may be parameterized by type:

```hedge
fn first<T>(xs: &[T]) -> &T { &xs[0] }
struct Pair<A, B> { a: A, b: B }
enum Option<T> { Some(T), None }
impl<T> Pair<T, T> { … }
```

A parameter may carry trait bounds, written inline or in a `where` clause, and
explicit type arguments are written with `::<>`:

```hedge
fn draw_all<T: Draw>(xs: &[T]) { … }
fn draw_all<T>(xs: &[T]) where T: Draw { … }
first::<i32>(xs)
```

## Runtime model

Generics are checked at compile time and then erased. A generic function compiles
to a single JavaScript function and a generic type to a single shape, with no
per-type copy, because JavaScript is dynamically typed and monomorphizing would
bloat the output for no runtime gain.

Since a generic body is compiled once, the trait implementations it relies on are
passed in as hidden arguments, a witness for each bound. A call to `draw_all(xs)`
where `T` is `Point` passes the `Draw for Point` implementation alongside `xs`, and
`x.draw()` within the body dispatches through it. Where a method physically lives on
the value, as a struct's own method does, code generation may lower the call to
ordinary JavaScript dispatch instead; the witness is the fallback, and it also
covers primitives and foreign types.

This is not zero-cost in the way monomorphization is, because a witnessed call is an
indirect call with no inlining across the generic boundary. To recover speed where
it matters, the compiler may selectively monomorphize an instantiation whose
concrete type is statically known and where specialization pays off, in a hot,
small, or rarely-instantiated body. The specialization preserves behavior and stays
conservative by default, since code size is a cost paid on every page load. A
`dyn Trait` always remains witnessed, and an optional hint can force specialization
of a known-hot generic.

## Traits

A trait is a set of required and default methods, and optionally one or more
associated types:

```hedge
trait Iterator {
  type Item;
  fn next(&mut self) -> Option<Self::Item>;
  fn count(self) -> usize { … }   // default method
}
```

An associated type is an output determined by the implementing type: a type
implements the trait once, that implementation fixes the type, and the type can
then be named as a projection such as `I::Item`. A trait type parameter is used
instead when a type should implement the trait several ways with different
arguments, as `Add<Rhs>` and `From<T>` do. Generic associated types are deferred. A
trait may also require another, so `trait Ord: Eq { … }` makes `Eq` a supertrait.

## Implementing traits

```hedge
impl Draw for Point {
  fn draw(&self) -> str { … }
}
```

Implementations must be coherent: a trait may be implemented for a type only in the
module that defines the trait or the one that defines the type. This orphan rule
ensures that two libraries can never define conflicting implementations. Blanket
implementations, written `impl<T: A> B for T`, are permitted within it.

## Static and dynamic dispatch

Generic code is dispatched statically through witnesses, since the concrete type is
known at the call site even though the body is shared. When the concrete type should
not be fixed at the call site, as in a heterogeneous collection or a plugin-style
boundary, a trait object `dyn Trait` carries its witness at runtime:

```hedge
let shapes: Vec<dyn Draw> = …;   // each element brings its own Draw
```

## Object safety

Because generics are erased, most of the usual restrictions on which traits can
serve as `dyn Trait` do not apply. A generic method is allowed, since an erased
generic method is a single function that takes its type-witness as an argument and so
needs only one witness entry, with the caller supplying the witness as usual. A
method returning `Self` is allowed, since there is no stack-size concern: it returns
a concrete value re-wrapped with the same witness and typed back as `dyn Trait`. The
one genuine restriction is that `Self` may not appear in argument position other than
the receiver, because two different concrete types behind a `dyn Trait` could
otherwise be combined, which an implementation cannot assume.

Downcasting a `dyn Trait` to a concrete type is a checked operation that returns
`Option`; there is no unchecked type assertion, since the language has no `as`.

## Derive

Common implementations are generated with `derive`:

```hedge
#[derive(Clone, Eq, Default)]
struct Point { x: i32, y: i32 }
```

`Default`, deferred from construction, lives here alongside `Clone`, `Eq`, `Copy`,
and others.

`derive` is sugar provided by the macro system: `#[derive(Clone)]` expands to an
ordinary `impl Clone for Point { ... }` block, checked for coherence like any
hand-written implementation. Because the macro system is deferred (see
[the index](0000-index.md) and
[ADR 0013](../docs/adr/0013-derive-deferred-to-macro-system.md)), `derive` is not
yet available; until it lands, these implementations are written explicitly. The
traits `derive` targets are ordinary traits with no special status.

## Equality, ordering, and hashing

`==` is structural: it compares values rather than references and desugars to
`PartialEq::eq`, whose implementation compares field by field. It is never
JavaScript's `===`, so two structurally equal values compare equal even though they
are distinct objects at runtime. The comparison traits come in the usual pairs.
`PartialEq` and `Eq` differ in that `Eq` is a full, reflexive equivalence; `f32` and
`f64` are only `PartialEq`, since NaN is not equal to itself, while the `FiniteF32`
and `FiniteF64` newtypes are `Eq`. `PartialOrd` and `Ord` follow the same split,
with the `Finite` newtypes totally ordered and the raw floats only partially.
`Hash` is structural and is required, with `Eq`, of any map or set key.

The key's traits determine how a `HashMap` or `HashSet` is represented. A primitive
key, such as `i32`, `str`, or `bool`, gives a thin JavaScript `Map` or `Set`,
because JavaScript keys primitives by value. A composite key — a struct, enum, or
tuple, which is an object at runtime and which JavaScript would otherwise key by
reference identity — gives a real hash map that buckets by `Hash` and compares with
`Eq`, rather than a naive `Map` of objects.

## Copy, Clone, and Drop

`Copy` marks a type that is duplicated rather than moved on assignment, which is
permitted only for a type whose fields are all `Copy` and which has no `Drop`:
primitives and small plain-data structs. `Clone` is an explicit duplicate,
`value.clone()`, for everything else. `Drop` is cleanup at the end of scope (see
[Drop & RAII](0007-drop-and-raii.md)).
