import { beforeEach, describe, expect, it } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

describe("sys.* UI write-guard", () => {
  beforeEach(() => {
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
    });
    useUiStore.setState({ toasts: [] });
    useOutlineStore
      .getState()
      .hydrateFromWire(
        structuredClone(fixtureGraph.nodes),
        fixtureGraph.rev,
        "fixtures",
      );
  });

  it("blocks text edits on sys.* with a toast", () => {
    const before = useOutlineStore.getState().nodes.get("sys.tag")!.text;
    mutations.updateNodeContent("sys.tag", "hacked");
    expect(useOutlineStore.getState().nodes.get("sys.tag")!.text).toBe(before);
    expect(useUiStore.getState().toasts.some((t) => /sys\.\*/.test(t.text))).toBe(
      true,
    );
  });

  it("blocks delete on sys.* with a toast", async () => {
    await mutations.deleteNode("sys.field");
    expect(useOutlineStore.getState().nodes.has("sys.field")).toBe(true);
    expect(useUiStore.getState().toasts.length).toBeGreaterThan(0);
  });

  it("allows edits on normal nodes", () => {
    mutations.updateNodeContent("n.root-c", "edited");
    expect(useOutlineStore.getState().nodes.get("n.root-c")!.text).toBe(
      "edited",
    );
  });
});
