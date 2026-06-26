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
      "borrow-expression rejection includes a concrete source span",
      "parse failure emits at least one error diagnostic and no code",
      "parser emits warning for uninitialized immutable let",
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
    description: "Source-map status is explicitly tracked in conformance tests",
    testIds: [
      "documents current contract: compile output does not expose source map artifacts yet",
      "defines activation fixtures for future round-trip validation",
      "maps generated JS locations back to Hedge source spans",
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
      "single corpus pass remains under a coarse budget",
      "repeated corpus compilation stays within regression guardrail budget",
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
  "HARNESS-CONTRACT",
  "SOURCE-MAP-CONTRACT",
  "FUZZ-STABILITY",
  "PERF-GUARDRAIL",
  "FUTURE-SEMANTICS-STUBS",
];
