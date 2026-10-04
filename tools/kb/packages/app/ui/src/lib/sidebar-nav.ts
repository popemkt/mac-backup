/**
 * Pure selectors for sidebar section lists — store fixtures in, rows out.
 * No React; sidebar.tsx only wires these to navigate/zoom.
 */
import type { WireNode } from "@kb/contracts";
import { listPerspectiveNodes, type KbIndex, type NodeMap } from "@kb/ui-sdk";
import { listOntologyItems } from "@/lib/ontology-scope";
import { listPinnedNodes } from "@/lib/pinned";

export interface SidebarNavItem {
  id: string;
  label: string;
}

/** Targets of the Pinned list, in list order — membership owned by lib/pinned. */
export function listPinnedNavItems(nodes: NodeMap): SidebarNavItem[] {
  return listPinnedNodes(nodes).map((n) => ({
    id: n.id,
    label: n.text || n.id,
  }));
}

/** The graph view nodes (view nodes whose view is a renderer), for the Graph section. */
export function listPerspectiveNavItems(
  db: KbIndex | null,
  wireNodes: WireNode[],
): SidebarNavItem[] {
  return listPerspectiveNodes(db, wireNodes).map((n) => ({
    id: n.id,
    label: n.text || n.id,
  }));
}

/** `#ontology` nodes for the Ontologies section. */
export function listOntologyNavItems(wireNodes: WireNode[]): SidebarNavItem[] {
  return listOntologyItems(wireNodes);
}
