import { describe, expect, test } from "bun:test";
import { repositorySuppressionViolations, suppressionViolation } from "../src/suppressions.ts";

const comment = (text: string) => ["/", "/", " ", text].join("");

describe("suppression grammar", () => {
  test("accepts exactly one temporary or permanent oxlint form", () => {
    expect(
      suppressionViolation(
        comment("oxlint-disable-next-line complexity -- GAP [[01M1PHTZDZCKMXYP6HW109M3DT]]"),
      ),
    ).toBeUndefined();
    expect(
      suppressionViolation(
        comment("oxlint-disable-next-line eslint/no-console -- CLI progress output"),
      ),
    ).toBeUndefined();
    expect(
      suppressionViolation(comment("eslint-disable-next-line eslint/no-console")),
    ).toBeDefined();
    expect(suppressionViolation(comment("oxlint-disable-next-line GAP [[id]]"))).toBeDefined();
  });

  test("every TypeScript suppression uses the canonical grammar", () => {
    const violations = repositorySuppressionViolations();
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
