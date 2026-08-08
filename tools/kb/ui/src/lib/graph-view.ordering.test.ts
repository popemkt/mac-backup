import { beforeEach, describe, expect, it } from "vitest";
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
      selectedNodeId: null,
      cursorPosition: 0,
      loadSource: null,
      loadError: null,
    });
    useOutlineStore
      .getState()
      .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("forest roots are sorted by id ascending", () => {
    const roots = forestRootIds(fixtureGraph.nodes);
    expect(roots).toEqual(["n.root-a", "n.root-b", "n.root-c"]);
  });

  it("mergeTx preserves deterministic wire order (id ascending)", () => {
    const shuffled = [...fixtureGraph.nodes].reverse();
    const merged = mergeTx(shuffled, [], []);
    expect(merged.map((n) => n.id)).toEqual(
      [...fixtureGraph.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => n.id),
    );
  });

  it("root and sibling order stay byte-identical across repeated text edits", () => {
    const beforeRoots = [
      ...useOutlineStore.getState().nodes.get("__kb_root__")!.children,
    ];
    const beforeChildren = [
      ...useOutlineStore.getState().nodes.get("n.root-a")!.children,
    ];

    for (let i = 0; i < 25; i++) {
      mutations.updateNodeContent("n.root-a", `Ship kb ui shell v${i}`);
    }

    const afterRoots = [
      ...useOutlineStore.getState().nodes.get("__kb_root__")!.children,
    ];
    const afterChildren = [
      ...useOutlineStore.getState().nodes.get("n.root-a")!.children,
    ];

    expect(afterRoots).toEqual(beforeRoots);
    expect(afterChildren).toEqual(beforeChildren);
  });

  it("expanded ids persist in kb-expanded localStorage", () => {
    if (typeof localStorage === "undefined") return;
    useOutlineStore.getState().toggleCollapse("n.root-a");
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const ids: string[] = JSON.parse(raw!);
    expect(ids).toContain("n.root-a");

    const remapped = wireToOutlineMap(fixtureGraph.nodes, new Set(ids));
    expect(remapped.get("n.root-a")!.collapsed).toBe(false);
  });
});
