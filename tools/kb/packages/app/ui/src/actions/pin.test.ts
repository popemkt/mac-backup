/**
 * Pin / unpin round-trip.
 *
 * Pinning is listing, so this asserts the whole gesture through the ordinary
 * mutation path: a contextual reference lands under the seeded `pinned` node,
 * the sidebar reads it in list order, and toggling again deletes that row.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { REF_SEED_WIRES } from "@/fixtures/contextual-ref";
import { fixtureGraph } from "@/api/fixture-graph";
import { listPinnedNavItems } from "@/components/sidebar/sidebar-nav";
import { contextualTargetOf } from "@/lib/contextual-ref";
import { isPinned, pinnedRefIds } from "@/lib/pinned";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";

/** The seeded Pinned list, which the real graph always carries. */
const PINNED_LIST = {
  id: SYSTEM_IDS.pinnedRoot,
  text: "Pinned",
  props: {},
  children: [],
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

function seed() {
  resetOutlineStore();
  useOutlineStore
    .getState()
    .hydrateFromWire(
      [
        ...structuredClone(fixtureGraph.nodes),
        ...structuredClone(REF_SEED_WIRES),
        { ...PINNED_LIST },
      ],
      fixtureGraph.rev,
      "fixtures",
    );
}

const nodes = () => useOutlineStore.getState().nodes;

describe("pin toggle", () => {
  beforeEach(seed);

  it("appends one reference row and lists the node", async () => {
    expect(listPinnedNavItems(nodes())).toEqual([]);

    await mutations.togglePin("n.root-a");

    const refId = present(pinnedRefIds(nodes())[0], "pin row");
    expect(contextualTargetOf(nodes().get(refId))).toBe("n.root-a");
    expect(isPinned(nodes(), "n.root-a")).toBe(true);
    expect(listPinnedNavItems(nodes()).map((i) => i.id)).toEqual(["n.root-a"]);
  });

  it("round-trips, and keeps pin order rather than label order", async () => {
    await mutations.togglePin("n.root-b");
    await mutations.togglePin("n.root-a");
    expect(listPinnedNavItems(nodes()).map((i) => i.id)).toEqual(["n.root-b", "n.root-a"]);

    await mutations.togglePin("n.root-b");
    expect(isPinned(nodes(), "n.root-b")).toBe(false);
    expect(listPinnedNavItems(nodes()).map((i) => i.id)).toEqual(["n.root-a"]);
    expect(pinnedRefIds(nodes()).length).toBe(1);
  });

  it("writes nothing to the pinned node itself", async () => {
    await mutations.togglePin("n.root-a");
    const wire = present(
      useOutlineStore.getState().wireNodes.find((n) => n.id === "n.root-a"),
      "n.root-a",
    );
    const before = present(
      fixtureGraph.nodes.find((n) => n.id === "n.root-a"),
      "fixture n.root-a",
    );
    expect(wire.props).toEqual(before.props);
  });

  it("pins a sys.* node — pointing at one is not writing to one", async () => {
    // The old toggle refused, because tagging edited the node's kind slot.
    // A reference writes only the Pinned list, and `sys.*` browse is open.
    expect(await mutations.togglePin(SYSTEM_IDS.queryField)).toBe(true);
    expect(isPinned(nodes(), SYSTEM_IDS.queryField)).toBe(true);
  });
});
