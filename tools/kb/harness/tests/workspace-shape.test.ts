import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LAYER_ALLOWS, SCOPE_ALLOWS } from "../src/constraints.ts";
import {
  PACKAGES_ROOT,
  axisValues,
  layerDirs,
  packageDirs,
  rootManifest,
  tagsOf,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * Every directory under packages/ is a workspace member, and every workspace
 * member is under packages/. Without this, a package can exist that no gate
 * ever sees: untagged, untypechecked, and invisible to the project graph.
 * Red case (demonstrated in the w1 report): drop a tag from a manifest.
 *
 * The tree is two levels deep and the first level is the layer: a package's
 * layer is where it sits, so `packages/misc/<pkg>` fails here rather than
 * inventing a layer the matrix has never heard of.
 */
describe("workspace-shape", () => {
  const root = rootManifest();

  test("the root declares exactly packages/*/* as its members", () => {
    expect(root.workspaces?.packages).toEqual(["packages/*/*"]);
    expect(root.private).toBe(true);
  });

  test("every directory under packages/ is a layer the matrix knows", () => {
    const unknown = layerDirs().filter((layer) => !(layer in LAYER_ALLOWS));
    expect(unknown, `not a layer: ${unknown.join(", ")}`).toEqual([]);
  });

  test("every directory under a layer has a manifest", () => {
    const missing = packageDirs().filter(
      (dir) => !existsSync(join(PACKAGES_ROOT, dir, "package.json")),
    );
    expect(missing, missing.join("\n")).toEqual([]);
  });

  test("every member is @kb/<basename>, private, ESM, and typechecked", () => {
    const bad: string[] = [];
    for (const { dir, name, manifest } of workspacePackages()) {
      const basename = dir.slice(dir.indexOf("/") + 1);
      if (name !== `@kb/${basename}`) bad.push(`${dir}: name is ${JSON.stringify(name)}`);
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

  test("every member sits in the layer folder its layer tag names", () => {
    // Transitional bridge: the folder and the tag are two statements of one
    // fact for exactly as long as both exist. The tag goes next; this
    // assertion is what proves the move put every package where its tag said.
    const bad: string[] = [];
    for (const { dir, layer, manifest } of workspacePackages()) {
      const tagged = axisValues(tagsOf(manifest), "layer");
      if (tagged.length !== 1 || tagged[0] !== layer) {
        bad.push(`${dir}: sits in layer:${layer} but is tagged ${JSON.stringify(tagged)}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every member carries exactly one known scope tag", () => {
    const bad: string[] = [];
    for (const { dir, manifest } of workspacePackages()) {
      const scopes = axisValues(tagsOf(manifest), "scope");
      const [scope] = scopes;
      if (scopes.length !== 1 || scope === undefined) {
        bad.push(`${dir}: scope tags ${JSON.stringify(scopes)}`);
      } else if (!(scope in SCOPE_ALLOWS)) bad.push(`${dir}: unknown scope:${scope}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
