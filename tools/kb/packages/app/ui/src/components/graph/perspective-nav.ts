/** The sidebar's Graph section, as rows: a pure selector, store fixtures in. */
import type { WireNode } from "@kb/contracts";
import { listPerspectiveNodes, type KbIndex } from "@kb/ui-sdk";
import type { SidebarNavItem } from "@/lib/sidebar-nav";

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
