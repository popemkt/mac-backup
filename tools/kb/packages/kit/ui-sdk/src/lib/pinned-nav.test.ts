import { describe, expect, it } from "vitest";
import { listPinnedNavItems } from "./pinned";
import { SYSTEM_IDS, type OutlineNode } from "./types";

function outline(partial: Partial<OutlineNode> & Pick<OutlineNode, "id" | "text">): OutlineNode {
  return {
    parentId: null,
    children: [],
    collapsed: false,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags: [],
    ...partial,
  };
}

describe("the Pinned section's rows", () => {
  it("lists the Pinned list's targets, in list order", () => {
    const pinRow = (id: string, target: string) =>
      outline({
        id,
        text: "",
        parentId: SYSTEM_IDS.pinnedRoot,
        props: { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: target }] },
      });
    const nodes = new Map<string, OutlineNode>([
      [
        SYSTEM_IDS.pinnedRoot,
        outline({ id: SYSTEM_IDS.pinnedRoot, text: "Pinned", children: ["p1", "p2"] }),
      ],
      ["p1", pinRow("p1", "c")],
      ["p2", pinRow("p2", "a")],
      ["a", outline({ id: "a", text: "Pinned A" })],
      ["b", outline({ id: "b", text: "Other" })],
      ["c", outline({ id: "c", text: "Pinned C" })],
    ]);
    // List order, not label order: the sidebar shows what the outline shows.
    expect(listPinnedNavItems(nodes)).toEqual([
      { id: "c", label: "Pinned C" },
      { id: "a", label: "Pinned A" },
    ]);
  });
});
