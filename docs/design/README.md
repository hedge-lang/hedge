# Design notes

Design notes are *just-in-time* working documents. A note is written when its
slice (see [`ROADMAP.md`](../../ROADMAP.md)) is reached, never before, to avoid
specifying ahead of implementation. The design is worked out here against real
code; once it settles, the normative content **graduates into the
[specification](../../specification/0000-index.md)** (with an ADR recording the
decision), and the note remains as the worked-out explanation.

The public contract belongs in the spec; an internal representation that is free
to change (for example, the exact shape of a witness object) may stay a design
note.

## Pending notes (write when the slice needs them)

| Note                                                     | Needed by                   | Status      |
|----------------------------------------------------------|-----------------------------|-------------|
| Diagnostics model and renderer                           | before Slice 1              | Not started |
| Witness / `dyn Trait` / closure runtime ABI              | Slice 4 (generics & traits) | Not started |
| Operator → trait mapping table                           | Slice 5–6                   | Not started |
| Coercions list (deref, closure→`fn`, lifetime subtyping) | as encountered              | Not started |
| Name resolution algorithm                                | Slice 7 (modules)           | Not started |
| `unsafe` / `unchecked` semantics and undefined behavior  | Slice 9 (interop)           | Not started |
