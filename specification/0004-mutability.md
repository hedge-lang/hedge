# Mutability

Hedge does not treat mutability as a property of a binding or a type. Every
runtime value is a memory region with an ownership state (see
[Execution Model](0002-execution-model.md)), and what may be done to a value
follows from that state rather than from how its binding was declared. The state
captures both the value's aliasing, whether it is owned or shared, and its
capabilities, whether it may be mutated or reassigned.

These states refine the execution model's single OWNED state into four owned
variants by capability, so the full set a region may be in is:

* **OWNED-READONLY**: exclusively owned, with neither mutation nor reassignment.
* **OWNED-REBINDABLE**: exclusively owned, reassignment permitted.
* **OWNED-WRITE**: exclusively owned, mutation permitted.
* **OWNED-FULL**: exclusively owned, both mutation and reassignment permitted.
* **SHARED**: one or more shared references (`&`) exist; neither mutation nor
  reassignment is permitted.
* **EXCLUSIVE-BORROW**: one mutable reference (`&write`) exists; the owning
  binding is frozen until the borrow ends, and the owner must hold `write`.
* **UNBOUND**: the value has been moved and can no longer be accessed.

The invariant tying these together is that a region is either held exclusively —
an OWNED variant, or a single `&write` borrow — or shared, but never both.

## Capabilities

Two capabilities distinguish the OWNED states. `write` governs whether the region
may be mutated, and `bind` governs whether the binding may be reassigned; `bind
write` grants both. A capability is a property of the owned region, so it is
preserved across a move and suspended while the region is shared by a reference.

## Declaring capabilities

A binding declares the capabilities its region starts with. The default grants
neither, so a plain `let` is read-only:

```hedge
let users = [];     // OWNED-READONLY
users.push("foo");  // invalid: no write
users = [];         // invalid: no bind
```

`bind` permits reassignment but not mutation:

```hedge
let bind users = [];
users.push("foo");  // invalid
users = [];         // valid: reassignment transfers ownership
```

`write` permits mutation but not reassignment:

```hedge
let write users = [];
users.push("foo");  // valid
users = [];         // invalid
```

`bind write` permits both:

```hedge
let bind write users = [];
users.push("foo");  // valid
users = [];         // valid
```

## Moves

Assignment without an explicit clone moves the value: ownership and capability
state transfer to the destination, and the source becomes UNBOUND.

```hedge
let second = users;
users.push("foo");  // invalid: users is UNBOUND
```

## Sharing

Taking a reference moves the region into SHARED state, and a shared region cannot
be mutated or reassigned through any binding for as long as a reference lives.

```hedge
let foo = Foo::new(&value);
value.push(2);       // invalid while value is SHARED
let write b = value; // invalid: value is SHARED
```

This is the same exclusivity the [execution model](0002-execution-model.md)
enforces; the lending of mutable access is covered in
[Borrows](0005-borrows.md).

## Why this model

The conventional split between binding mutability and value mutability leaves
several questions ambiguous at once: whether a name may be reassigned, whether a
value may be changed in place, whether references are exclusive, and whether
interior mutability is in play. Hedge folds all of these into a single ownership
state so that aliasing is the one invariant governing mutation. References are a
tracked state rather than an annotation, mutation is always subject to
exclusivity, and a binding cannot escalate its own capabilities by reassignment.

Two alternatives were considered and rejected. A Rust-style `let mut` ties
mutability to the binding, which reintroduces the ambiguity between binding
mutability, reference exclusivity, and interior mutability that this model exists
to remove. A TypeScript-style `readonly` annotates the type rather than the
value, so it imposes no aliasing constraint, cannot express exclusive ownership,
and need not match the value's runtime mutability.