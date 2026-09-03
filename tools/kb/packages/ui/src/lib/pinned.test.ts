/**
 * Pinned membership comes from the kind slot, not from the badge list.
 *
 * `node.tags` is a DISPLAY list (`graph-view.resolveTags` drops kind refs from
 * it), so a selector that reads badge *names* is only accidentally right. These
 * pin the prop as the source of truth, and pin the fact that a tag merely
 * *named* pinned that is not a supertag does not pin anything.
 */
import { describe, expect, it } from "vitest";
import {
  PINNED_TAG_TEXT,
  findPinnedTagId,
  isPinned,
  listPinnedNodes,
  pinnedTagIdsOn,
} from "@/lib/pinned";
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

const pinnedTag = outline({
  id: "tag.pinned",
  text: PINNED_TAG_TEXT,
  props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
});

function graph(...nodes: OutlineNode[]): NodeMap {
  return new Map(nodes.map((n) => [n.id, n])) as NodeMap;
}

describe("pinned membership", () => {
  it("reads the prop, not the badge list", () => {
    // Zero badges by construction: this is the case where reading `node.tags`
    // and reading `sys.f.type` disagree, and the prop is the one that counts.
    const node = outline({
      id: "a",
      text: "Pinned A",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag.pinned" }] },
      tags: [],
    });
    const nodes = graph(pinnedTag, node);
    expect(isPinned(node, nodes)).toBe(true);
    expect(listPinnedNodes(nodes).map((n) => n.id)).toEqual(["a"]);
  });

  it("a badge alone pins nothing", () => {
    const node = outline({
      id: "a",
      text: "Looks pinned",
      tags: [{ id: "tag.pinned", name: PINNED_TAG_TEXT, color: "#fff" }],
    });
    expect(isPinned(node, graph(pinnedTag, node))).toBe(false);
  });

  it("the target must actually be a supertag named pinned", () => {
    const notATag = outline({ id: "note.pinned", text: PINNED_TAG_TEXT });
    const node = outline({
      id: "a",
      text: "A",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "note.pinned" }] },
    });
    expect(isPinned(node, graph(notATag, node))).toBe(false);
  });

  it("reports the carried tag ids, so unpin removes the right one", () => {
    // Two tags named `pinned` is a legal state; unpinning has to remove the
    // one this node carries, not whichever the graph scan met first.
    const second = outline({
      id: "aaa.pinned",
      text: PINNED_TAG_TEXT,
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    });
    const node = outline({
      id: "a",
      text: "A",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag.pinned" }] },
    });
    const nodes = graph(pinnedTag, second, node);
    expect(findPinnedTagId(nodes)).toBe("aaa.pinned");
    expect(pinnedTagIdsOn(node, nodes)).toEqual(["tag.pinned"]);
  });

  it("finds the tag id, and reports none before anything is pinned", () => {
    expect(findPinnedTagId(graph(pinnedTag))).toBe("tag.pinned");
    expect(findPinnedTagId(graph())).toBeNull();
  });

  it("orders by label then id", () => {
    const mk = (id: string, text: string) =>
      outline({
        id,
        text,
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag.pinned" }] },
      });
    const nodes = graph(pinnedTag, mk("z", "alpha"), mk("a", "beta"));
    expect(listPinnedNodes(nodes).map((n) => n.id)).toEqual(["z", "a"]);
  });
});
