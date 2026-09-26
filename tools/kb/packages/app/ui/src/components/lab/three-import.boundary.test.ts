/**
 * The lab's three boundary: three.js — directly, or through the scene kit's
 * GPU modules (`@/scene/gpu/*`) — is imported only by the study scene
 * modules and the kit pieces they alone load, so everything the always-loaded
 * plugin reaches (routes, plugin, surfaces) and the page shell stay free of
 * it, and a study's three code rides in its own lazy chunk.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { LAB_SCENE_IDS } from "./routes";

const LAB_DIR = import.meta.dirname;
const THREE_IMPORT = /from\s+["'](?:three(?:\/[^"']*)?|@\/scene\/gpu\/[^"']*)["']/;

/** Only these may import three; each is reached only through a study's `load()`. */
const ALLOWED = new Set([
  "kit/backdrop.ts",
  "kit/entrance.ts",
  "kit/pointer.ts",
  "kit/study.ts",
  "embers/ash.ts",
  "embers/compute.ts",
  "embers/looks.ts",
  "embers/scene.ts",
  "sky/hands.ts",
  "sky/scene.ts",
  "sky/shaders.ts",
  "sky/stars.ts",
  "glass/march.ts",
  "glass/scene.ts",
  "river/flow.ts",
  "river/scene.ts",
  "ocean/scene.ts",
  "ocean/shaders.ts",
  "light/scene.ts",
  "motion/scene.ts",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("lab three boundary", () => {
  const files = sources(LAB_DIR).map((path) => ({
    name: relative(LAB_DIR, path),
    source: readFileSync(path, "utf8"),
  }));

  it("imports three only from the study scenes and the kit they load", () => {
    const offenders = files
      .filter((f) => THREE_IMPORT.test(f.source) && !ALLOWED.has(f.name))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("reaches every scene module only through a dynamic import", () => {
    const eager =
      /from\s+["']@\/components\/lab\/(?:embers|sky|glass|river|ocean|light|motion)\/scene["']/;
    expect(files.filter((f) => eager.test(f.source)).map((f) => f.name)).toEqual([]);
    const studies = files.find((f) => f.name === "studies.ts")?.source ?? "";
    for (const study of LAB_SCENE_IDS) {
      expect(studies).toContain(`import("@/components/lab/${study}/scene")`);
    }
  });

  it("keeps the always-loaded plugin files free of the page itself", () => {
    for (const name of ["plugin.ts", "routes.ts", "surfaces.tsx"]) {
      const source = files.find((f) => f.name === name)?.source ?? "";
      expect(source).not.toMatch(/from\s+["']@\/components\/lab\/(?:lab-page|studies|kit\/)/);
    }
    const surfaces = files.find((f) => f.name === "surfaces.tsx")?.source ?? "";
    expect(surfaces).toContain('lazy(() => import("@/components/lab/lab-page"))');
  });
});
