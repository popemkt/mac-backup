/**
 * Pin / unpin round-trip.
 *
 * Pinning is tagging, so this asserts the whole gesture through the ordinary
 * mutation path: the `pinned` tag is minted on first use, membership shows up
 * where the sidebar reads it, and toggling again removes it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { listPinnedNavItems } from "@/components/sidebar/sidebar-nav";
import { PINNED_TAG_TEXT, findPinnedTagId, isPinned } from "@/lib/pinned";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

function seed() {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
    undoStack: [],
    redoStack: [],
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
}

const nodes = () => useOutlineStore.getState().nodes;

describe("pin toggle", () => {
  beforeEach(seed);

  it("mints the pinned tag on first pin and lists the node", () => {
    expect(findPinnedTagId(nodes())).toBeNull();
    expect(listPinnedNavItems(nodes())).toEqual([]);

    // oxlint-disable-next-line promise/always-return -- GAP [[01M1MFS8RQ2BMQVZD02J4TQT7W]]
    return mutations.togglePin("n.root-a").then(() => {
      const tagId = present(findPinnedTagId(nodes()), "pinned tag");
      expect(nodes().get(tagId)?.text).toBe(PINNED_TAG_TEXT);
      expect(isPinned(nodes().get("n.root-a"), nodes())).toBe(true);
      expect(listPinnedNavItems(nodes()).map((i) => i.id)).toEqual(["n.root-a"]);
    });
  });

  it("round-trips: a second toggle unpins and reuses the same tag", async () => {
    await mutations.togglePin("n.root-a");
    const tagId = findPinnedTagId(nodes());
    await mutations.togglePin("n.root-b");
    expect(findPinnedTagId(nodes())).toBe(tagId);
    expect(
      listPinnedNavItems(nodes())
        .map((i) => i.id)
        .toSorted(),
    ).toEqual(["n.root-a", "n.root-b"]);

    await mutations.togglePin("n.root-a");
    expect(isPinned(nodes().get("n.root-a"), nodes())).toBe(false);
    expect(listPinnedNavItems(nodes()).map((i) => i.id)).toEqual(["n.root-b"]);
  });

  it("pins by tagging — no bespoke flag on the node", async () => {
    await mutations.togglePin("n.root-a");
    const tagId = present(findPinnedTagId(nodes()), "pinned tag");
    const wire = present(
      useOutlineStore.getState().wireNodes.find((n) => n.id === "n.root-a"),
      "n.root-a",
    );
    expect(wire.props[SYSTEM_IDS.typeField]).toEqual(
      expect.arrayContaining([{ t: "ref", v: tagId }]),
    );
  });

  it("refuses to pin a sys.* node (write guard)", async () => {
    expect(await mutations.togglePin(SYSTEM_IDS.queryTag)).toBe(false);
    expect(findPinnedTagId(nodes())).toBeNull();
  });
});
