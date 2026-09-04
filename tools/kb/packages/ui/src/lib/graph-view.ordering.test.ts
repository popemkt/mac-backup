import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/fixtures/graph";
import { forestRootIds, wireToOutlineMap } from "@/lib/graph-view";
import { mergeTx } from "@/lib/tx";
import { EXPANDED_STORAGE_KEY } from "@/lib/types";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";

describe("stable outline ordering", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // node without localStorage
    }
    useOutlineStore.setState({
      nodes: new Map(),
      wireNodes: [],
      queryDb: null,
      rev: 0,
      rootNodeId: "__kb_root__",
      homeRootId: "__kb_root__",
      activeNodeId: null,
      activeInstanceKey: null,
      selectedNodeId: null,
      selectedInstanceKey: null,
      loadSource: null,
      loadError: null,
    });
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
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

  it("root and sibling order stay byte-identical across repeated text edits", () => {
    const before = useOutlineStore.getState().nodes;
    const beforeRoots = [...present(before.get("__kb_root__"), "__kb_root__").children];
    const beforeChildren = [...present(before.get("n.root-a"), "n.root-a").children];

    for (let i = 0; i < 25; i++) {
      mutations.updateNodeContent("n.root-a", `Ship kb ui shell v${i}`);
    }

    const after = useOutlineStore.getState().nodes;
    const afterRoots = [...present(after.get("__kb_root__"), "__kb_root__").children];
    const afterChildren = [...present(after.get("n.root-a"), "n.root-a").children];

    expect(afterRoots).toEqual(beforeRoots);
    expect(afterChildren).toEqual(beforeChildren);
  });

  it("order survives JsonlStore-shaped id-sorted reload and re-edit", () => {
    const idSorted = [...fixtureGraph.nodes].toSorted((a, b) => a.id.localeCompare(b.id));
    useOutlineStore.getState().hydrateFromWire(idSorted, fixtureGraph.rev, "fixtures");

    const before = useOutlineStore.getState().nodes;
    const beforeRoots = [...present(before.get("__kb_root__"), "__kb_root__").children];
    const beforeChildren = [...present(before.get("n.root-a"), "n.root-a").children];

    mutations.updateNodeContent("n.root-a", "edited once");

    const wireAfterEdit = useOutlineStore.getState().wireNodes;
    const idSortedReload = [...wireAfterEdit].toSorted((a, b) => a.id.localeCompare(b.id));
    useOutlineStore.getState().hydrateFromWire(idSortedReload, fixtureGraph.rev + 1, "api");

    for (let i = 0; i < 10; i++) {
      mutations.updateNodeContent("n.root-a", `edited ${i}`);
    }

    const after = useOutlineStore.getState().nodes;
    const afterRoots = [...present(after.get("__kb_root__"), "__kb_root__").children];
    const afterChildren = [...present(after.get("n.root-a"), "n.root-a").children];

    expect(afterRoots).toEqual(beforeRoots);
    expect(afterChildren).toEqual(beforeChildren);
  });

  it("expanded ids persist in kb-expanded localStorage", () => {
    if (typeof localStorage === "undefined") return;
    useOutlineStore.getState().toggleCollapse("n.root-a");
    const raw = present(localStorage.getItem(EXPANDED_STORAGE_KEY), "expanded ids");
    const ids: string[] = JSON.parse(raw);
    expect(ids).toContain("n.root-a");

    const remapped = wireToOutlineMap(fixtureGraph.nodes, new Set(ids));
    expect(present(remapped.get("n.root-a"), "n.root-a").collapsed).toBe(false);
  });
});
