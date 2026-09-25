/**
 * The graph's three boundary: three — directly, or through the scene kit's
 * GPU modules — is imported only by the 3D scene's own modules, and those are
 * reached only through the 3D host, which `graph-adapters` loads lazily. So
 * the graph page, the 2D renderers and `lib/` never pull three into the
 * always-loaded bundle.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GRAPH_DIR = import.meta.dirname;
const LIB_DIR = join(import.meta.dirname, "..", "..", "lib");
/** The 3D scene: the only graph files that may import three. */
const ALLOWED = new Set([
  "force3d-scene.ts",
  "force3d-nodes.ts",
  "force3d-links.ts",
  "force3d-labels.ts",
  "force3d-screen.ts",
]);

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).filter(
    (f) =>
      (f.endsWith(".ts") || f.endsWith(".tsx")) &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".test.tsx") &&
      !f.endsWith(".d.ts"),
  );
}

/** three itself, or the scene kit's GPU modules, which are three. */
const THREE_IMPORT =
  /from\s+["'](?:three(?:\/[^"']*)?|@\/scene\/gpu\/[^"']*)["']|require\(\s*["']three["']\s*\)/;
const SCENE_IMPORT = /from\s+["']\.\/force3d-(?:scene|nodes|links|labels|screen)["']/;

describe("three import boundary (task 16a)", () => {
  it("only the 3D scene's modules import three", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(GRAPH_DIR)) {
      const src = readFileSync(join(GRAPH_DIR, file), "utf8");
      if (THREE_IMPORT.test(src) && !ALLOWED.has(file)) {
        offenders.push(`components/graph/${file}`);
      }
    }
    for (const file of listTsFiles(LIB_DIR)) {
      if (!file.startsWith("graph")) continue;
      const src = readFileSync(join(LIB_DIR, file), "utf8");
      if (THREE_IMPORT.test(src)) offenders.push(`lib/${file}`);
    }
    expect(offenders).toEqual([]);
  });

  it("reaches the scene only through the lazily loaded 3D host", () => {
    const importers = listTsFiles(GRAPH_DIR).filter(
      (file) =>
        !ALLOWED.has(file) && SCENE_IMPORT.test(readFileSync(join(GRAPH_DIR, file), "utf8")),
    );
    expect(importers).toEqual(["force3d-graph.tsx"]);
    const adapters = readFileSync(join(GRAPH_DIR, "graph-adapters.tsx"), "utf8");
    expect(adapters).toContain('lazy(() => import("./force3d-graph"))');
    expect(adapters).not.toMatch(/from\s+["']\.\/force3d-graph["']/);
  });
});
