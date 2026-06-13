# 0010. Documentation architecture and living-spec process

- Status: Accepted
- Date: 2026-06-12

## Context

The project needs documentation structure that keeps the normative spec, the
decisions behind it, and exploratory design notes from tangling, while staying
light for a solo, pre-code project with no users yet.

## Decision

Use a minimal, contributor-scoped structure: `specification/` is the normative
reference; `docs/adr/` records decisions; `docs/design/` holds just-in-time design
notes that graduate into the spec; `CONTRIBUTING.md` and `docs/coding-standard.md`
hold process and the coding standard; root `README`/`LICENSE` are project meta.
The spec leads and is kept in sync: an implementation-forced change produces an
ADR, a spec edit, and a changelog entry. User-facing learning docs are deferred
until the language is usable.

## Alternatives considered

- **Full Diátaxis now**: premature; the tutorial/how-to quadrants would sit empty.
- **Everything in `specification/` + ad-hoc files**: decisions and notes bleed
  into the normative spec and it rots.
- **Code-leads, spec-descriptive** / **freeze-spec, ADR-only**: lose either the
  design-first discipline or spec accuracy.

## Consequences

- A single normative source (the spec), with the _why_ in ADRs and exploration in
  design notes.
- Dual MIT/Apache-2.0 license chosen while sole authorship makes it free to set.
