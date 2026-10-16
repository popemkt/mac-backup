import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { forestRootIds, loadExpansion, wireToOutlineMap } from "@kb/ui-sdk";
import { mergeTx } from "@/lib/tx";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { useOutlineStore, outlineNodes } from "@/components/outline/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";

describe("stable outline ordering", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // node without localStorage
    }
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("forest roots are sorted by id ascending", () => {
    const roots = forestRootIds(fixtureGraph.nodes);
    expect(roots).toEqual(["lens.all-mentions", "n.root-a", "n.root-b", "n.root-c"]);
  });

  it("mergeTx preserves deterministic wire order (id ascending)", () => {
    const shuffled = fixtureGraph.nodes.toReversed();
    const merged = mergeTx(shuffled, [], []);
    expect(merged.map((n) => n.id)).toEqual(
      [...fixtureGraph.nodes].toSorted((a, b) => a.id.localeCompare(b.id)).map((n) => n.id),
    );
  });

  it("root and sibling order stay byte-identical across repeated text edits", async () => {
    const before = outlineNodes();
    const beforeRoots = [...present(before.get("__kb_root__"), "__kb_root__").children];
    const beforeChildren = [...present(before.get("n.root-a"), "n.root-a").children];

    for (let i = 0; i < 25; i++) {
      await mutations.updateNodeContent("n.root-a", `Ship kb ui shell v${i}`);
    }

    const after = outlineNodes();
    const afterRoots = [...present(after.get("__kb_root__"), "__kb_root__").children];
    const afterChildren = [...present(after.get("n.root-a"), "n.root-a").children];

    expect(afterRoots).toEqual(beforeRoots);
    expect(afterChildren).toEqual(beforeChildren);
  });

  it("order survives JsonlStore-shaped id-sorted reload and re-edit", async () => {
    const idSorted = [...fixtureGraph.nodes].toSorted((a, b) => a.id.localeCompare(b.id));
    useGraphStore.getState().hydrateFromWire(idSorted, fixtureGraph.rev, "fixtures");

    const before = outlineNodes();
    const beforeRoots = [...present(before.get("__kb_root__"), "__kb_root__").children];
    const beforeChildren = [...present(before.get("n.root-a"), "n.root-a").children];

    await mutations.updateNodeContent("n.root-a", "edited once");

    const wireAfterEdit = useGraphStore.getState().wireNodes;
    const idSortedReload = [...wireAfterEdit].toSorted((a, b) => a.id.localeCompare(b.id));
    useGraphStore.getState().hydrateFromWire(idSortedReload, fixtureGraph.rev + 1, "api");

    for (let i = 0; i < 10; i++) {
      await mutations.updateNodeContent("n.root-a", `edited ${i}`);
    }

    const after = outlineNodes();
    const afterRoots = [...present(after.get("__kb_root__"), "__kb_root__").children];
    const afterChildren = [...present(after.get("n.root-a"), "n.root-a").children];

    expect(afterRoots).toEqual(beforeRoots);
    expect(afterChildren).toEqual(beforeChildren);
  });

  it("expanded ids persist in localStorage", () => {
    if (typeof localStorage === "undefined") return;
    useOutlineStore.getState().toggleCollapse("n.root-a");
    const ids = [...loadExpansion()].filter(([, open]) => open).map(([id]) => id);
    expect(ids).toContain("n.root-a");

    const remapped = wireToOutlineMap(fixtureGraph.nodes, new Set(ids));
    expect(present(remapped.get("n.root-a"), "n.root-a").collapsed).toBe(false);
  });
});
