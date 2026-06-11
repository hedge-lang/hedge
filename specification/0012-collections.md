# Collections

There are three sequence types: a fixed-size array `[T; N]`, where `N` is a const;
a growable owned vector `Vec<T>`; and a slice `[T]`, a borrowed view into a
contiguous range used as `&[T]` or `&write [T]`.

A `Vec<T>` or `[T; N]` is backed by a JavaScript `Array` for an object element
type, or by a typed array for a numeric one, so `Vec<u8>` is a `Uint8Array`,
`Vec<i32>` an `Int32Array`, and so on; the engine enforces element width on write,
and because scalar arithmetic is already checked, every value reaching the array is
in range. A slice is a zero-copy view: for a numeric element type it is a native
`TypedArray.subarray` that shares the buffer, and for an object element type it is
a `{ array, start, len }` view. A `Vec<T>` or `[T; N]` coerces to `&[T]` when
borrowed, so a function takes `&[T]` to accept any of them.

Indexing `arr[i]` goes through `Index` and `IndexWrite` and panics out of bounds,
while `.get(i)` returns `Option<&T>` instead. Slicing `&arr[a..b]`, with the range
forms `a..=b`, `..b`, `a..`, and `..`, is bounds-checked and yields a slice. A live
`&[T]` borrow prevents mutating or growing the source, so a slice cannot become a
stale view after a `push`; the classic reallocation bug is a compile error here.
