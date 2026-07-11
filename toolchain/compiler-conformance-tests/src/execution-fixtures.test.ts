import { describe, expect, it } from "vitest";

import {
  discoverExecutionFixtures,
  readExecutionExpectation,
  runExecutionFixture,
} from "./fixture-harness.js";

describe("execution fixtures", (): void => {
  const fixtures = discoverExecutionFixtures();

  it("has at least 3 execution fixtures", (): void => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  it.each(fixtures)(
    "runs $name to expected stdout/exit code",
    (fixture): void => {
      const expected = readExecutionExpectation(fixture.expectedPath);
      const actual = runExecutionFixture(fixture);
      expect(actual).toEqual(expected);
    },
  );
});
