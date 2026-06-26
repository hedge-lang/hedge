import { describe, expect, it } from "vitest";

interface ConformanceRule {
  readonly id: string;
  readonly description: string;
  readonly testIds: readonly string[];
}

const CROSS_DOMAIN_CONFORMANCE_RULES: readonly ConformanceRule[] = [
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
      "uninitialized immutable let emits a warning diagnostic",
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
      "maps generated JS locations back to Hedge source spans",
    ],
  },
];

describe("conformance matrix: cross-domain coverage", (): void => {
  it("every cross-domain conformance rule lists at least one test ID", (): void => {
    const uncovered = CROSS_DOMAIN_CONFORMANCE_RULES.filter(
      (rule) => rule.testIds.length === 0,
    );
    expect(
      uncovered.map((rule) => `${rule.id}: ${rule.description}`),
      "These cross-domain rules have no test IDs listed",
    ).toEqual([]);
  });

  it("matrix includes required cross-domain categories", (): void => {
    const ids = new Set(CROSS_DOMAIN_CONFORMANCE_RULES.map((rule) => rule.id));
    const required = [
      "CLI-BUILD",
      "CLI-UX",
      "DTS-CONFORMANCE",
      "DIAG-CONTRACT",
      "HARNESS-CONTRACT",
      "SOURCE-MAP-CONTRACT",
    ];
    for (const id of required) {
      expect(ids.has(id), `Cross-domain rule "${id}" is missing`).toBe(true);
    }
  });
});
