# Drop & RAII

A type may implement `Drop` to run cleanup when a value's lifetime ends: closing
a file, releasing a handle, flushing a buffer. Because Hedge runs on JavaScript
and does not manage memory by hand, `Drop` exists only for these observable side
effects, not for reclaiming memory.

## When Drop runs

A value is dropped at the end of its enclosing scope, and values in the same
scope are dropped in reverse order of declaration:

```hedge
{
  let a = File::open("a");   // dropped second
  let b = File::open("b");   // dropped first
}
```

A value that has been moved out is not dropped at the original site, since the
responsibility to drop it moved with it. To clean up before the end of scope,
drop the value explicitly:

```hedge
drop(a);   // runs cleanup now and marks a unbound
```

## Generated code

A scoped value lowers to `using` and a `[Symbol.dispose]` method, which runs the
cleanup at the end of the scope, including when the scope exits through a thrown
error:

```ts
using a = File.open("a");   // a[Symbol.dispose]() runs on the way out
```

## Conditional moves

When a value is moved on some control-flow paths but not others, whether it still
needs dropping is not known until runtime. The statically decided case, which is
the common one, carries no overhead; only the genuinely runtime-dependent case
adds a hidden boolean — a drop flag — to record whether cleanup is still owed:

```hedge
if cond { consume(a); }
// at scope end: drop a only if it was not consumed
```

`--warn-drop-flags` reports each site where a drop flag is emitted, for code that
needs to keep cleanup fully static.

## Failure in Drop

`Drop` is infallible by contract: `drop` returns nothing and is not expected to
throw. Cleanup that can fail does not belong in `Drop`, because a failure
occurring implicitly at scope exit cannot be handled. Fallible teardown is
exposed instead as an explicit `close()`, `flush()`, or `finish() -> Result` that
the caller runs and handles while it still can, leaving `Drop` as the best-effort
backstop.

A throw from `Drop` is treated as a panic. When it happens while another error is
already propagating, neither error is lost: lowering to `using` produces a
`SuppressedError` that wraps both. Async `Drop` behaves the same way through
`await using`.

## Crossing into JavaScript

A `Drop` value cannot be handed to JavaScript implicitly, since that would
surrender it to code that will not run its cleanup. It crosses through an explicit
conversion that gives up ownership and attaches `[Symbol.dispose]`, so the
JavaScript side can release it with `using`. In a debug build, a `Drop` value
that is garbage-collected without being disposed produces a leak warning, which
is a diagnostic and never a guarantee. See
[JavaScript Interactions](0003-javascript-interactions.md).

## Async cleanup

Cleanup that must await, such as an asynchronous flush or close, is an async
`Drop`, lowered to `[Symbol.asyncDispose]` and `await using`. A value with async
cleanup is async-tainted: it can be held only in an async context, where its
disposal can be awaited. See [Async](0019-async.md).