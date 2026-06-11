# 0004. Thin JS runtime floor; standard library in Hedge

- Status: Accepted
- Date: 2026-06-12

## Context

The compiler cannot compile a standard library written in Hedge until it is itself
capable, yet the language leans on `Option`, `Result`, `Vec`, `str`, `Iterator`,
`HashMap` everywhere. Anything written in JavaScript may have to be rewritten in
Hedge for self-hosting.

## Decision

Keep an irreducible thin floor in JavaScript: primitive type mappings, a small
trusted `extern "js"` intrinsic layer (array/string/Map/Math), the `panic` throw,
and compiler-emitted codegen glue (witnesses, `dyn`, drop disposers). Write
everything expressible in Hedge (`Option`, `Result`, iterator adapters,
`Vec`/`HashMap`/`str` methods) in Hedge, as std, the moment the compiler can
compile it.

## Alternatives considered

- **Fat JS std, Hedge-ify later**: faster early, but std is written twice and the
  JS version is never borrow-checked.
- **Pure-Hedge std from day one**: same destination, but the chicken-and-egg
  stalls the MVP.

## Consequences

- The JS surface stays minimal; std-in-Hedge is the single source of truth.
- This is the feasible path that *converges on* a pure-Hedge end state rather than a
  detour from it.
- The trusted intrinsic layer is distinct from the untrusted, primitive-only user
  `extern "js"` boundary.
