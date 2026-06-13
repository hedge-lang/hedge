# Result & Option

## Two kinds of failure

Recoverable failure is a value. A function that can fail returns `Result<T, E>`,
either `Ok(T)` or `Err(E)`, so the failure is part of the return type, visible in
the signature and never a hidden exception. An absent value is instead an
`Option<T>`, either `Some(T)` or `None`, for the case where there might be nothing
here, which is not the same as an error.

Both are ordinary enums (see [Enums](0014-enums.md)); nothing about them is
special-cased except the conveniences below.

## Panics

A `panic` is for unrecoverable bugs: an index out of range, `unwrap` on `None`,
a failed assertion. It is not a control-flow tool and does not appear in
signatures. A panic compiles to a thrown JavaScript error.

Recoverable errors never panic and never throw; they are returned as `Result`.
This keeps a function's failure behavior in its type, which is the point of
error-as-value.

Panics are not caught with `match` or `?`. For isolation at a boundary, such as a
server containing a panicking request handler, a test harness, or a plugin
sandbox, `catch_unwind(|| …) -> Result<T, Panic>` runs a closure and converts a
panic into a `Result`. It is for isolation, not routine error handling.

## The `?` operator

`?` propagates failure. On `Ok`/`Some` it unwraps the value; on `Err`/`None` it
returns early from the enclosing function with the failure:

```hedge
fn load(path: &str) -> Result<Config, Error> {
  let text = read(path)?;        // returns Err early if read fails
  let cfg = parse(&text)?;
  Ok(cfg)
}
```

When propagating a `Result`, `?` converts the error with `From`, so a sub-error
folds into the function's error type without ceremony.

Because `?` is an early return, every value in scope is still dropped on the way
out (see [Drop & RAII](0007-drop-and-raii.md)); cleanup is never skipped by error
propagation.

## The Error trait

A recoverable error implements `Error`: `Display + Debug`, plus
`source() -> Option<&dyn Error>` for the cause chain. This is the contract every
error type satisfies.

## Defining errors

`#[derive(Error)]` generates `Display`, `source`, and the `From` impls that `?`
needs (driven by field annotations), so a custom error enum is low-boilerplate:

```hedge
#[derive(Error)]
enum LoadError {
  Read(IoError),      // From<IoError>; source() chains to it
  Parse(ParseError),
}
```

## Dynamic errors and context

Application code that just propagates anything uses the standard dynamic error
`AnyError`, which wraps any `Error` and carries a `.context("…")` chain:

```hedge
fn run() -> Result<(), AnyError> {
  let cfg = load("config").context("loading config")?;
  Ok(())
}
```

Libraries return precise typed errors (a `#[derive(Error)]` enum); applications
return `AnyError`. Both ship in std, so the ecosystem shares one convention
instead of reinventing it. When an error is thrown into JavaScript it becomes a
native `Error` whose `message` is its `Display` and whose `cause` is the next
link in its `source()` chain, so the chain reads as idiomatic nested JS errors.

## At the JavaScript boundary

Inside Hedge, errors are values. Across an `export "js"` boundary they take the
shape JavaScript expects:

- A returned `Result` throws its `Err` synchronously, or rejects the promise for
  an `async` function, and unwraps `Ok` to the plain value, the idiomatic
  JavaScript error handling.
- `Option` maps to the value or `null`: `Some(x)` becomes `x`, `None` becomes
  `null`.

A consumer that wants errors as values instead of exceptions can opt into the
raw discriminated-union form (`{ tag: "Ok", … } | { tag: "Err", … }`).
