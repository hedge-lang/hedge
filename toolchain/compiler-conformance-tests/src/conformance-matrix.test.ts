import { describe, expect, it } from "vitest";

import {
  CORE_CONFORMANCE_RULES,
  CORE_REQUIRED_RULE_IDS,
  CROSS_DOMAIN_CONFORMANCE_RULES,
  CROSS_DOMAIN_REQUIRED_RULE_IDS,
} from "./conformance-index.js";

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
    for (const id of CROSS_DOMAIN_REQUIRED_RULE_IDS) {
      expect(ids.has(id), `Cross-domain rule "${id}" is missing`).toBe(true);
    }
  });

  it("only ever lists an expected-fail test ID the rule itself claims", (): void => {
    const stray = [
      ...CORE_CONFORMANCE_RULES,
      ...CROSS_DOMAIN_CONFORMANCE_RULES,
    ].flatMap((rule) =>
      (rule.expectedFailTestIds ?? [])
        .filter((id) => !rule.testIds.includes(id))
        .map((id) => `${rule.id}: "${id}"`),
    );
    expect(
      stray,
      "An expected-fail test ID must also appear in the rule's own testIds",
    ).toEqual([]);
  });

  it("keeps the T1 core fragment free of expected-fail tests", (): void => {
    const required = new Set(CORE_REQUIRED_RULE_IDS);
    const notGreen = CORE_CONFORMANCE_RULES.filter(
      (rule) =>
        required.has(rule.id) && (rule.expectedFailTestIds ?? []).length > 0,
    ).map((rule) => `${rule.id}: ${rule.expectedFailTestIds?.join(", ")}`);
    expect(
      notGreen,
      "T1 is defined as a green core fragment, so no required core rule may rest on an expected-fail test",
    ).toEqual([]);
  });
});
