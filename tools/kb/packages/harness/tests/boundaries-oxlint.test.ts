import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateBoundaryOverrides, type OxlintOverride } from "../src/oxlint-boundaries.ts";
import { WORKSPACE_ROOT, workspacePackages } from "../src/workspace.ts";

/**
 * Asserts that .oxlintrc.json's boundary overrides match the generated ones
 * derived from the constraint matrix (plan Addendum / D11).
 *
 * This guarantees the editor squiggles in .oxlintrc.json stay synchronized with
 * `packages/harness/src/constraints.ts` without drift.
 *
 * Red case: modify or delete a boundary override in .oxlintrc.json.
 */
describe("boundaries-oxlint", () => {
  const rcPath = join(WORKSPACE_ROOT, ".oxlintrc.json");

  test(".oxlintrc.json contains the boundary overrides generated from constraints.ts", () => {
    const raw = readFileSync(rcPath, "utf8");
    const lines = raw.split("\n").map((l) => {
      const idx = l.indexOf("//");
      if (idx !== -1 && !l.includes("http://") && !l.includes("https://")) {
        return l.slice(0, idx);
      }
      return l;
    });
    const rc = JSON.parse(lines.join("\n")) as {
      overrides?: OxlintOverride[];
    };

    const committedBoundaryOverrides = (rc.overrides ?? []).filter(
      (o) => o.rules?.["eslint/no-restricted-imports"] !== undefined,
    );

    const generated = generateBoundaryOverrides(workspacePackages());

    expect(committedBoundaryOverrides.length).toBe(generated.length);
    expect(committedBoundaryOverrides).toEqual(generated);
  });
});
