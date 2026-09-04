import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LAYER_ALLOWS, SCOPE_ALLOWS } from "../src/constraints.ts";
import {
  PACKAGES_ROOT,
  axisValues,
  packageDirs,
  rootManifest,
  tagsOf,
  workspacePackages,
} from "../src/workspace.ts";
import { expectDefined } from "../../test-kit/src/expect-defined.ts";

/**
 * Every directory under packages/ is a workspace member, and every workspace
 * member is under packages/. Without this, a package can exist that no gate
 * ever sees: untagged, untypechecked, and invisible to the project graph.
 * Red case (demonstrated in the w1 report): drop a tag from a manifest.
 */
describe("workspace-shape", () => {
  const root = rootManifest();

  test("the root declares exactly packages/* as its members", () => {
    expect(root.workspaces?.packages).toEqual(["packages/*"]);
    expect(root.private).toBe(true);
  });

  test("every directory under packages/ has a manifest", () => {
    const missing = packageDirs().filter(
      (dir) => !existsSync(join(PACKAGES_ROOT, dir, "package.json")),
    );
    expect(missing, missing.join("\n")).toEqual([]);
  });

  test("every member is @kb/<dir>, private, ESM, and typechecked", () => {
    const bad: string[] = [];
    for (const { dir, manifest } of workspacePackages()) {
      if (manifest.name !== `@kb/${dir}`) {
        bad.push(`${dir}: name is ${String(manifest.name)}`);
      }
      if (manifest.private !== true) bad.push(`${dir}: not private`);
      if (manifest.type !== "module") bad.push(`${dir}: type is not module`);
      if (manifest.version !== "0.0.0") {
        bad.push(`${dir}: version is ${String(manifest.version)}`);
      }
      if (typeof manifest.scripts?.typecheck !== "string") {
        bad.push(`${dir}: no scripts.typecheck`);
      }
      if (!existsSync(join(PACKAGES_ROOT, dir, "tsconfig.json"))) {
        bad.push(`${dir}: no tsconfig.json`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every member carries one known layer tag and one known scope tag", () => {
    const bad: string[] = [];
    for (const { dir, manifest } of workspacePackages()) {
      const tags = tagsOf(manifest);
      const layers = axisValues(tags, "layer");
      const scopes = axisValues(tags, "scope");
      if (layers.length !== 1) bad.push(`${dir}: layer tags ${JSON.stringify(layers)}`);
      else if (!(expectDefined(layers[0]) in LAYER_ALLOWS))
        bad.push(`${dir}: unknown layer:${layers[0]}`);
      if (scopes.length !== 1) bad.push(`${dir}: scope tags ${JSON.stringify(scopes)}`);
      else if (!(expectDefined(scopes[0]) in SCOPE_ALLOWS))
        bad.push(`${dir}: unknown scope:${scopes[0]}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
