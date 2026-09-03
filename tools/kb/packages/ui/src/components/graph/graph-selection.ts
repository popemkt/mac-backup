/**
 * What a graph renderer reports as "the selected node", and how to derive it
 * from a lens node. Lives beside the card that displays it rather than inside
 * it, so every renderer imports the shape from one place.
 */
import type { LensNode } from "@/lib/graph-lens";

export interface GraphSelection {
  nodeId: string;
  label: string;
  tags: string[];
  degree: number;
}

export function selectionFromNode(node: LensNode): GraphSelection {
  return {
    nodeId: node.id,
    label: node.label,
    tags: node.tags,
    degree: node.degree,
  };
}
