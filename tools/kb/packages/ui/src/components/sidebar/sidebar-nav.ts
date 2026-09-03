/**
 * Pure selectors for sidebar section lists — store fixtures in, rows out.
 * No React; sidebar.tsx only wires these to navigate/zoom.
 */
import type { WireNode } from "@kb/contracts";
import { listCanvasNodes } from "@/lib/canvas-api";
import { listPerspectiveNodes } from "@/lib/graph-lens";
import { listOntologyItems } from "@/lib/ontology-scope";
import { listPinnedNodes } from "@/lib/pinned";
import type { NodeMap, OutlineNode } from "@/lib/types";

export interface SidebarNavItem {
  id: string;
  label: string;
}

/** `#pinned` nodes for the Pinned section — membership owned by lib/pinned. */
export function listPinnedNavItems(nodes: NodeMap): SidebarNavItem[] {
  return listPinnedNodes(nodes).map((n) => ({
    id: n.id,
    label: n.text || n.id,
  }));
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
