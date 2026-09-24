/**
 * The scene kit's three boundary. The kit's GPU modules sit in `gpu/`, and
 * the folder is the mark: every module that imports three is under it, and
 * nothing outside it does, so a surface's own three boundary can name "three
 * or `@/scene/gpu/*`" as one kind of import and never list kit files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SCENE_DIR = import.meta.dirname;
const THREE = /from\s+["']three(?:\/[^"']*)?["']/;
const GPU = /from\s+["']@\/scene\/gpu\/[^"']*["']/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("scene three boundary", () => {
  const files = sources(SCENE_DIR).map((path) => ({
    name: relative(SCENE_DIR, path),
    source: readFileSync(path, "utf8"),
  }));

  it("imports three only under gpu/", () => {
    const offenders = files
      .filter((f) => THREE.test(f.source) && !f.name.startsWith("gpu/"))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("keeps the three-free modules free of the GPU ones", () => {
    const offenders = files
      .filter((f) => !f.name.startsWith("gpu/") && GPU.test(f.source))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("has GPU modules to guard", () => {
    expect(files.filter((f) => f.name.startsWith("gpu/")).length).toBeGreaterThan(0);
  });
});
