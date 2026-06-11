# Contributing

Hedge is in its design phase and developed solo; this is a stub that will grow
when external contribution opens up.

## Project map

- [`specification/`](specification/0000-index.md): the language specification.
- [`ROADMAP.md`](ROADMAP.md): the implementation plan.
- [`docs/adr/`](docs/adr/): architecture decisions.
- [`docs/design/`](docs/design/): just-in-time design notes.
- [`docs/coding-standard.md`](docs/coding-standard.md): the compiler coding standard (binding).

## Decisions

Architecturally-significant or spec-changing decisions are recorded as ADRs (see
[`docs/adr/README.md`](docs/adr/README.md)). A spec change also updates the
affected chapter and the [spec changelog](specification/CHANGELOG.md).

## Before writing compiler code

Read the [coding standard](docs/coding-standard.md). The compiler must stay
"Hedge-shaped TypeScript" so it ports cleanly when the language self-hosts.

## License

By contributing you agree your work is dual-licensed under MIT OR Apache-2.0, as
described in the [README](README.md).
