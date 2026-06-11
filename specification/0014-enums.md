# Enums

An enum is a sum type: a value is exactly one of the enum's variants, and a variant
may carry data. Enums reuse the [struct](0013-structs.md) rules for ownership,
methods, and receivers, so this document covers only what is specific to them.

## Variants

A variant takes one of three forms, mirroring the struct shapes:

```hedge
enum Message {
  Quit,                       // unit
  Move(i32, i32),             // tuple
  Write { text: str },        // struct
}
```

Variants are namespaced under the enum and constructed by path:

```hedge
let m = Message::Move(1, 2);
let q = Message::Quit;
```

A value owns the payload of its active variant, and move and `Drop` act on that
live variant's fields exactly as they do for a struct.

## Visibility

A variant shares the enum's visibility: if the enum is `pub`, every variant and
every field within it is public. There are no private variants, because a sum
type's full shape is part of its contract and is what keeps pattern matching
exhaustive. To hide data inside a variant, give the variant a struct payload whose
own fields are private.

## Methods

An enum takes `impl` blocks and the same `[&][write] self` receivers as a struct:

```hedge
impl Message {
  fn is_quit(&self) -> bool { /* matches against Message::Quit */ }
}
```

It is otherwise consumed by pattern matching, which has its own document.

## Evolving an enum

Because variants are public, adding one is normally a breaking change, since every
foreign `match` was exhaustive over the previous set. Marking an enum
`#[non_exhaustive]` makes it open to future variants: a `match` in another package must
then include a `_` arm, so a new variant does not break it, while matching remains
exhaustive and checked within the defining package. This helps only when applied
from the enum's first release, because adding `#[non_exhaustive]` to an existing enum
is itself breaking — foreign exhaustive matches would then need a `_`. The same
modifier applies to structs, where it is mostly redundant with field privacy.

## Recursive types

An enum, like a struct, may refer to itself directly, as in
`enum List { Cons(i32, List), Nil }`, with no indirection wrapper. There is no
`Box`, because every value is a JavaScript reference and a recursive type therefore
has a well-defined representation without one; this is also why a `dyn Trait` needs
no box.

## Generated code

An enum compiles to a tagged object and appears in the generated `.d.ts` as a
discriminated union, the idiomatic TypeScript shape:

```ts
type Message =
  | { tag: "Quit" }
  | { tag: "Move"; _0: number; _1: number }
  | { tag: "Write"; text: string };
```

A TypeScript consumer can `switch` on `tag` directly.
