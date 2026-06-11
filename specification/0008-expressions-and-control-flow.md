# Expressions & Control Flow

Hedge is expression-oriented: most constructs evaluate to a value.

## Blocks

A block, `{ … }`, is an expression whose value is its trailing expression, the one
written without a `;`:

```hedge
let x = { let a = f(); a + 1 };   // x == f() + 1
```

A `;` turns an expression into a statement, discarding its value and yielding unit
`()`. `let` bindings and item declarations such as `fn` and `struct` are
statements. Semicolons are explicit; Hedge has no automatic semicolon insertion. A
function's trailing expression is its return value, and `return` is reserved for
early return.

## Constants and statics

A `const` is a compile-time constant, evaluated during compilation and inlined at
each use with no runtime storage:

```hedge
const MAX: i32 = 100;
```

A `static` is a single module-level instance whose initializer runs at runtime. It
is lazily initialized on first access, which avoids the ES-module init-order and
circular-import hazards, and it is immutable: ambient mutable global state is what
ownership exists to prevent, so there is no `static write` (a mutable global would
ride on deferred interior mutability).

```hedge
static TABLE: Lookup = build_table();   // runs once, on first use
```

Module-level declarations are `const` or `static`, and `let` is function-local. A
`const fn` may be evaluated at compile time and used in const contexts, including
fixed-array lengths. Const evaluation covers primitive arithmetic, `const fn`
calls, and const construction, which is a bounded subset rather than arbitrary
code.

## if and match

`if`/`else` and `match` are expressions. `if` serves as the conditional
expression, so there is no separate ternary:

```hedge
let sign = if n < 0 { -1 } else { 1 };
let label = match kind { Kind::A => "a", Kind::B => "b" };
```

## Loops

`loop` runs until a `break` and yields a value through `break value`:

```hedge
let x = loop { let n = next(); if done(n) { break n; } };
```

`while` and `for x in iterable` yield `()`, because they may run their body zero
times and so have no value to return. To produce a value from such a loop, carry a
result in a binding, use `loop` with `break`, or reduce the sequence with an
iterator combinator (see [Iterators](0017-iterators.md)). There is no C-style
`for(init; cond; update)`; iterate with `for x in iterable` or over a range.

A loop may carry a label, written `'name:` before `loop`, `while`, or `for`. A
`break` or `continue` may then name a label to act on an enclosing loop instead
of the innermost one. A labeled `break` may also carry a value, which becomes the
result of the loop it names; because only `loop` yields a value, a value-carrying
break must target a `loop`, while a valueless `break 'name` or `continue 'name`
may target any enclosing loop.

## The never type

`!` is the type of an expression that never produces a value: `panic(...)`,
`return`, `break`, `continue`, an infinite `loop {}`, and a call to a function
declared `-> !`. It coerces to any type, which is what lets a diverging branch
stand beside a value-producing one:

```hedge
let x = if ok { compute() } else { panic("no") };   // x is compute()'s type
let v = match opt { Some(v) => v, None => return Err(e) };
```

`?` depends on this, since its failure path is a `!`-typed early return and
`thing()?` therefore type-checks as the unwrapped success value. A function that
never returns is written `-> !`. The type has no runtime representation; a
`!`-typed expression lowers to a `throw`, `return`, `break`, or infinite loop.

## Generated code

JavaScript's `if`, `switch`, and `for` are statements, so an expression-position
construct lowers accordingly: a simple `if`-expression becomes a ternary, and a
block or `match` expression that contains statements becomes a hoisted temporary or
an immediately-invoked function. The surface stays expression-oriented while the
emitted code is ordinary statement-based JavaScript. Block temporaries are dropped
at the end of the block, after its value has been moved out.