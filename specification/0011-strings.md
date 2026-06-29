# Strings

A string is a single type, `str`: an immutable, `Copy`, JavaScript-`string`
primitive that is held, passed, returned, and copied by value freely. Because a
JavaScript string is a sized, immutable reference, the unsized-`str` problem that
forces a `String`/`&str`/`str` split in other languages does not arise, and there
is one string type. A read borrow `&str` is the bare string and is rarely needed,
since `str` is `Copy`. A write borrow `&mut str` uses the mutable-primitive
boxing, `{ v: string }`, so writing through it replaces the whole string, which is
what mutating an immutable string means; there is no in-place editing. A string is
not integer-indexed as characters, because byte and code-unit indexing is a
footgun, so iterate `.chars()` or `.bytes()` instead. Efficient construction uses a
`StringBuilder`, backed by joined chunks or a byte buffer, which produces a `str`;
building with `s = s + chunk` in a loop is O(n²) and is not the way to build a
large string.

## Interpolation

A string literal may interpolate expressions, as in `"Hello, ${name}"`: each
`${expr}` is spliced into the string and the literal lowers to a JavaScript
template literal. An interpolated expression must implement `Display`, the
standard formatting trait, so interpolation also serves as the formatting
mechanism. A literal `${` is written `\${`, and a raw string (`r"…"`) does not
interpolate.
