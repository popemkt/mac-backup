import { graphDisplayText } from "@/lib/graph-label";
import type { NodeMap } from "@/lib/types";
import type { OutlineSnippetParams } from "./views";

export interface SnippetRow {
  readonly id: string;
  readonly depth: number;
  readonly text: string;
}

/**
 * The rows an outline snippet shows: `root`, then its children depth-first
 * down to `depth` levels, cut at `maxRows`. A node reached twice is shown once.
 */
export function snippetRows(nodes: NodeMap, params: OutlineSnippetParams): SnippetRow[] {
  const rows: SnippetRow[] = [];
  const seen = new Set<string>();
  const label = (id: string) =>
    graphDisplayText(nodes.get(id)?.text ?? "", (ref) => nodes.get(ref)?.text);
  const visit = (id: string, depth: number) => {
    if (rows.length >= params.maxRows || seen.has(id) || !nodes.has(id)) return;
    seen.add(id);
    rows.push({ id, depth, text: label(id) });
    if (depth >= params.depth) return;
    for (const child of nodes.get(id)?.children ?? []) visit(child, depth + 1);
  };
  visit(params.root, 0);
  return rows;
}
