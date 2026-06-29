# Mutability

Hedge does not treat mutability as a property of a binding or a type. Every
runtime value is a memory region with an ownership state (see
[Execution Model](0002-execution-model.md)), and what may be done to a value
follows from that state rather than from how its binding was declared. The state
captures both the value's aliasing, whether it is owned or shared, and whether
it may be mutated and reassigned.

These states refine the execution model's OWNED state into two variants by
mutability, so the full set a region may be in is:

- **OWNED-IMMUTABLE**: exclusively owned, with neither mutation nor reassignment.
- **OWNED-MUTABLE**: exclusively owned, both mutation and reassignment permitted.
- **SHARED**: one or more shared references (`&`) exist; neither mutation nor
  reassignment is permitted.
- **EXCLUSIVE-BORROW**: one mutable reference (`&mut`) exists; the owning
  binding is frozen until the borrow ends, and the owner must hold `mut`.
- **UNBOUND**: the value has been moved and can no longer be accessed.

The invariant tying these together is that a region is either held exclusively —
an OWNED variant, or a single `&mut` borrow — or shared, but never both.

## Declaring mutability

A binding declares whether its region is mutable. The default grants no
mutability, so a plain `let` is immutable:

```hedge
let users = [];     // OWNED-IMMUTABLE
users.push("foo");  // invalid: not mutable
users = [];         // invalid: not mutable
```

`let mut` permits both mutation and reassignment:

```hedge
let mut users = [];
users.push("foo");  // valid
users = [];         // valid: reassignment transfers ownership
```

## Moves

Assignment without an explicit clone moves the value: ownership and mutability
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
let mut b = value;   // invalid: value is SHARED
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

Two alternatives were considered and rejected:

- The initial direction of this specification defined two-capability system
  that used a `write` axis to control interior mutability and a `bind` axis
  to control variable reassignment; the control proved impractical for
  primitive values (i.e., what does "interior mutability" mean on a primitive?)
  and the underlying concern seems to already be addressed by the
  borrow system.

- A TypeScript-style `readonly` annotates the type rather than the value, so it
  imposes no aliasing constraint, cannot express exclusive ownership, and need
  not match the value's runtime mutability.
