/**
 * The Nx project graph, read through `nx graph --file`.
 *
 * Nx derives `dependencies` from real imports (`type: "static"` /
 * `"dynamic"`) as well as from manifests, which is what makes the boundary
 * check honest: a forbidden import fails it even if no manifest mentions the
 * package.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_ROOT } from "./workspace.ts";

interface GraphNode {
  name: string;
  type: string;
  data: { root: string; tags?: string[] };
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface ProjectGraph {
  nodes: Record<string, GraphNode>;
  dependencies: Record<string, GraphEdge[]>;
}

let cached: ProjectGraph | undefined;

export function projectGraph(): ProjectGraph {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "kb-nx-graph-"));
  const file = join(dir, "graph.json");
  try {
    const result = spawnSync(
      join(WORKSPACE_ROOT, "node_modules", ".bin", "nx"),
      ["graph", `--file=${file}`],
      { cwd: WORKSPACE_ROOT, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`nx graph failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ProjectGraph | { graph: ProjectGraph };
    cached = "graph" in parsed ? parsed.graph : parsed;
    return cached;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Workspace-internal edges only; npm packages are not our boundary problem. */
export function internalEdges(graph: ProjectGraph): GraphEdge[] {
  return Object.values(graph.dependencies)
    .flat()
    .filter((e) => e.target in graph.nodes && e.source in graph.nodes);
}
