export interface ConformanceRule {
  readonly id: string;
  readonly description: string;
  readonly testIds: readonly string[];
}

export const CORE_CONFORMANCE_RULES: readonly ConformanceRule[] = [
  {
    id: "PROP-WHITESPACE",
    description:
      "Extra whitespace and comments do not change the parsed AST shape",
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
    testIds: [
      "alpha-rename-preserves-diagnostics: renaming locals keeps diagnostic count",
      "alpha-rename preserves error-free status across multiple generated seeds",
    ],
  },
  {
    id: "PROP-PARENS",
    description:
      "Redundant parentheses around atoms/expressions do not change the AST",
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
    testIds: ["determinism: same source compiles to identical output twice"],
  },
  {
    id: "DIFF-INT-ARITH",
    description:
      "Compiler result matches reference evaluator for integer arithmetic",
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
    testIds: [
      "diff-if-true: if true { 1 } else { 2 } evaluates to 1",
      "diff-if-false: if false { 1 } else { 2 } evaluates to 2",
      "nested let and if expression match reference",
    ],
  },
  {
    id: "DIFF-LET",
    description: "Compiler result matches reference evaluator for let bindings",
    testIds: [
      "diff-let-binding: let binding is available in trailing expression",
    ],
  },
  {
    id: "DIFF-GENERATED",
    description:
      "Compiler result matches reference evaluator on generated programs",
    testIds: [
      "diff-generated-seed-1: generated program matches reference evaluator",
      "diff-generated-seed-2: generated program matches reference evaluator",
      "diff-generated-seed-3: generated program matches reference evaluator",
    ],
  },
  {
    id: "EXEC-ARITHMETIC",
    description: "Arithmetic expressions execute correctly end-to-end",
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
    ],
  },
  {
    id: "EXEC-COMPARISONS",
    description:
      "Comparison and logical expressions execute correctly end-to-end",
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
    testIds: [
      "executes block statements",
      "block with trailing expression",
      "let write rebinding updates the value",
      "type annotation on let binding compiles correctly",
      "compound assignment += updates a let write binding",
      "compound assignment -= updates a let write binding",
    ],
  },
  {
    id: "EXEC-STRUCTS",
    description:
      "Struct declarations and field access execute correctly end-to-end",
    testIds: [
      "struct declaration compiles alongside fn main",
      "struct literal field access evaluates correctly",
    ],
  },
  {
    id: "EXEC-LITERALS",
    description: "Literal types beyond integers execute correctly end-to-end",
    testIds: [
      "float literal prints correctly",
      "char literal prints as its character",
    ],
  },
  {
    id: "PROP-INT-SEMANTICS",
    description:
      "Integer arithmetic produces i32 truncating semantics, not JS float semantics",
    testIds: [
      "diff-div-truncate: integer division truncates toward zero",
      "diff-div-negative: negative dividend truncates toward zero not floor",
    ],
  },
  {
    id: "PROP-ALGEBRAIC-LAWS",
    description: "Integer and boolean operations satisfy algebraic invariants",
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
    testIds: [
      "rejects direct assignment to immutable let binding",
      "rejects compound assignment to immutable let binding",
      "rejects integer as boolean condition in if",
      "rejects string as boolean condition in if",
      "rejects arithmetic on boolean operands",
      "rejects equality comparison between mismatched types",
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
  "EXEC-STRUCTS",
  "EXEC-LITERALS",
  "PROP-INT-SEMANTICS",
  "PROP-ALGEBRAIC-LAWS",
  "PROP-TYPE-SAFETY",
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
    description: "Declaration output preserves visibility and docs contract",
    testIds: [
      "emits public declarations for pub fn",
      "marks pub(package) declarations as @internal",
      "includes module doc comment in declaration output",
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
    ],
  },
  {
    id: "DIAG-CODE-ID-PLAN",
    description:
      "Diagnostic code IDs are schema-validated in active conformance",
    testIds: [
      "defines a stable diagnostic code schema pattern",
      "emitted diagnostics expose a code field with schema-valid IDs",
      "all diagnostics in the core error corpus include schema-valid code ids",
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
    description:
      "Negative JS interop boundary behavior is defined as executable specs",
    testIds: [
      "rejects non-primitive boundary payloads without explicit unsafe escape hatches",
      "rejects invalid unsafe boundary usage patterns",
      "permits primitive-only safe JS interop calls",
    ],
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
  {
    id: "FUTURE-SEMANTICS-STUBS",
    description: "Future semantics activation stubs are tracked explicitly",
    testIds: [
      "executes user-defined return-value function calls once supported",
      "supports nested user-defined call chains once supported",
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
  "HARNESS-CONTRACT",
  "SOURCE-MAP-CONTRACT",
  "JS-INTEROP-NEGATIVE-SPECS",
  "DUAL-COMPILER-PARITY-SPECS",
  "FIXTURE-MANIFEST",
  "FUZZ-STABILITY",
  "PERF-GUARDRAIL",
  "SPEC-FIRST-GOVERNANCE",
  "FUTURE-SEMANTICS-STUBS",
];
