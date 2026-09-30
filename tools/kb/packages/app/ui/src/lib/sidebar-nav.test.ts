import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import { DatascriptIndex } from "@/ds";
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

const wireNode = (id: string, text: string, props: WireNode["props"] = {}): WireNode => ({
  id,
  text,
  props,
  children: [],
  createdAt: "",
  updatedAt: "",
});

/** The props of a view node naming `option`. */
const view = (option: string) => ({
  [SYSTEM_IDS.viewField]: [{ t: "ref" as const, v: option }],
});

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

    // The seed's view options and families: a graph is a view node whose view is a renderer.
    const wire: WireNode[] = [
      ...systemSeedNodes(),
      wireNode("p1", "Lens A", view("sys.view.graph.tree")),
      wireNode("t1", "A table", view("sys.view.outline.table")),
      wireNode("other", "nope"),
    ];
    expect(listPerspectiveNavItems(new DatascriptIndex(wire), wire)).toEqual([
      { id: SYSTEM_IDS.lensAllMentions, label: "All mentions" },
      { id: "p1", label: "Lens A" },
    ]);
    expect(listPerspectiveNavItems(null, wire)).toEqual([]);
  });
});
