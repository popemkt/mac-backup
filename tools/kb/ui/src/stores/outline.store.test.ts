import { beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "./outline.store";

function seed() {
  useOutlineStore
    .getState()
    .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("outline store (WireNode adaptation)", () => {
  beforeEach(() => {
    useOutlineStore.setState({
      nodes: new Map(),
      wireNodes: [],
      queryDb: null,
      rev: 0,
      rootNodeId: WORKSPACE_ROOT_ID,
      homeRootId: WORKSPACE_ROOT_ID,
      activeNodeId: null,
      selectedNodeId: null,
      cursorPosition: 0,
      loadSource: null,
      loadError: null,
    });
  });

  it("hydrates forest roots under virtual workspace root", () => {
    seed();
    const root = useOutlineStore.getState().nodes.get(WORKSPACE_ROOT_ID)!;
    expect(root.children).toEqual(
      expect.arrayContaining(["n.root-a", "n.root-b", "n.root-c"]),
    );
    expect(root.children).not.toContain("sys.tag");
    expect(root.children).not.toContain("tag.todo");
  });

  it("preserves ordered children arrays (no fractional order)", () => {
    seed();
    const a = useOutlineStore.getState().nodes.get("n.root-a")!;
    expect(a.children).toEqual(["n.child-a1", "n.child-a2"]);
    expect(a).not.toHaveProperty("order");
  });

  it("resolves tags from sys.f.type refs", () => {
    seed();
    const a = useOutlineStore.getState().nodes.get("n.root-a")!;
    expect(a.tags).toEqual([{ id: "tag.todo", name: "todo" }]);
  });

  it("activate / select / deactivate", () => {
    seed();
    useOutlineStore.getState().activateNode("n.root-a", 3);
    expect(useOutlineStore.getState().activeNodeId).toBe("n.root-a");
    expect(useOutlineStore.getState().cursorPosition).toBe(3);
    useOutlineStore.getState().selectNode("n.root-b");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
    useOutlineStore.getState().deactivateNode();
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
  });

  it("toggleCollapse hides descendants in visible list", () => {
    seed();
    expect(useOutlineStore.getState().getVisibleNodes()).toEqual([
      "n.root-a",
      "n.child-a1",
      "n.child-a2",
      "n.grandchild",
      "n.root-b",
      "n.root-c",
    ]);
    useOutlineStore.getState().toggleCollapse("n.root-a");
    expect(useOutlineStore.getState().getVisibleNodes()).toEqual([
      "n.root-a",
      "n.root-b",
      "n.root-c",
    ]);
  });

  it("does nothing when toggling a leaf", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-b");
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.collapsed).toBe(
      false,
    );
  });

  it("zoomTo changes root and breadcrumbs", () => {
    seed();
    useOutlineStore.getState().zoomTo("n.root-a");
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-a");
    expect(useOutlineStore.getState().getBreadcrumbs()).toEqual([
      { id: "n.root-a", text: "Ship kb ui shell" },
    ]);
    useOutlineStore.getState().zoomHome();
    expect(useOutlineStore.getState().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("search finds by text substring", () => {
    seed();
    const hits = useOutlineStore.getState().search("localStorage");
    expect(hits.map((h) => h.id)).toEqual(["n.grandchild"]);
  });

  it("getPrevious / getNext skip collapsed children", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-a");
    expect(useOutlineStore.getState().getNextVisibleNode("n.root-a")).toBe(
      "n.root-b",
    );
    expect(useOutlineStore.getState().getPreviousVisibleNode("n.root-b")).toBe(
      "n.root-a",
    );
  });

  it("builds a DataScript query db on hydrate", () => {
    seed();
    const db = useOutlineStore.getState().queryDb;
    expect(db).not.toBeNull();
    expect(db!.ids.toEid.has("n.root-a")).toBe(true);
    expect(db!.rev).toBe(1);
  });
});
