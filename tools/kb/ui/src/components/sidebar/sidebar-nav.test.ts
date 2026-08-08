import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/protocol";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import {
  listCanvasNavItems,
  listPerspectiveNavItems,
  listPinnedNodes,
} from "./sidebar-nav";

function outline(
  partial: Partial<OutlineNode> & Pick<OutlineNode, "id" | "text">,
): OutlineNode {
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
  it("lists #pinned nodes by tag text (runtime lookup)", () => {
    const nodes = new Map<string, OutlineNode>([
      [
        "a",
        outline({
          id: "a",
          text: "Pinned A",
          tags: [{ id: "tag.pinned", name: "pinned", color: "#fff" }],
        }),
      ],
      [
        "b",
        outline({
          id: "b",
          text: "Other",
          tags: [{ id: "tag.todo", name: "todo", color: "#fff" }],
        }),
      ],
      [
        "c",
        outline({
          id: "c",
          text: "Pinned C",
          tags: [{ id: "tag.pinned", name: "pinned", color: "#fff" }],
        }),
      ],
    ]);
    expect(listPinnedNodes(nodes)).toEqual([
      { id: "a", label: "Pinned A" },
      { id: "c", label: "Pinned C" },
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
    expect(listCanvasNavItems(nodes)).toEqual([
      { id: "cv1", label: "My canvas" },
    ]);

    const wire: WireNode[] = [
      {
        id: "p1",
        text: "Lens A",
        props: {
          [SYSTEM_IDS.typeField]: [
            { t: "ref", v: SYSTEM_IDS.graphPerspectiveTag },
          ],
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
    expect(listPerspectiveNavItems(wire)).toEqual([
      { id: "p1", label: "Lens A" },
    ]);
  });
});
