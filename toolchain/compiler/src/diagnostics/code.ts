/**
 * Every assigned diagnostic code, spelled out so a typo or a duplicate fails
 * to compile and the assigned set can be read in one place. The schema is
 * `HEDGE-<CATEGORY>-<NNN>`, pinned by `diagnostic-code-id.test.ts`.
 *
 * `Diagnostic.code` is required, so an uncoded diagnostic is unrepresentable
 * rather than merely discouraged, and this union is the whole registry.
 */
export type DiagnosticCode =
  // Lexing.
  | "HEDGE-LEX-001" // unterminated string literal
  | "HEDGE-LEX-002" // unterminated char literal
  | "HEDGE-LEX-003" // unterminated block comment
  | "HEDGE-LEX-004" // empty char literal
  | "HEDGE-LEX-005" // unexpected character
  | "HEDGE-LEX-006" // malformed numeric literal
  | "HEDGE-LEX-007" // malformed raw prefix
  | "HEDGE-LEX-008" // invalid escape sequence
  | "HEDGE-LEX-009" // scanner read past end of source (internal invariant)
  // Parsing.
  | "HEDGE-PARSE-001" // unexpected token
  | "HEDGE-PARSE-002" // unexpected end of input
  | "HEDGE-PARSE-003" // non-associative operator chained
  | "HEDGE-PARSE-004" // construct not supported in this slice
  | "HEDGE-PARSE-005" // stray extra `>`
  | "HEDGE-PARSE-006" // construct not allowed in this position
  // Name resolution.
  | "HEDGE-NAME-001" // name not found in this scope
  | "HEDGE-NAME-002" // item defined more than once
  | "HEDGE-NAME-003" // no such field
  | "HEDGE-NAME-004" // no such variant
  | "HEDGE-NAME-005" // field given more than once in one initializer
  | "HEDGE-NAME-006" // `Self` used outside a trait/impl block
  | "HEDGE-NAME-007" // `self` used in a method with no receiver
  // Typing.
  | "HEDGE-TYPE-001" // type mismatch
  | "HEDGE-TYPE-002" // operand type invalid for this operator
  | "HEDGE-TYPE-003" // operands must have the same type
  | "HEDGE-TYPE-004" // branches have incompatible types
  | "HEDGE-TYPE-005" // value out of range for its type
  | "HEDGE-TYPE-006" // type cannot be inferred
  | "HEDGE-TYPE-007" // operation invalid for this type
  | "HEDGE-TYPE-008" // construction does not match the type's shape
  | "HEDGE-TYPE-009" // struct/enum type parameter declared but never used
  | "HEDGE-TYPE-010" // generic parameter bound to conflicting types
  | "HEDGE-TYPE-011" // turbofish argument count does not match declared generics
  | "HEDGE-TYPE-012" // no method with the given name on the receiver type
  | "HEDGE-TYPE-013" // method name resolves to more than one applicable trait method
  | "HEDGE-TYPE-014" // no associated function or constant with the given name
  // Patterns.
  | "HEDGE-PATTERN-001" // refutable pattern in an irrefutable position
  | "HEDGE-PATTERN-002" // non-exhaustive match
  | "HEDGE-PATTERN-003" // unreachable pattern
  | "HEDGE-PATTERN-004" // or-pattern alternatives disagree
  | "HEDGE-PATTERN-005" // pattern shape does not match the scrutinee
  | "HEDGE-PATTERN-006" // invalid range bounds
  | "HEDGE-PATTERN-007" // binding mode not permitted here
  // Constant evaluation.
  | "HEDGE-CONST-001" // not a compile-time constant
  | "HEDGE-CONST-002" // const defined in terms of itself
  | "HEDGE-CONST-003" // arithmetic error during constant evaluation
  | "HEDGE-CONST-004" // invalid array length
  // Borrow checking and mutability.
  | "HEDGE-BORROW-CHECK-001"
  | "HEDGE-BORROW-CHECK-002"
  | "HEDGE-BORROW-CHECK-003"
  | "HEDGE-BORROW-CHECK-005" // expression is not a borrowable place
  | "HEDGE-BORROW-CHECK-006" // cannot assign through an immutable binding
  | "HEDGE-LIFETIME-001"
  | "HEDGE-LIFETIME-002"
  // Moves and drops.
  | "HEDGE-MOVE-001" // use of an uninitialized binding
  | "HEDGE-MOVE-002" // cannot move out of this place
  | "HEDGE-MOVE-003" // drop obligation is ambiguous
  | "HEDGE-MOVE-004" // value is dropped conditionally (warning)
  // Lints (warnings).
  | "HEDGE-LINT-001" // binding can never be used
  | "HEDGE-LINT-002" // generic parameter shadows an outer type of the same name
  | "HEDGE-LINT-003" // nested impl takes effect outside its own declaring scope
  | "HEDGE-LINT-004" // declaration shadows an outer one of the same name
  // Trait resolution and coherence.
  | "HEDGE-TRAIT-001" // conflicting/overlapping impls for one trait
  | "HEDGE-TRAIT-002" // required trait bound not satisfied
  | "HEDGE-TRAIT-003" // impl missing a required trait method
  | "HEDGE-TRAIT-004" // impl missing a required associated type
  | "HEDGE-TRAIT-005" // no known trait declares the named associated type
  | "HEDGE-TRAIT-006" // associated type name ambiguous between two bound traits
  | "HEDGE-TRAIT-007" // impl defines an associated type its trait doesn't declare
  | "HEDGE-TRAIT-008" // trait is not object-safe, so `dyn Trait` is rejected
  // Items and slice gating.
  | "HEDGE-ITEM-001" // item not permitted in this position
  | "HEDGE-UNSUPPORTED-001"; // construct not yet supported by the analyzer
