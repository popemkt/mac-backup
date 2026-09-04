import { describe, expect, test } from "bun:test";
import {
  allWorkspaceTsFiles,
  assignToScopes,
  missingScopes,
  typecheckScopes,
} from "../src/scopes.ts";

/**
 * Harness check: typecheck scope coverage (tools/kb/DESIGN.md, "Compiler
 * strictness contract").
 *
 * The strictness contract and the Effect diagnostic severities only reach a
 * file that some `tsc -p` project includes. A package that grows a directory
 * and forgets to include it — `tests/`, `scripts/`, `.storybook/` — keeps a
 * green `bun run typecheck` while that code is checked by nothing, which is
 * exactly the shape a severity promotion is supposed to catch. So the scope
 * is asserted the same way the lint scope is: every TypeScript file under
 * tools/kb falls in exactly one package tsconfig project.
 *
 * This is also why the Effect preference lane can be promoted per path
 * (`**\/src\/**\/*` at `error`) without a second tsconfig per package: the
 * file scope is meaningful only because every file is in a project already.
 *
 * Red case: add `packages/<pkg>/scripts/x.ts` without adding `scripts` to
 * that package's tsconfig `include`.
 */
describe("typecheck-scope", () => {
  const scopes = typecheckScopes();

  test("every tsconfig include names something on disk", () => {
    expect(scopes.length).toBeGreaterThanOrEqual(17);
    const missing = missingScopes(scopes);
    expect(missing, missing.join("\n")).toEqual([]);
  });

  test("every TypeScript file under tools/kb falls in exactly one typecheck project", () => {
    const tsFiles = allWorkspaceTsFiles();
    expect(tsFiles.length).toBeGreaterThan(50);

    const { unassigned, multiple } = assignToScopes(tsFiles, scopes);

    expect(
      unassigned,
      `TypeScript files no tsconfig project includes:\n${unassigned.join("\n")}`,
    ).toEqual([]);

    expect(
      multiple,
      `TypeScript files included by more than one tsconfig project:\n${multiple.join("\n")}`,
    ).toEqual([]);
  });
});
