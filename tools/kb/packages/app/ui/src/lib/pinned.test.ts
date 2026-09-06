/**
 * Pinned is an ordered list of contextual references, not a mark on the node.
 *
 * These pin the two things the tag version could not do — keep an order the
 * user chose, and pin a node without writing to it — plus the one it did do
 * that must keep working: a node merely *tagged* `pinned` is not pinned.
 */
import { describe, expect, it } from "vitest";
import { isPinned, listPinnedNodes, pinnedRefIds, pinnedRefIdsFor } from "@/lib/pinned";
import { SYSTEM_IDS, type NodeMap, type OutlineNode } from "@/lib/types";

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

/** One pin row: a contextual reference to `targetId`. */
function pin(id: string, targetId: string): OutlineNode {
  return outline({
    id,
    text: "",
    parentId: SYSTEM_IDS.pinnedRoot,
    props: { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: targetId }] },
  });
}

function graph(refIds: string[], ...nodes: OutlineNode[]): NodeMap {
  const list = outline({ id: SYSTEM_IDS.pinnedRoot, text: "Pinned", children: refIds });
  return new Map([list, ...nodes].map((n) => [n.id, n]));
}

describe("pinned membership", () => {
  it("reads the Pinned list's children, resolved through their ref target", () => {
    const nodes = graph(["p1"], pin("p1", "a"), outline({ id: "a", text: "Pinned A" }));
    expect(pinnedRefIds(nodes)).toEqual(["p1"]);
    expect(isPinned(nodes, "a")).toBe(true);
    expect(listPinnedNodes(nodes).map((n) => n.id)).toEqual(["a"]);
  });

  it("keeps list order — the whole reason a list beats a tag", () => {
    const nodes = graph(
      ["p1", "p2"],
      pin("p1", "z"),
      pin("p2", "a"),
      outline({ id: "z", text: "alpha" }),
      outline({ id: "a", text: "beta" }),
    );
    // Neither label order nor id order: the order the children are in.
    expect(listPinnedNodes(nodes).map((n) => n.id)).toEqual(["z", "a"]);
  });

  it("a node merely TAGGED `pinned` is not pinned", () => {
    const tag = outline({
      id: "tag.pinned",
      text: "pinned",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    });
    const tagged = outline({
      id: "a",
      text: "Looks pinned",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag.pinned" }] },
      tags: [{ id: "tag.pinned", name: "pinned", color: "#fff" }],
    });
    const nodes = graph([], tag, tagged);
    expect(isPinned(nodes, "a")).toBe(false);
    expect(listPinnedNodes(nodes)).toEqual([]);
  });

  it("reports every row pinning a target, so unpin clears all of them", () => {
    const nodes = graph(
      ["p1", "p2"],
      pin("p1", "a"),
      pin("p2", "a"),
      outline({ id: "a", text: "A" }),
    );
    expect(pinnedRefIdsFor(nodes, "a")).toEqual(["p1", "p2"]);
    expect(listPinnedNodes(nodes).map((n) => n.id)).toEqual(["a", "a"]);
  });

  it("a pin whose target is gone drops out of the sidebar, not out of the graph", () => {
    const nodes = graph(
      ["p1", "p2"],
      pin("p1", "gone"),
      pin("p2", "a"),
      outline({ id: "a", text: "A" }),
    );
    expect(listPinnedNodes(nodes).map((n) => n.id)).toEqual(["a"]);
    expect(pinnedRefIds(nodes)).toEqual(["p1", "p2"]);
  });

  it("an unseeded graph has an empty list, not a throw", () => {
    expect(pinnedRefIds(new Map())).toEqual([]);
    expect(isPinned(new Map(), "a")).toBe(false);
    expect(listPinnedNodes(new Map())).toEqual([]);
  });
});
