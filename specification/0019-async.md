# Async

An `async fn` compiles directly to a JavaScript `async function` that returns a
`Promise`. The event loop is the executor and promises are the futures, so there
is no executor to choose, no future state machine to manage, and no pinning or
thread-safety machinery.

```hedge
async fn load(url: &str) -> str {
  let res = fetch(url).await;
  res.text().await
}
```

## Borrows across await

A borrow may be held across an `await`. While a task is suspended other tasks
run, but the borrow rules already guarantee no other reference to a
write-borrowed region exists, and Hedge runs on a single thread, so suspension
cannot introduce a conflicting access.

This makes the borrow itself a compile-time lock for a uniquely-owned value:
holding `&write` across an `await` excludes every other task from that region for
the whole span (a mutex), and the read/write borrow split gives many-readers or
one-writer (an RW-lock), all checked statically, with no runtime primitive. A
_runtime_ async lock is only needed for shared ownership, which is deferred along
with interior mutability; when added it must be a non-blocking awaitable lock
(its guard releases on `Drop` and yields `&write`), never a thread-style blocking
one.

## Detached tasks

A task that is spawned and not awaited in the current scope may outlive that
scope. It may capture only owned values; it cannot capture a borrow, because the
borrowed data could be gone before the task runs. Async calls awaited in scope
have no such restriction.

## Async methods in traits

An `async fn` may be a trait method. Because it lowers to a `Promise`-returning
method, a uniform type, it needs no special machinery: it works in both static
(witness) and dynamic (`dyn Trait`) dispatch, with no boxing, no associated
future type, and no `Send` bound. It is object-safe by the same rules as a sync
method (see [Generics & Traits](0015-generics-and-traits.md)). The borrow rules
above apply: an async method that borrows the receiver keeps it borrowed until
the returned promise is awaited.

## Workers

A worker (Web Worker, `worker_threads`) is a separate JavaScript heap, so Hedge
treats each worker as an isolated single-threaded runtime. Workers share no
object memory; they communicate by message, which is a boundary like the
JavaScript one, so only serializable data crosses, by copy or by transfer.
Transfer is a move: a transferred value is gone from the sender, exactly as an
ownership move invalidates its source. Global state is therefore per-worker.

Genuine shared memory exists only through `SharedArrayBuffer`, which shares a
flat block of numeric bytes, never an object graph. So no worker scenario shares
Hedge objects across threads, and the language needs no `Send`/`Sync`. Shared
numeric buffers with atomics are a deferred, contained feature, not a
language-wide thread-safety system.

## Async cleanup

A value whose cleanup must await is handled by async `Drop`; see
[Drop & RAII](0007-drop-and-raii.md).

## Crossing into JavaScript

An exported `async fn` is an ordinary promise-returning function on the
JavaScript side, so async crosses the boundary without ceremony, subject to the
same primitive-only rules for what the promise resolves to.
