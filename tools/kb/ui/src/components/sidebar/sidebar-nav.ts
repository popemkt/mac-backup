/**
 * Pure selectors for sidebar section lists — store fixtures in, rows out.
 * No React; sidebar.tsx only wires these to navigate/zoom.
 */
import type { WireNode } from "@kb/protocol";
import { listCanvasNodes } from "@/lib/canvas-api";
import { listPerspectiveNodes } from "@/lib/graph-lens";
import { listOntologyItems } from "@/lib/ontology-scope";
import type { OutlineNode } from "@/lib/types";

export interface SidebarNavItem {
  id: string;
  label: string;
}

/** Nodes tagged with a tag whose text is exactly `pinned` (runtime lookup). */
export function listPinnedNodes(
  nodes: Map<string, OutlineNode>,
): SidebarNavItem[] {
  const out: SidebarNavItem[] = [];
  for (const n of nodes.values()) {
    if (!n.tags.some((t) => t.name === "pinned")) continue;
    out.push({ id: n.id, label: n.text || n.id });
  }
  return out.sort(
    (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

/** `#graph-perspective` nodes for the Graph section. */
export function listPerspectiveNavItems(
  wireNodes: WireNode[],
): SidebarNavItem[] {
  return listPerspectiveNodes(wireNodes).map((n) => ({
    id: n.id,
    label: n.text || n.id,
  }));
}

/** `#canvas` nodes for the Canvases section. */
export function listCanvasNavItems(
  nodes: Map<string, OutlineNode>,
): SidebarNavItem[] {
  return listCanvasNodes(nodes).map((n) => ({
    id: n.id,
    label: n.text || "Untitled canvas",
  }));
}

/** `#ontology` nodes for the Ontologies section. */
export function listOntologyNavItems(
  wireNodes: WireNode[],
): SidebarNavItem[] {
  return listOntologyItems(wireNodes);
}
