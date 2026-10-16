/** The sidebar's Graph section, as rows: a pure selector, store fixtures in. */
import type { WireNode } from "@kb/contracts";
import type { KbIndex, SidebarNavItem } from "@kb/ui-sdk";
import { listPerspectiveNodes } from "./graph-lens";

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
