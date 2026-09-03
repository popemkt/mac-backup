import type { OutlineNode } from "@/lib/types";

/** Minimal outline node for Bullet / NodeRow stories. */
export function stubOutlineNode(
  overrides: Partial<OutlineNode> & Pick<OutlineNode, "id" | "text">,
): OutlineNode {
  return {
    parentId: null,
    children: [],
    collapsed: false,
    props: {},
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    tags: [],
    ...overrides,
  };
}
