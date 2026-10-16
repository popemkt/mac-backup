/**
 * Pure selectors for sidebar section lists — store fixtures in, rows out.
 * The Pinned list's are the kit's (`listPinnedNavItems`).
 * No React; sidebar.tsx only wires these to navigate/zoom.
 */
import type { WireNode } from "@kb/contracts";
import type { SidebarNavItem } from "@kb/ui-sdk";
import { listOntologyItems } from "@/lib/ontology-scope";

/** `#ontology` nodes for the Ontologies section. */
export function listOntologyNavItems(wireNodes: WireNode[]): SidebarNavItem[] {
  return listOntologyItems(wireNodes);
}
