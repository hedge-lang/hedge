import { describe, expect, it } from "vitest";

import {
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
});
