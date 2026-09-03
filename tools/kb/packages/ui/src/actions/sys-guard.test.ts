import { beforeEach, describe, expect, it } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import type { WireNode } from "@kb/contracts";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { cloneWire } from "@/lib/tx";

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

  it("transient create under a sys.* parent returns null with a toast", async () => {
    const newId = await mutations.createTransientNode("sys.tag.query", null);
    expect(newId).toBeNull();
    expect(useOutlineStore.getState().nodes.has("sys.tag.query")).toBe(true);
    expect(useUiStore.getState().toasts.some((t) => /sys\.\*/.test(t.text))).toBe(
      true,
    );
  });

  it("transient create after a sibling under a sys.* parent returns null", async () => {
    // Craft a normal node whose parent is sys.tag, then try to insert after it.
    const at = "2026-08-08T05:00:00.000Z";
    const child: WireNode = {
      id: "n.under-sys",
      text: "child",
      props: {},
      children: [],
      createdAt: at,
      updatedAt: at,
    };
    const sysTag = cloneWire(
      useOutlineStore.getState().nodes.get("sys.tag")!,
    );
    sysTag.children = [child.id];
    useOutlineStore
      .getState()
      .hydrateFromWire(
        [...fixtureGraph.nodes, sysTag, child],
        fixtureGraph.rev,
        "fixtures",
      );

    const newId = await mutations.createTransientNode("sys.tag", child.id);
    expect(newId).toBeNull();
    expect(useOutlineStore.getState().nodes.has("n.under-sys")).toBe(true);
    expect(useUiStore.getState().toasts.some((t) => /sys\.\*/.test(t.text))).toBe(
      true,
    );
  });

  it("createNodeAfter a sibling under a sys.* parent is blocked (no parent mutation)", async () => {
    // The keyboard/command create-after path splits the node and lands the new
    // row under the sibling's parent — a sys.* parent must be guarded there
    // too, not just the sibling id.
    const at = "2026-08-08T05:00:00.000Z";
    const child: WireNode = {
      id: "n.under-sys-2",
      text: "child",
      props: {},
      children: [],
      createdAt: at,
      updatedAt: at,
    };
    const sysTag = cloneWire(
      useOutlineStore.getState().nodes.get("sys.tag")!,
    );
    sysTag.children = [child.id];
    useOutlineStore
      .getState()
      .hydrateFromWire(
        [...fixtureGraph.nodes, sysTag, child],
        fixtureGraph.rev,
        "fixtures",
      );

    await mutations.createNodeAfter(child.id);
    const store = useOutlineStore.getState();
    // No new row minted, no children[] fragment on the sys.* parent.
    expect(store.nodes.has("n.under-sys-2")).toBe(true);
    expect(store.nodes.get("sys.tag")!.children).toEqual([child.id]);
    expect(
      [...store.nodes.values()].filter((n) => n.text === "").length,
    ).toBe(0);
    expect(useUiStore.getState().toasts.some((t) => /sys\.\*/.test(t.text))).toBe(
      true,
    );
  });

  it("createNodeAfter a sibling under a normal parent still works", async () => {
    const store = useOutlineStore.getState();
    const parent = store.nodes.get("n.root-a")!;
    const before = parent.children;
    await mutations.createNodeAfter("n.child-a1");
    const after = useOutlineStore.getState().nodes.get("n.root-a")!.children;
    expect(after.length).toBe(before.length + 1);
    expect(after).toEqual(["n.child-a1", expect.any(String), "n.child-a2"]);
  });

  it("transient create under a normal parent still works", async () => {
    const before = useOutlineStore.getState().nodes.get("n.root-c")!.children;
    const newId = await mutations.createTransientNode("n.root-c", null);
    expect(newId).not.toBeNull();
    const after = useOutlineStore.getState().nodes.get("n.root-c")!.children;
    expect(after.length).toBe(before.length + 1);
  });
});
