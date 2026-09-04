import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_ROOT, WORKSPACE_ROOT, workspacePackages } from "../src/workspace.ts";

/**
 * Harness check 10: Datascript shim typechecks (spec 11 / plan A.9 #10).
 *
 * Compiles @kb/query's `src/datascript.d.ts` with `skipLibCheck: false` in an
 * isolated tsc invocation over the shim + its `src/datascript.ts`. The
 * package's directory comes from the workspace reader, so the shim keeps its
 * name while the tree around it can move.
 *
 * This guarantees that our hand-crafted DataScript type declarations are sound
 * and do not rely on skipLibCheck to pass.
 *
 * Red case: introduce a type error into datascript.d.ts.
 */
describe("datascript-shim-typechecks", () => {
  const queryDir = workspacePackages().find(({ name }) => name === "@kb/query")?.dir ?? "";
  const shimRel = `packages/${queryDir}/src/datascript.d.ts`;
  const implRel = `packages/${queryDir}/src/datascript.ts`;
  const shimPath = join(PACKAGES_ROOT, queryDir, "src", "datascript.d.ts");
  const implPath = join(PACKAGES_ROOT, queryDir, "src", "datascript.ts");

  // Spawns a whole tsc; under the full harness run it shares the box with
  // oxlint and effect-tsgo, so the 5 s default is not enough.
  test("datascript.d.ts exists and compiles under skipLibCheck: false in isolation", () => {
    expect(existsSync(shimPath)).toBe(true);
    expect(existsSync(implPath)).toBe(true);

    const cmd = [
      "node_modules/.bin/tsc",
      "--noEmit",
      "--skipLibCheck false",
      "--allowImportingTsExtensions",
      "--types bun",
      "--module Preserve",
      "--moduleResolution bundler",
      "--target ESNext",
      shimRel,
      implRel,
    ].join(" ");

    let exitCode = 0;
    let output = "";
    try {
      output = execSync(cmd, {
        cwd: WORKSPACE_ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "status" in err) {
        exitCode = Number(err.status);
      } else {
        exitCode = 1;
      }
      if (typeof err === "object" && err !== null && "stdout" in err) {
        output = String(err.stdout);
      }
    }

    expect(
      exitCode,
      `Isolated tsc with skipLibCheck:false failed (code ${exitCode}):\n${output}`,
    ).toBe(0);
  }, 60_000);
});
