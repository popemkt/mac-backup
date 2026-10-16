/** The sidebar's Graph section, as rows: a pure selector, store fixtures in. */
import type { WireNode } from "@kb/contracts";
import { listPerspectiveNodes, type KbIndex, type SidebarNavItem } from "@kb/ui-sdk";

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
