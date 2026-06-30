# Borrowing

A borrow is a reference to a region that does not take ownership of it. There are
two kinds. A read-borrow, `&`, grants read-only access:

```hedge
let name = &user.name;
```

A mutable-borrow, `&mut`, grants exclusive mutable access:

```hedge
let name = &mut user.name;
```

## Rules

Four rules govern borrowing:

1. Any number of read-borrows may be active at once.
2. At most one mutable-borrow may be active at a time.
3. A mutable-borrow excludes everything else for its duration. No read-borrow may
   overlap it, and the owning binding is frozen: it cannot be read, written,
   moved, or re-borrowed until the mutable-borrow ends.
4. A mutable-borrow requires the owner to hold the `mut` capability, since a
   borrow cannot lend mutation if the owner does not have it.

These are the exclusivity rules that govern region state in the
[execution model](0002-execution-model.md): a region is shared or exclusive,
never both.

## Borrow extent

A borrow lasts until its last use rather than until the end of the enclosing
block, so a borrow that is never used again ends immediately:

```hedge
let mut n = 0;
let r = &mut n;
*r = 1;          // last use of r; the borrow ends here
read(n);         // n is no longer borrowed
```

The compiler infers this from use. Explicit lifetime annotations are needed only
when a signature is ambiguous about which input a returned reference borrows
from, which is covered in [Lifetimes](0006-lifetimes.md).

## Reading and writing through a borrow

Field and method access reach through a borrow automatically:

```hedge
let u = &user;
print(u.name);          // no explicit dereference
```

Reading or replacing the referent itself uses `*`:

```hedge
let r = &mut count;
*r = *r + 1;            // read and write the referent
```

## Borrows in data structures

A struct may store a borrow in a field. Such a struct carries the lifetime of
what it borrows and cannot outlive it; see [Lifetimes](0006-lifetimes.md).

## Borrows across suspension

A borrow may be held across an `await`. The borrow rules and a single-threaded
event loop together ensure that suspension cannot introduce a conflicting alias;
see [Async](0019-async.md).
