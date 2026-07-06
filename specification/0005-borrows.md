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

This rules out a common class of JavaScript bugs: many concurrent tasks read a
shared value, await, then write back what they read, and an update made in
between is silently lost.[^async-race]

```js
let count = 0;
async function increment() {
  await sleep(random());
  const seen = count;
  await sleep(random());
  count = seen + 1;
}
await Promise.all(Array.from({ length: 1000 }, increment));
// count ends far below 1000: two tasks can read the same value
// before either writes it back.
```

`increment` needs `&mut count` to read and later write it, held across both
`await` points. A second async function cannot take `&mut count` while the
first function's borrow is still live, so Hedge rejects the concurrent version
outright and accepts only the sequential one, where each borrow ends before the
next begins. The lost update becomes a compilation error instead of a race that
only surfaces under load.

NOTE: This is not the forever-syntax for Hedge, there are plans to provide
ergonomic syntax for sharing mutable state across async tasks.

[^async-race]: [Node.js race conditions](https://nodejsdesignpatterns.com/blog/node-js-race-conditions/), [async-mutex](https://github.com/DirtyHairy/async-mutex), [Race condition in upscale webhook, actions-runner-controller#1321](https://github.com/actions-runner-controller/actions-runner-controller/issues/1321)
