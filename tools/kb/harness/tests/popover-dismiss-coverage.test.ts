import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * Every popover is held by the dismiss contract (DESIGN-UI.md →
 * Cross-surface polish → Popovers dismiss one way).
 *
 * Asserts:
 *   Each file under packages/ that dismisses through `useDismiss` is a key of
 *   a `dismissContract({...})` suite in some test file, by its workspace
 *   path; and every key names such a file. A popover that dismisses without
 *   the contract proving it, or a suite left naming a file that no longer
 *   does, goes red.
 *
 * Red case: call `useDismiss` in a new component and run no suite over it.
 */

/** The hook's own file, which declares it rather than dismissing through it. */
const HOOK = "packages/kit/ui-sdk/src/components/use-dismiss.ts";
const TEST_FILE = /\.test\.tsx?$/;

const read = (file: string) => readFileSync(join(WORKSPACE_ROOT, file), "utf8");

/** The workspace files outside tests that call `useDismiss`. */
function dismissing(): string[] {
  return gitWorkspaceFiles(["packages/*.ts", "packages/*.tsx"])
    .filter((file) => file !== HOOK && !TEST_FILE.test(file))
    .filter((file) => /\buseDismiss\(/.test(read(file)));
}

/** The keys of every `dismissContract` suite: the files they say they hold. */
function held(): string[] {
  return gitWorkspaceFiles(["packages/*.test.ts", "packages/*.test.tsx"])
    .map(read)
    .filter((text) => text.includes("dismissContract({"))
    .flatMap((text) =>
      [...text.matchAll(/^\s*"(packages\/[^"]+\.tsx?)":/gm)].map(([, file = ""]) => file),
    );
}

describe("popover dismiss coverage", () => {
  test("every file that dismisses through useDismiss is held by the dismiss contract, and only those", () => {
    expect(held().toSorted()).toEqual(dismissing().toSorted());
  });
});
