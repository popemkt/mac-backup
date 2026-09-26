import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { importsOf } from "../src/import-graph.ts";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

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
 * Asserts, for every file the runner collects — its own `testDir` and
 * `testMatch`, read from playwright.config.ts as data (the harness imports
 * no product code), so a nested spec is read exactly when it runs — that it imports harness-test.ts (by any relative
 * path) and takes nothing but types from `playwright/test`.
 *
 * Red case: change a spec's import to `import { expect, test } from
 * "playwright/test"`.
 */

const RENDER_TESTS_ROOT = join(WORKSPACE_ROOT, "packages/test-support/render-tests");
/** Any relative specifier whose last segment is harness-test(.ts). */
const HARNESS_TEST = /^\.\.?\/(?:[^'"]*\/)?harness-test(?:\.ts)?$/;

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null;

/**
 * A top-level string property of the object `defineConfig` is called with,
 * read off the parse. A value the parse cannot read as one string (a regex,
 * an array, a computed value) throws: the gate must not guess what the
 * runner collects.
 */
export function configString(source: string, key: string): string {
  const { program } = parseSync("playwright.config.ts", source);
  const found: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isNode(value)) return;
    const callee = value["callee"];
    if (value["type"] === "CallExpression" && isNode(callee) && callee["name"] === "defineConfig") {
      const [options] = Array.isArray(value["arguments"]) ? value["arguments"] : [];
      const properties =
        isNode(options) && Array.isArray(options["properties"]) ? options["properties"] : [];
      for (const property of properties) {
        if (isNode(property) && isNode(property["key"]) && property["key"]["name"] === key) {
          found.push(property["value"]);
        }
      }
    }
    for (const child of Object.values(value)) if (typeof child === "object") visit(child);
  };
  visit(program);
  const [value] = found;
  if (found.length !== 1 || !isNode(value) || typeof value["value"] !== "string") {
    throw new Error(`playwright.config.ts: ${key} is not one string literal`);
  }
  return value["value"];
}

/** The spec files Playwright collects, from the config's own testDir and testMatch. */
export function collectedSpecs(): string[] {
  const config = readFileSync(join(RENDER_TESTS_ROOT, "playwright.config.ts"), "utf8");
  const dir = resolve(RENDER_TESTS_ROOT, configString(config, "testDir"));
  const testMatch = configString(config, "testMatch");
  return [...new Bun.Glob(testMatch).scanSync({ cwd: dir })]
    .map((file) => relative(WORKSPACE_ROOT, join(dir, file)))
    .toSorted();
}

/** How a spec breaks the rule, or nothing when it keeps it. */
export function ownStoreViolations(file: string, source: string): string[] {
  const imports = importsOf(file, source);
  const out: string[] = [];
  if (!imports.some((i) => i.kind !== "type" && HARNESS_TEST.test(i.specifier))) {
    out.push(`${file}: does not import harness-test.ts`);
  }
  for (const i of imports) {
    if (i.specifier === "playwright/test" && i.kind !== "type") {
      out.push(
        `${file}: takes a value from playwright/test; take test and expect from harness-test.ts`,
      );
    }
  }
  return out;
}

describe("render-specs-own-store", () => {
  const specs = collectedSpecs();

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
      "a.e2e.ts: does not import harness-test.ts",
      "a.e2e.ts: takes a value from playwright/test; take test and expect from harness-test.ts",
    ]);
    // The runner's glob descends, so a nested spec is collected, and read.
    const config = readFileSync(join(RENDER_TESTS_ROOT, "playwright.config.ts"), "utf8");
    expect(new Bun.Glob(configString(config, "testMatch")).match("lab/nested.e2e.ts")).toBe(true);
    expect(() =>
      configString("export default defineConfig({ testMatch: /x/ });", "testMatch"),
    ).toThrow();
    // A nested spec reaches the fixture by its own relative path.
    expect(
      ownStoreViolations(
        "lab/nested.e2e.ts",
        'import type { Page } from "playwright/test";\nimport { expect, test } from "../harness-test.ts";',
      ),
    ).toEqual([]);
    expect(
      ownStoreViolations("lab/nested.e2e.ts", 'import { test } from "../my-harness-test-copy.ts";'),
    ).toEqual(["lab/nested.e2e.ts: does not import harness-test.ts"]);
    expect(
      ownStoreViolations(
        "b.e2e.ts",
        'import type { Page } from "playwright/test";\nimport { expect, test } from "./harness-test.ts";',
      ),
    ).toEqual([]);
  });
});
