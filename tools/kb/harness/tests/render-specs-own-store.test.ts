import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importsOf } from "../src/import-graph.ts";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * Every render spec runs on its own store.
 *
 * The render suite gives each test a fresh server over the seeded fixture
 * through one Playwright `test`, the one `tests-render/harness-test.ts`
 * exports; there is no shared server and no global `baseURL` for a spec to
 * lean on. A spec that takes `test` from `playwright/test` instead gets
 * neither, and fails at run time with "Cannot navigate to invalid URL" —
 * late, in the slowest lane, and only on a machine that runs it. This fails
 * it in the harness instead.
 *
 * Asserts, for every `*.e2e.ts` under the render-tests package: it imports
 * `./harness-test.ts`, and takes nothing but types from `playwright/test`.
 *
 * Red case: change a spec's import to `import { expect, test } from
 * "playwright/test"`.
 */

const RENDER_TESTS = "packages/test-support/render-tests/tests-render";
const HARNESS_TEST = /^\.\/harness-test(?:\.ts)?$/;

/** How a spec breaks the rule, or nothing when it keeps it. */
export function ownStoreViolations(file: string, source: string): string[] {
  const imports = importsOf(file, source);
  const out: string[] = [];
  if (!imports.some((i) => i.kind !== "type" && HARNESS_TEST.test(i.specifier))) {
    out.push(`${file}: does not import ./harness-test.ts`);
  }
  for (const i of imports) {
    if (i.specifier === "playwright/test" && i.kind !== "type") {
      out.push(
        `${file}: takes a value from playwright/test; take test and expect from ./harness-test.ts`,
      );
    }
  }
  return out;
}

describe("render-specs-own-store", () => {
  const specs = gitWorkspaceFiles([
    `${RENDER_TESTS}/*.e2e.ts`,
    "--others",
    "--cached",
    "--exclude-standard",
  ]);

  test("every render spec runs on the harness fixture's store", () => {
    expect(specs.length).toBeGreaterThan(5);
    const violations = specs.flatMap((spec) =>
      ownStoreViolations(spec, readFileSync(join(WORKSPACE_ROOT, spec), "utf8")),
    );
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("a spec on Playwright's own test is red; types from it are fine", () => {
    expect(
      ownStoreViolations("a.e2e.ts", 'import { expect, test } from "playwright/test";'),
    ).toEqual([
      "a.e2e.ts: does not import ./harness-test.ts",
      "a.e2e.ts: takes a value from playwright/test; take test and expect from ./harness-test.ts",
    ]);
    expect(
      ownStoreViolations(
        "b.e2e.ts",
        'import type { Page } from "playwright/test";\nimport { expect, test } from "./harness-test.ts";',
      ),
    ).toEqual([]);
  });
});
