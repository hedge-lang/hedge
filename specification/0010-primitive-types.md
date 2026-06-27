# Primitive Types

## Integers

Hedge provides the eight fixed-width integer types `i8`, `i16`, `i32`, `i64`,
`u8`, `u16`, `u32`, and `u64`. Anything up to 32 bits is a JavaScript `number`,
which represents integers exactly up to 2⁵³; `i64` and `u64` exceed that range and
are `bigint`. The index and size types `usize` and `isize` are `number`-backed
integers within the JavaScript array range, where lengths and indices are at most
2³²−1, and they are bounds-checked like the rest.

Integer arithmetic wraps on overflow using two's complement, the same in every
build. There is no implicit overflow trap and no difference between a debug build
and a release build. The compiled representation for `i32` arithmetic uses the
JavaScript bitwise-OR trick to stay in range at zero cost:

```js
// i32 a + b
(a + b) | 0;
```

Division by zero is a runtime error that throws regardless of build mode.

For explicit control over overflow, Hedge provides named method families that make
the intent visible at the call site rather than relying on silent wraparound:

- `wrapping_add`, `wrapping_mul`, and so on — explicit wrap, same as the default.
- `saturating_add` and its kin — clamp to the type's bounds.
- `checked_add` and its kin — return `Option`, yielding `None` on overflow.
- `overflowing_add` and its kin — return a `(value, overflowed)` pair.

These methods will be available once the standard library reaches the integer
arithmetic slice.

## Floating point

`f32` and `f64` are the primitive floats and are raw IEEE values. Because they can
be NaN or infinite, they are only `PartialOrd`, and `f32` operations round through
`Math.fround`.

`FiniteF32` and `FiniteF64` are standard-library newtypes over the primitive
floats, declared as `struct FiniteF64(f64)`, rather than primitives in their own
right. They carry the guarantee that their value is finite, which makes them
totally ordered and gives them `Eq`, `Ord`, and `Hash`, so they are sortable,
usable as map keys, and comparable with `==`. As newtypes they are zero-cost: a
`FiniteF64` is a plain `number` at runtime (see [Newtypes](0013-structs.md)).

Finiteness is checked lazily rather than after every operation. Arithmetic on a
`Finite` value is raw IEEE arithmetic on the inner float with no checks, so it
optimizes like any floating-point code and admits non-finite intermediates that
resolve back to a finite result; `1.0 / (a / 0.0)`, for instance, is `0.0`. The
check runs only where finiteness is consumed, which is at comparison, ordering,
hashing, or explicit extraction:

```js
// x.finite()  — extract the guaranteed-finite value
if (!Number.isFinite(x)) throw new HedgePanic("FiniteF64: non-finite value");
return x;
```

`.finite()` returns the inner `f64` and panics if the value is non-finite at that
point, while `.try_finite()` returns `Option<f64>` instead; comparison, ordering,
and hashing likewise check and panic on a non-finite value. Converting `f64` to
`FiniteF64` records the finite intent without checking and is free, as is the
conversion back. None of this requires compiler support: the arithmetic delegates
to the inner float through operator overloading and the lazy check lives in the
trait implementations, so the type is ordinary library code.

The laziness is specific to floats, because IEEE infinities and NaN propagate
losslessly and can be validated at the end. Integers have no such poison value,
and intermediates beyond 2⁵³ would lose precision, so integer checks remain eager.

## Literals

An unconstrained integer literal defaults to `i32` and a float literal to `f64`;
otherwise a literal adopts the type its context expects, so `let x: u8 = 5` makes
`5` a `u8`. A suffix pins the type where needed: `5u8`, `5i64`, `1.5f32`. Literal
inference ranges over the built-in numeric types only, not over newtypes, so a
`Finite` value is constructed explicitly with `FiniteF64::from(1.5)`, which is
free.

## Conversions

Hedge has no `as` cast, neither the silently truncating numeric cast nor the type
assertion. Conversions are explicit and divided by whether they can lose
information. Lossless widening conversions, such as `i32` to `i64`, `i32` to `f64`,
or `u8` to `u32`, are written `into()` or `from()` and cannot fail. Narrowing
conversions, which may lose data, are written `try_into()` and are checked,
returning an `Option` or `Result` that fails when the value does not fit; this is
the default path for any conversion that could lose information. Deliberate
truncation, wrapping, or saturation is available only through explicitly named
methods such as `wrapping_to_u8()`, `saturating_to_u8()`, and `truncating_to_i32()`,
so that it is never silent or accidental.

Converting a float to an integer is always checked, since it must account for NaN,
infinity, fractional parts, and range; rounding is chosen explicitly with
`.floor()`, `.round()`, or `.trunc()`, each of which produces an integer through a
checked conversion. There is no implicit numeric coercion, as even widening is
written `into()`.

## Booleans and characters

`bool` is a JavaScript `boolean`. `char` is a Unicode scalar value, a code point in
the `u32` range, distinct from a one-character [`str`](0011-strings.md), and it crosses the JavaScript
boundary as a `string`.

## Performance

Integer arithmetic uses the bitwise-OR trick (`|0` for 32-bit, bit-shifts for
narrower widths) to enforce range at the JS level, which is zero-cost after JIT
warmup — engines recognize the pattern as a type hint and elide the operation.
Float arithmetic (`f32`/`f64`) is raw IEEE at native speed; `Finite` newtypes add
a check only at comparison or extraction, not after every operation. Operations on
`i64` and `u64` are dominated by the cost of `bigint` regardless of any wrapping,
so they are best avoided in hot paths unless 64 bits are genuinely required.

For bulk numeric work keep data in typed-array [collections](0012-collections.md),
which avoid boxing and let the engine use SIMD paths.
