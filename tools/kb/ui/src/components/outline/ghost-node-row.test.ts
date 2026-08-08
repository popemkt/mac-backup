import { beforeEach, describe, expect, it, vi } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

vi.mock("ulid", () => {
  let seq = 0;
  return {
    ulid: () => {
      seq += 1;
      return `01GHOST${String(seq).padStart(18, "0")}`;
    },
  };
});

function seed() {
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
  useOutlineStore
    .getState()
    .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

function wireIds() {
  return new Set(useOutlineStore.getState().wireNodes.map((n) => n.id));
}

function newWireNodes(before: Set<string>) {
  return useOutlineStore
    .getState()
    .wireNodes.filter((n) => !before.has(n.id));
}

describe("createGhostNode (ghost row)", () => {
  beforeEach(() => {
    seed();
  });

  it("creates a forest root when parent is workspace root", async () => {
    const before = wireIds();
    await mutations.createGhostNode(WORKSPACE_ROOT_ID, null, "New root");
    const created = newWireNodes(before);
    expect(created).toHaveLength(1);
    const s = useOutlineStore.getState();
    expect(s.nodes.get(WORKSPACE_ROOT_ID)!.children).toContain(created[0]!.id);
    expect(created[0]!.text).toBe("New root");
  });

  it("creates first nested child under a parent", async () => {
    const before = wireIds();
    await mutations.createGhostNode("n.root-b", null, "First child");
    const created = newWireNodes(before);
    expect(created).toHaveLength(1);
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-b")!.children).toContain(created[0]!.id);
    expect(created[0]!.text).toBe("First child");
  });

  it("creates child under zoomed node (after last sibling)", async () => {
    useOutlineStore.getState().zoomTo("n.root-a");
    const before = wireIds();
    const zoomed = useOutlineStore.getState().nodes.get("n.root-a")!;
    const lastChild = zoomed.children[zoomed.children.length - 1]!;

    await mutations.createGhostNode("n.root-a", lastChild, "Zoomed child");

    const created = newWireNodes(before);
    expect(created).toHaveLength(1);
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-a")!.children).toContain(created[0]!.id);
    expect(created[0]!.text).toBe("Zoomed child");
    expect(s.nodes.get(WORKSPACE_ROOT_ID)!.children).not.toContain(
      created[0]!.id,
    );
  });

  it("creates exactly one node per invocation (single-create invariant)", async () => {
    const beforeCount = useOutlineStore.getState().wireNodes.length;
    await mutations.createGhostNode("n.root-c", null, "Only one");
    expect(useOutlineStore.getState().wireNodes.length).toBe(beforeCount + 1);
    await mutations.createGhostNode("n.root-c", null, "Second call");
    expect(useOutlineStore.getState().wireNodes.length).toBe(beforeCount + 2);
  });
});
