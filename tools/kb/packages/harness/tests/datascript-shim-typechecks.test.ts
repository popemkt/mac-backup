import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

/**
 * Harness check 10: Datascript shim typechecks (spec 11 / plan A.9 #10).
 *
 * Compiles packages/query/src/datascript.d.ts with `skipLibCheck: false` in an
 * isolated tsc invocation over the shim + packages/query/src/datascript.ts.
 *
 * This guarantees that our hand-crafted DataScript type declarations are sound
 * and do not rely on skipLibCheck to pass.
 *
 * Red case: introduce a type error into datascript.d.ts.
 */
describe("datascript-shim-typechecks", () => {
  const shimPath = join(WORKSPACE_ROOT, "packages", "query", "src", "datascript.d.ts");
  const implPath = join(WORKSPACE_ROOT, "packages", "query", "src", "datascript.ts");

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
      "packages/query/src/datascript.d.ts",
      "packages/query/src/datascript.ts",
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
  });
});
