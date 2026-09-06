import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import { listCanvasNavItems, listPerspectiveNavItems, listPinnedNavItems } from "./sidebar-nav";

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

describe("sidebar-nav selectors", () => {
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

  it("lists canvas and graph-perspective nav items", () => {
    const nodes = new Map<string, OutlineNode>([
      [
        "cv1",
        outline({
          id: "cv1",
          text: "My canvas",
          props: {
            [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.canvasTag }],
          },
        }),
      ],
      ["x", outline({ id: "x", text: "plain" })],
    ]);
    expect(listCanvasNavItems(nodes)).toEqual([{ id: "cv1", label: "My canvas" }]);

    const wire: WireNode[] = [
      {
        id: "p1",
        text: "Lens A",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }],
        },
        children: [],
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "other",
        text: "nope",
        props: {},
        children: [],
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(listPerspectiveNavItems(wire)).toEqual([{ id: "p1", label: "Lens A" }]);
  });
});
