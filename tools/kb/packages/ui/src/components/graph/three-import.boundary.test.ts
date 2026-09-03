/**
 * Task 16(a): three must only be imported from the lazy force3d chunk sources.
 * A static import scan is the regression net; a Vite build assertion would also
 * work but depends on the concurrent harness wave's package scripts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GRAPH_DIR = import.meta.dirname;
const LIB_DIR = join(import.meta.dirname, "..", "..", "lib");
const ALLOWED = new Set(["force3d-graph.tsx", "force3d-three.ts"]);

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).filter(
    (f) =>
      (f.endsWith(".ts") || f.endsWith(".tsx")) &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".test.tsx"),
  );
}

const THREE_IMPORT = /from\s+["']three["']|require\(\s*["']three["']\s*\)/;

describe("three import boundary (task 16a)", () => {
  it("only force3d chunk sources import three", () => {
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
    // graph-page must never pull three either.
    const page = readFileSync(join(GRAPH_DIR, "graph-page.tsx"), "utf8");
    expect(THREE_IMPORT.test(page)).toBe(false);
    expect(offenders).toEqual([]);
  });

  it("force3d-three.ts is the only direct three re-export", () => {
    const src = readFileSync(join(GRAPH_DIR, "force3d-three.ts"), "utf8");
    expect(THREE_IMPORT.test(src)).toBe(true);
    const graph = readFileSync(join(GRAPH_DIR, "force3d-graph.tsx"), "utf8");
    expect(THREE_IMPORT.test(graph)).toBe(false);
    expect(graph).toContain('from "./force3d-three"');
  });
});
