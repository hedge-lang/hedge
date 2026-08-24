export interface ConformanceRule {
  readonly id: string;
  readonly description: string;
  readonly testIds: readonly string[];
  /**
   * Test IDs currently marked `it.fails`. Listing a rule's testId here says
   * the rule is *described* but not yet *demonstrated*, so a reader of this
   * index cannot mistake a red test for coverage. A rule in
   * {@link CORE_REQUIRED_RULE_IDS} may have none - that list is the T1 core
   * fragment, whose definition is that it is green.
   */
  readonly expectedFailTestIds?: readonly string[];
  readonly specRefs?: readonly string[];
  readonly proofRefs?: readonly string[];
}

export const CORE_CONFORMANCE_RULES: readonly ConformanceRule[] = [
  {
    id: "PROP-WHITESPACE",
    description:
      "Extra whitespace and comments do not change the parsed AST shape",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "whitespace-invariance: extra spaces/newlines do not change AST shape",
      "comment invariance: line comments between tokens do not change AST shape",
      "comment invariance: block comments do not change AST shape",
    ],
  },
  {
    id: "PROP-ALPHA-RENAME",
    description:
      "Alpha-renaming local identifiers preserves diagnostic count and severity",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "alpha-rename-preserves-diagnostics: renaming locals keeps diagnostic count",
      "alpha-rename preserves error-free status across multiple generated seeds",
    ],
  },
  {
    id: "PROP-PARENS",
    description:
      "Redundant parentheses around atoms/expressions do not change the AST",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "parens-atom-invariance: (42) and 42 parse to same AST",
      "parens-subexpr-invariance: redundant outer parens do not change AST",
      "redundant parens on int literal: ((1)) compiles same as 1",
      "parens around both sides of addition do not change compiled output",
    ],
  },
  {
    id: "PROP-DETERMINISM",
    description: "Compiling the same source twice produces identical output",
    specRefs: ["0002-execution-model.md"],
    testIds: ["determinism: same source compiles to identical output twice"],
  },
  {
    id: "DIFF-INT-ARITH",
    description:
      "Compiler result matches reference evaluator for integer arithmetic",
    specRefs: [
      "0008-expressions-and-control-flow.md",
      "0010-primitive-types.md",
    ],
    testIds: [
      "diff-literal: integer literal compiles and matches reference",
      "diff-add: addition compiles and matches reference",
      "diff-sub: subtraction compiles and matches reference",
      "diff-mul: multiplication compiles and matches reference",
      "chained arithmetic matches reference",
    ],
  },
  {
    id: "DIFF-CMP",
    description:
      "Compiler result matches reference evaluator for comparison expressions",
    specRefs: [
      "0008-expressions-and-control-flow.md",
      "0010-primitive-types.md",
    ],
    testIds: [
      "diff-eq: equality comparison compiles and matches reference",
      "diff-lt: less-than comparison compiles and matches reference",
      "diff-gt: greater-than comparison compiles and matches reference",
      "diff-ne: not-equal comparison compiles and matches reference",
      "diff-le: less-than-or-equal comparison compiles and matches reference",
      "diff-ge: greater-than-or-equal comparison compiles and matches reference",
      "diff-and: logical and compiles and matches reference",
      "diff-or: logical or compiles and matches reference",
      "diff-rem: remainder compiles and matches reference",
    ],
  },
  {
    id: "DIFF-IF",
    description:
      "Compiler result matches reference evaluator for if-else expressions",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "diff-if-true: if true { 1 } else { 2 } evaluates to 1",
      "diff-if-false: if false { 1 } else { 2 } evaluates to 2",
      "nested let and if expression match reference",
    ],
  },
  {
    id: "DIFF-LET",
    description: "Compiler result matches reference evaluator for let bindings",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "diff-let-binding: let binding is available in trailing expression",
    ],
  },
  {
    id: "DIFF-GENERATED",
    description:
      "Compiler result matches reference evaluator on generated programs",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "diff-generated-seed-1: generated program matches reference evaluator",
      "diff-generated-seed-2: generated program matches reference evaluator",
      "diff-generated-seed-3: generated program matches reference evaluator",
    ],
  },
  {
    id: "EXEC-ARITHMETIC",
    description: "Arithmetic expressions execute correctly end-to-end",
    specRefs: [
      "0008-expressions-and-control-flow.md",
      "0010-primitive-types.md",
    ],
    testIds: [
      "evaluates 1 + 2 correctly",
      "respects operator precedence",
      "handles subtraction",
      "handles multiplication",
      "handles division",
      "handles modulo",
      "handles unary negation",
      "bitwise AND",
      "bitwise OR",
      "bitwise XOR",
      "shift left",
      "shift right",
      "arithmetic right shift is signed (sign-extending)",
      "double negation of integers returns original value",
    ],
  },
  {
    id: "EXEC-COMPARISONS",
    description:
      "Comparison and logical expressions execute correctly end-to-end",
    specRefs: [
      "0008-expressions-and-control-flow.md",
      "0010-primitive-types.md",
    ],
    testIds: [
      "evaluates == correctly",
      "evaluates < correctly",
      "evaluates > correctly",
      "evaluates != correctly",
      "evaluates <= correctly",
      "evaluates >= correctly",
      "evaluates && correctly",
      "evaluates || correctly",
    ],
  },
  {
    id: "EXEC-CONTROL-FLOW",
    description: "Control flow constructs execute correctly end-to-end",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "executes if-true branch",
      "skips if-false branch",
      "executes if-else correctly",
      "chains else-if correctly",
      "if expression as let initializer",
    ],
  },
  {
    id: "EXEC-BINDINGS",
    description: "Let bindings and block scoping execute correctly end-to-end",
    specRefs: ["0008-expressions-and-control-flow.md", "0004-mutability.md"],
    testIds: [
      "executes block statements",
      "block with trailing expression",
      "let mut rebinding updates the value",
      "type annotation on let binding compiles correctly",
      "compound assignment += updates a let mut binding",
      "compound assignment -= updates a let mut binding",
      "multiple assignments to let mut binding update sequentially",
      "wildcard let evaluates its initializer for its side effect",
    ],
  },
  {
    id: "EXEC-BLOCKS",
    description:
      "Block grammar: empty statements, local item declarations, nested blocks, and block-as-expression execute correctly end-to-end",
    specRefs: ["0008-expressions-and-control-flow.md", "0025-grammar.md"],
    testIds: [
      "empty block returns unit",
      "block with only empty statements returns unit",
      "nested blocks evaluate innermost trailing expression",
      "local fn declaration inside block is callable",
      "local struct declaration inside block is usable",
      "let without initializer parses cleanly",
    ],
  },
  {
    id: "EXEC-RANGES",
    description:
      "Range-expression literals compile clean end-to-end. Range<T>/RangeInclusive<T>/iterator semantics are not yet implemented (Slice 5); this rule only covers construction, not use.",
    specRefs: ["0025-grammar.md"],
    testIds: [
      "range expression as a let initializer compiles clean",
      "bare range (RangeFull) as a let initializer compiles clean",
    ],
  },
  {
    id: "EXEC-STRUCTS",
    description:
      "Struct declarations and field access execute correctly end-to-end",
    specRefs: ["0013-structs.md"],
    testIds: [
      "struct declaration compiles alongside fn main",
      "struct literal field access evaluates correctly",
      "struct declared after use resolves correctly",
      "fn, struct, i32/bool, let/let mut, arithmetic, calls, if/else, and blocks execute together",
    ],
  },
  {
    id: "EXEC-CONST-STATIC",
    description:
      "const/static item declarations execute correctly end-to-end: uses a const's folded value in runtime arithmetic and can chain to another const, a static initializes lazily and exactly once on first access (not eagerly at module load), a static can reference a const, and a [T; N]/[value; N] array whose length/count is a const resolves and runs correctly",
    specRefs: ["0008-expressions-and-control-flow.md", "0012-collections.md"],
    testIds: [
      "uses a const's folded value in runtime arithmetic",
      "chains a const reference to another const correctly at runtime",
      "initializes a static lazily, exactly once, on first access",
      "runs a static's initializer on first access, not eagerly at module load",
      "resolves a static referencing a const in its initializer",
      "executes an array whose [T; N] length is const-resolved",
      "executes a repeat-form array whose count is const-resolved",
      "accepts a const-evaluated array length, not just a literal integer",
    ],
  },
  {
    id: "EXEC-FUNCTIONS",
    description:
      "User-defined functions with non-unit return types return their trailing expression's value, including tail-position if/else chains, end-to-end",
    specRefs: [
      "0009-functions-and-closures.md",
      "0008-expressions-and-control-flow.md",
    ],
    testIds: [
      "function trailing expression returns a value",
      "if/else trailing expression returns a value",
      "else-if chain trailing expression returns from every branch",
      "nested user-defined function calls use real return values",
      "calling a top-level function declared later in the file (forward reference)",
      "a unit-returning function's trailing expression is still discarded",
      "returns the correct value at the i32 boundary",
      "a function's return value composes directly into another call's argument",
    ],
  },
  {
    id: "EXEC-LITERALS",
    description: "Literal types beyond integers execute correctly end-to-end",
    specRefs: ["0010-primitive-types.md"],
    testIds: [
      "float literal prints correctly",
      "char literal prints as its character",
      "two unit values compare equal under ==",
      "two unit values compare unequal as false under !=",
      "a unit value from a unit-returning function call compares equal to a unit literal",
    ],
  },
  {
    id: "PROP-INT-SEMANTICS",
    description:
      "Integer arithmetic produces i32 truncating semantics, not JS float semantics",
    specRefs: [
      "0010-primitive-types.md",
      "0008-expressions-and-control-flow.md",
    ],
    testIds: [
      "diff-div-truncate: integer division truncates toward zero",
      "diff-div-negative: negative dividend truncates toward zero not floor",
      "diff-div-zero: division by zero throws runtime error",
    ],
  },
  {
    id: "PROP-ALGEBRAIC-LAWS",
    description: "Integer and boolean operations satisfy algebraic invariants",
    specRefs: [
      "0008-expressions-and-control-flow.md",
      "0010-primitive-types.md",
    ],
    testIds: [
      "prop-add-commutative: a + b = b + a for integer constants",
      "prop-mul-commutative: a * b = b * a",
      "prop-add-identity: a + 0 = a",
      "prop-mul-identity: a * 1 = a",
      "prop-mul-zero: a * 0 = 0",
      "prop-demorgan-and: !(a && b) == (!a || !b)",
      "prop-demorgan-or: !(a || b) == (!a && !b)",
      "prop-double-neg-bool: !!a = a for booleans",
      "prop-comparison-antisymmetric: (a < b) == !(a >= b)",
      "prop-comparison-reflexive: a == a",
    ],
  },
  {
    id: "PROP-TYPE-SAFETY",
    description: "Type system rejects ill-typed programs without coercion",
    specRefs: [
      "0010-primitive-types.md",
      "0008-expressions-and-control-flow.md",
    ],
    testIds: [
      "rejects comparisons with right-side boolean",
      "rejects comparisons with left-side boolean",
      "rejects direct assignment to immutable let binding",
      "rejects compound assignment to immutable let binding",
      "rejects integer as boolean condition in if",
      "rejects string as boolean condition in if",
      "rejects arithmetic on boolean operands",
      "rejects equality comparison between mismatched types",
      "rejects let binding type annotation mismatch: integer vs bool annotation",
      "rejects float assigned to i32-annotated binding",
      "rejects function return type mismatch",
      "rejects arithmetic on a genuinely unit-typed operand",
      "rejects a non-unit return type with no trailing expression",
    ],
  },
  {
    id: "EXEC-PRECEDENCE",
    description:
      "Binary and unary operator precedence matches Rust semantics end-to-end",
    specRefs: ["0008-expressions-and-control-flow.md"],
    testIds: [
      "logical-and binds tighter than logical-or",
      "comparison binds tighter than logical-and",
      "arithmetic binds tighter than comparison",
      "unary minus binds tighter than addition",
      "unary not binds tighter than logical-and",
      "bitwise-and binds tighter than equality (Rust semantics)",
      "bitwise-or binds tighter than equality (Rust semantics)",
      "bitwise-xor binds tighter than bitwise-or",
      "bitwise-and binds tighter than bitwise-xor",
    ],
  },
  {
    id: "EXEC-INT-SAFETY",
    description:
      "Integer division traps on zero and addition wraps on overflow rather than producing floats",
    specRefs: ["0010-primitive-types.md"],
    testIds: [
      "integer division by zero causes runtime error, not Infinity",
      "i32 addition wraps on overflow (two's complement)",
    ],
  },
  {
    id: "PROP-STRING-SAFETY",
    description:
      "String type is not implicitly coerced in arithmetic or cross-type comparisons",
    specRefs: ["0011-strings.md", "0010-primitive-types.md"],
    testIds: [
      "rejects string operand in arithmetic expression",
      "rejects string-to-string addition",
      "rejects string in cross-type equality comparison",
    ],
  },
  {
    id: "PROP-STRUCT-SAFETY",
    description:
      "Struct literal initialization and field access are validated against the struct declaration",
    specRefs: ["0013-structs.md"],
    testIds: [
      "rejects struct literal with missing required field",
      "rejects struct literal with unknown field",
      "rejects access to undefined struct field",
      "rejects field access on non-struct type",
      "does not cascade errors from unresolved struct name",
      "rejects field access on resolved primitive field type",
      "rejects struct literal with simultaneous unknown and missing fields",
      "rejects fields in unit struct literal",
      "rejects field access using another struct's field name",
      "rejects duplicate field in struct literal",
      "rejects duplicate struct declaration",
      "rejects struct field value type mismatch (bool vs i32)",
    ],
  },
];

export const CORE_REQUIRED_RULE_IDS: readonly string[] = [
  "PROP-WHITESPACE",
  "PROP-ALPHA-RENAME",
  "PROP-PARENS",
  "PROP-DETERMINISM",
  "DIFF-INT-ARITH",
  "DIFF-CMP",
  "DIFF-IF",
  "DIFF-LET",
  "DIFF-GENERATED",
  "EXEC-ARITHMETIC",
  "EXEC-COMPARISONS",
  "EXEC-CONTROL-FLOW",
  "EXEC-BINDINGS",
  "EXEC-BLOCKS",
  "EXEC-STRUCTS",
  "EXEC-FUNCTIONS",
  "EXEC-LITERALS",
  "PROP-INT-SEMANTICS",
  "PROP-ALGEBRAIC-LAWS",
  "PROP-TYPE-SAFETY",
  "EXEC-PRECEDENCE",
  "EXEC-INT-SAFETY",
  "PROP-STRING-SAFETY",
  "PROP-STRUCT-SAFETY",
];

export const CROSS_DOMAIN_CONFORMANCE_RULES: readonly ConformanceRule[] = [
  {
    id: "CLI-BUILD",
    description: "CLI build command succeeds/fails with expected exit behavior",
    testIds: [
      "build writes .js and .d.ts for valid source",
      "build returns non-zero and emits diagnostics for invalid source",
      "build missing file exits non-zero and reports path failure",
    ],
  },
  {
    id: "CLI-UX",
    description: "CLI help/version/unknown-command UX remains stable",
    testIds: [
      "help prints usage and exits zero",
      "version prints semantic version and exits zero",
      "unknown command falls back to help",
    ],
  },
  {
    id: "CLI-DETERMINISM",
    description: "CLI build output remains byte-identical across repeated runs",
    testIds: ["build output is deterministic across repeated runs"],
  },
  {
    id: "DTS-CONFORMANCE",
    expectedFailTestIds: ["pub struct emits a typedef declaration"],
    description: "Declaration output preserves visibility and docs contract",
    testIds: [
      "emits public declarations for pub fn",
      "marks pub(package) declarations as @internal",
      "includes module doc comment in declaration output",
      "pub struct emits a typedef declaration",
    ],
  },
  {
    id: "DIAG-CONTRACT",
    description: "Diagnostics preserve span precision and non-cascade behavior",
    testIds: [
      "unresolved-name span points at the unresolved identifier text",
      "single unresolved name does not cascade into many errors",
      "parse failure emits at least one error diagnostic and no code",
      "parser emits warning for uninitialized immutable let",
      "diagnostic count and primary message are deterministic across runs",
      "single unresolved identifier reused twice remains bounded in diagnostics",
      "parse diagnostics remain actionable with expectation hints",
    ],
  },
  {
    id: "DIAG-CODE-ID-PLAN",
    description:
      "Diagnostic code IDs are schema-validated in active conformance",
    testIds: [
      "defines a stable diagnostic code schema pattern",
      "exposes a schema-valid code on an emitted diagnostic",
      "codes every diagnostic in the core error corpus with a schema-valid id",
      "every borrow and lifetime error category in the corpus carries a schema-valid, stable code",
    ],
  },
  {
    id: "DIAG-CODE-BORROW-LIFETIME",
    description:
      "Every borrow/lifetime error category has a stable, schema-valid diagnostic code",
    testIds: [
      "every borrow and lifetime error category in the corpus carries a schema-valid, stable code",
    ],
  },
  {
    id: "DIAGNOSTICS-QUALITY",
    description:
      "Diagnostics quality contracts cover determinism, bounded cascade, and actionable parse errors",
    testIds: [
      "diagnostic count and primary message are deterministic across runs",
      "single unresolved identifier reused twice remains bounded in diagnostics",
      "parse diagnostics remain actionable with expectation hints",
    ],
  },
  {
    id: "HARNESS-CONTRACT",
    description: "Conformance harness behavior remains deterministic",
    testIds: [
      "executes shebang-prefixed programs produced from fn main()",
      "serializes non-string printed values predictably",
    ],
  },
  {
    id: "SOURCE-MAP-CONTRACT",
    description:
      "Source-map behavior is specified by active conformance assertions",
    testIds: [
      "compile output exposes source-map artifacts with mapping table",
      "fixtures compile to JS snippets that have covering source-map mappings",
      "maps generated JS locations back to Hedge source spans",
    ],
  },
  {
    id: "JS-INTEROP-NEGATIVE-SPECS",
    expectedFailTestIds: [
      "rejects non-primitive boundary payloads without explicit unsafe escape hatches",
      "rejects invalid unsafe boundary usage patterns",
      "permits primitive-only safe JS interop calls",
      "generated JS export includes runtime guard checks",
    ],
    description:
      "Negative JS interop boundary behavior is defined as executable specs",
    testIds: [
      "rejects non-primitive boundary payloads without explicit unsafe escape hatches",
      "rejects invalid unsafe boundary usage patterns",
      "permits primitive-only safe JS interop calls",
      "rejects crossing shared references over JS boundary",
      "rejects crossing mutable references over JS boundary",
      "generated JS export includes runtime guard checks",
    ],
  },
  {
    id: "MOVE-SEMANTICS",
    description:
      "Move semantics enforce ownership transfer and moved-value invalidation",
    testIds: [
      "copy types remain usable after assignment",
      "moved struct binding is unusable after move",
      "moving the same owned value twice is rejected",
      "move in one branch invalidates use after merge",
      "passing owned value by value consumes it",
      "using an uninitialized binding is rejected",
      "loop-carried move requires explicit reinitialization",
      "rejects reading moved struct value",
      "rejects double move of the same owned binding",
      "a let mut struct binding reassigned after a move still runs (deferred: not scope-end dropped until Slice 2)",
      "a Copy-typed value duplicated on only one branch is still usable after the merge",
    ],
  },
  {
    id: "NLL-CORRECTNESS",
    expectedFailTestIds: [
      "assigns the receiver's lifetime to the returned reference for self-receiver elision",
    ],
    description:
      "Non-lexical lifetime behavior is captured as executable borrow contracts",
    testIds: [
      "sequential mutable borrows are accepted after last use",
      "last-use ends shared borrow before later mutable borrow",
      "branch-local borrow release allows use after join",
      "loop-scoped mutable borrow can be recreated each iteration",
      "overlapping mutable and shared borrow is rejected",
      "rejects ambiguous two-parameter elision",
      "fills an elided return type from the sole reference parameter",
      "resolves what elision alone cannot, given explicit lifetime annotations",
      "parses a struct's own lifetime parameter and stores it on its reference field",
      "assigns the receiver's lifetime to the returned reference for self-receiver elision",
      "rejects passing a dereferenced non-Copy value by value out of a reference",
      "mutating a primitive through &mut is observable by the original binding after the borrow ends",
      "replacing a whole struct through &mut is observable by the original binding after the borrow ends",
      "mutating a struct field through &mut is observable by the original binding after the borrow ends",
      "mutating a &mut function parameter is observable by the caller across the call boundary",
      "reading a struct field through &mut reflects a prior mutation made through the same reference",
    ],
  },
  {
    id: "DROP-DETERMINISM",
    expectedFailTestIds: [
      "drop cannot occur while mutable borrow is live",
      "early drop occurs at last use instead of lexical scope end",
    ],
    description:
      "Deterministic cleanup contracts and Symbol.dispose wiring are specified",
    testIds: [
      "generated JS emits Symbol.dispose wiring for owned cleanup paths",
      "drop order for distinct owned bindings is reverse declaration order",
      "resolves a binding moved on only one branch by dropping it in the other branch, not with a runtime flag",
      "resolves a binding moved on only the else branch by dropping it in then, the symmetric case",
      "emits no drop of any kind for a binding moved on every branch",
      "resolves a value moved partway down an else-if chain to two static drop sites, not a flag",
      "resolves two independent bindings each conditionally moved in separate if/else pairs without interference",
      "resolves a conditional move inside a nested block within a branch at the enclosing if's merge",
      "synthesizes an else branch to carry the drop when a conditional move has no source else at all",
      "places a branch-attributed drop before the return in a function with a declared return type",
      "attributes a drop to a conditionally moved parameter via its own shadow, not dropParamShadows's unconditional one",
      "a branch-attributed drop coexists with an unconditional using drop in the same scope without disturbing either",
      "drops a branch-attributed binding in correct reverse-declaration-order against a using local declared inside the same branch",
      "resolves a conditional move nested inside a confined (value-position) trailing if via static duplication, not a flag",
      "drop cannot occur while mutable borrow is live",
      "early drop occurs at last use instead of lexical scope end",
    ],
  },
  {
    id: "TYPE-SYSTEM-SOUNDNESS",
    description:
      "Type inference, narrowing, and rejection behavior are encoded as soundness contracts",
    testIds: [
      "type inference succeeds for simple let bindings",
      "mismatched branch result types are rejected",
      "struct field initialization enforces declared field types",
      "arithmetic does not silently coerce bool to integer",
      "function return type mismatch is rejected",
    ],
  },
  {
    id: "SELF-TYPE-SCOPE",
    description:
      "`Self` in type position resolves against its enclosing trait/impl, and is rejected (no cascade) outside one",
    specRefs: ["0015-generics-and-traits.md", "0025-grammar.md"],
    testIds: [
      "rejects `Self` as a return type used outside any trait or impl",
      "rejects `Self` as a parameter type used outside any trait or impl",
      "rejects `&Self` used outside any trait or impl",
      "does not cascade a second diagnostic when `Self` is rejected outside a trait or impl",
      "resolves `Self` to the enclosing impl's own type and compiles cleanly",
      "resolves `Self::Item` to the trait's own associated type and compiles cleanly",
    ],
    expectedFailTestIds: [
      "resolves `Self` to the enclosing impl's own type and compiles cleanly",
      "resolves `Self::Item` to the trait's own associated type and compiles cleanly",
    ],
  },
  {
    id: "GENERIC-PARAM-TYPE-POSITION",
    description:
      "A declared generic parameter resolves as a valid type in its own signature/field positions, distinct from an unresolved name",
    specRefs: ["0015-generics-and-traits.md", "0025-grammar.md"],
    testIds: [
      "resolves a generic function's own type parameter used as a parameter type",
      "still rejects a name that matches no declared generic parameter as unsupported",
      "compiles cleanly when only one of several declared type parameters is used",
      "resolves a generic function's own type parameter used as a return type",
      "rejects a return type that names a different declared type parameter than the argument",
      "compiles cleanly when a nested function's own generic parameter accepts an enclosing function's same-spelled one",
      "compiles cleanly when a sibling function's own generic parameter accepts another function's same-spelled one",
      "resolves a shared reference to a generic type parameter as a parameter type",
      "resolves a mutable reference to a generic type parameter as a parameter type",
      "resolves a shared reference to a generic type parameter as a return type",
      "resolves a mutable reference to a generic type parameter as a return type",
      "coexists with an explicit lifetime parameter declared alongside the type parameter",
      "resolves a two-hop reference to a generic type parameter",
      "still rejects an undeclared name under a reference to it",
      "resolves a struct's own type parameter used as a field type",
      "resolves an enum's own type parameter used in a tuple variant",
      "resolves an enum's own type parameter used in a named-fields variant",
      "does not cascade a second diagnostic when only one of a struct's fields uses an undeclared name",
      "does not let one generic struct's type parameter leak into an unrelated sibling struct",
      "does not let an enclosing generic function's type parameter leak into a struct declared inside its body",
      "does not let an enclosing generic function's type parameter leak into a local const's declared type",
      "still rejects a generic type parameter used as a fixed-size array's element type",
      "still rejects a generic type parameter used as an array element type behind a reference",
      "still rejects an undeclared name that is not a primitive, struct, or enum, with no generics involved at all",
      "resolves a type parameter carrying an inline trait bound, even though the bound itself is not checked yet",
      "resolves a type parameter whose name collides with a primitive type's name",
      "rejects a generic type parameter used with a type-argument list, since a bare type parameter takes none",
    ],
    expectedFailTestIds: [
      "still rejects a generic type parameter used as a fixed-size array's element type",
      "still rejects a generic type parameter used as an array element type behind a reference",
    ],
  },
  {
    id: "GENERIC-PARAM-UNUSED",
    description:
      "A struct or enum's own declared type parameter must appear in at least one field/variant, matching Rust's E0392; a function's own type parameter is exempt",
    specRefs: ["0015-generics-and-traits.md"],
    testIds: [
      "rejects a struct's own type parameter that appears in none of its fields",
      "reports each unused type parameter separately",
      "does not reject a type parameter used more than once",
      "rejects an enum's own type parameter that appears in none of its variants",
      "does not reject a type parameter used only as an array element type",
      "rejects a type parameter used only in a trait bound, since a bound alone does not count as usage",
    ],
  },
  {
    id: "GENERIC-CALL-INFERENCE",
    description:
      "A generic call's type parameters are unified from its arguments, an expected return type, or an explicit turbofish, with a conflicting or unsolved variable reported as a diagnostic",
    specRefs: ["0015-generics-and-traits.md"],
    testIds: [
      "infers a generic parameter from a single argument, with no annotation",
      "infers a generic parameter through a single reference-hop argument",
      "infers two independent generic parameters from two arguments in one call",
      "infers a repeated generic parameter consistently across two occurrences",
      "leaves an ordinary non-generic call unaffected",
      "infers a generic call nested inside another generic function's own body",
      "infers a composed generic call passed as another generic call's argument",
    ],
  },
  {
    id: "SKIP-BUDGET-GOVERNANCE",
    description:
      "Skip and skipIf usage remains within explicit conformance governance budget",
    testIds: ["total skip and skipIf count stays within explicit budget"],
  },
  {
    id: "DUAL-COMPILER-PARITY-SPECS",
    description:
      "Dual-compiler parity assertions are active once harness prerequisites are configured",
    testIds: [
      "compares bootstrap and self-hosted compiler outputs on shared corpus",
      "compares bootstrap and self-hosted compiler diagnostics parity",
    ],
  },
  {
    id: "FIXTURE-MANIFEST",
    description:
      "Fixture corpus and seed/version pinning is explicit and stable",
    testIds: [
      "pins fixture manifest version",
      "has stable fuzz seed/count and key lengths",
      "has stable source-map activation fixture ids",
    ],
  },
  {
    id: "FUZZ-STABILITY",
    description: "Parser and lexer are stable across seeded fuzz inputs",
    testIds: [
      "seeded fuzz inputs do not throw in tokenize/parse/compile pipeline",
      "diagnostic severity signature is deterministic for fixed seeded inputs",
    ],
  },
  {
    id: "PERF-GUARDRAIL",
    description: "Compile performance stays within coarse guardrail thresholds",
    testIds: [
      "pins performance baseline thresholds for explicit rebaseline review",
      "single corpus pass remains under a coarse budget",
      "repeated corpus compilation stays within regression guardrail budget",
    ],
  },
  {
    id: "SPEC-FIRST-GOVERNANCE",
    description:
      "Spec-first test suites avoid long-lived skips and keep harness-boundary skips explicit",
    testIds: [
      "source-map, diagnostic-code-id, and JS-interop suites avoid long-lived it.skip placeholders",
      "dual-compiler parity keeps skip guards only at the harness boundary",
    ],
  },
];

export const CROSS_DOMAIN_REQUIRED_RULE_IDS: readonly string[] = [
  "CLI-BUILD",
  "CLI-UX",
  "CLI-DETERMINISM",
  "DTS-CONFORMANCE",
  "DIAG-CONTRACT",
  "DIAG-CODE-ID-PLAN",
  "DIAGNOSTICS-QUALITY",
  "HARNESS-CONTRACT",
  "SOURCE-MAP-CONTRACT",
  "JS-INTEROP-NEGATIVE-SPECS",
  "MOVE-SEMANTICS",
  "NLL-CORRECTNESS",
  "DROP-DETERMINISM",
  "TYPE-SYSTEM-SOUNDNESS",
  "SKIP-BUDGET-GOVERNANCE",
  "DUAL-COMPILER-PARITY-SPECS",
  "FIXTURE-MANIFEST",
  "FUZZ-STABILITY",
  "PERF-GUARDRAIL",
  "SPEC-FIRST-GOVERNANCE",
  "DIAG-CODE-BORROW-LIFETIME",
];
