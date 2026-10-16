/**
 * The graph store on its own: the replica, where the page stands in it (zoom
 * and scope), the write history, and what it asks of the projection the page
 * edits through. No outline is loaded here; the projection is a recording
 * stand-in, so these properties hold for any projection that installs itself.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import type { ActionInvocation, WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { SYSTEM_IDS, wireToOutlineMap, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  inScope,
  provideEditingProjection,
  scopedWireOf,
  useGraphStore,
  withdrawEditingProjection,
  type EditingProjection,
  type GraphChange,
  type GraphStateData,
} from "@/stores/graph.store";
import { resetGraphStore } from "@/test-support/graph-store";
import { brokenOntology, node, ontologyWire, secondOntology } from "@/test-support/ontology-wire";

const graph = () => useGraphStore.getState();

const wire = (id: string, text: string): WireNode => node(id, text);

function seed(): void {
  graph().hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
}

function hydrate(nodes: WireNode[] = ontologyWire()): void {
  graph().hydrateFromWire(nodes, 7, "fixtures");
}

beforeEach(() => resetGraphStore());

describe("the replica", () => {
  it("builds a DatascriptIndex replica on hydrate", () => {
    seed();
    const ix = present(graph().index, "index");
    expect(ix.getNode("n.root-a")).toBeDefined();
    expect(ix.generation).toBeGreaterThan(0);
  });

  it("applyTx upserts new nodes and bumps rev + index generation", () => {
    seed();
    const genBefore = present(graph().index, "index").generation;
    graph().applyTx([wire("n.new", "fresh node")], [], { rev: 2 });
    expect(graph().rev).toBe(2);
    expect(graph().wireNodes.some((n) => n.id === "n.new")).toBe(true);
    const ix = present(graph().index, "index");
    expect(ix.getNode("n.new")).toBeDefined();
    expect(ix.generation).toBeGreaterThan(genBefore);
  });

  it("search finds by text substring", () => {
    seed();
    expect(
      graph()
        .search("localStorage")
        .map((h) => h.id),
    ).toEqual(["n.grandchild"]);
  });
});

describe("the zoom", () => {
  it("zoomTo moves the root and zoomHome returns it home", () => {
    seed();
    graph().zoomTo("n.root-a");
    expect(graph().rootNodeId).toBe("n.root-a");
    graph().zoomHome();
    expect(graph().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("falls back to home when the zoomed node is deleted", () => {
    seed();
    graph().zoomTo("n.root-c");
    graph().applyTx([], ["n.root-c"], { rev: 2 });
    expect(graph().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });
});

describe("ontology scope", () => {
  beforeEach(() => hydrate());

  it("makes the ontology the zoom root and home root", () => {
    graph().setOntologyScope("o.1");
    expect(graph().rootNodeId).toBe("o.1");
    expect(graph().homeRootId).toBe("o.1");
  });

  it("keeps wireNodes and index global — scope is a projection", () => {
    graph().setOntologyScope("o.1");
    expect(graph().wireNodes.map((n) => n.id)).toContain("n.other");
    expect(graph().index?.getNode("n.other")).toBeDefined();
  });

  it("scopes search", () => {
    expect(
      graph()
        .search("unrelated")
        .map((r) => r.id),
    ).toEqual(["n.other"]);
    graph().setOntologyScope("o.1");
    expect(graph().search("unrelated")).toEqual([]);
    expect(
      graph()
        .search("alpha")
        .map((r) => r.id),
    ).toEqual(["n.a"]);
  });

  it("restores the previous root and clears membership on exit", () => {
    graph().zoomTo("n.other");
    expect(graph().rootNodeId).toBe("n.other");
    graph().setOntologyScope("o.1");
    expect(graph().rootNodeId).toBe("o.1");
    graph().setOntologyScope(null);
    const s = graph();
    expect(s.ontologyId).toBeNull();
    expect(s.ontologyMembers).toBeNull();
    expect(s.ontologyWarnings).toEqual([]);
    expect(s.preScopeRootId).toBeNull();
    expect(s.rootNodeId).toBe("n.other");
    expect(s.homeRootId).toBe(WORKSPACE_ROOT_ID);
  });

  it("keeps the root it entered from across a switch to another ontology", () => {
    hydrate([...ontologyWire(), secondOntology()]);
    graph().zoomTo("n.other");
    graph().setOntologyScope("o.1");
    expect(graph().preScopeRootId).toBe("n.other");
    graph().setOntologyScope("o.2");
    expect(graph().preScopeRootId).toBe("n.other");
    expect(graph().rootNodeId).toBe("o.2");
    graph().setOntologyScope(null);
    expect(graph().rootNodeId).toBe("n.other");
  });

  it("falls back to the workspace root when the previous root is gone", () => {
    graph().setOntologyScope("o.1");
    graph().applyTx([], ["n.other"]);
    graph().setOntologyScope(null);
    expect(graph().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("leaves the scope rather than dead-ending on a non-member jump", () => {
    graph().setOntologyScope("o.1");
    graph().zoomTo("n.other");
    expect(graph().ontologyId).toBeNull();
    expect(graph().rootNodeId).toBe("n.other");
  });

  it("re-resolves membership after a local optimistic edit at the same rev", () => {
    graph().setOntologyScope("o.1");
    expect([...present(graph().ontologyMembers, "ontology members")].toSorted()).toEqual([
      "n.a",
      "n.b",
    ]);
    // Exclude n.b with no rev bump — exactly what an optimistic tx looks like.
    const onto = present(
      graph().wireNodes.find((n) => n.id === "o.1"),
      "ontology wire",
    );
    graph().applyTx(
      [
        {
          ...onto,
          props: { ...onto.props, [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: "n.b" }] },
        },
      ],
      [],
    );
    expect(graph().rev).toBe(7);
    expect([...present(graph().ontologyMembers, "ontology members")]).toEqual(["n.a"]);
  });

  it("a fresh hydrate clears the scope", () => {
    graph().setOntologyScope("o.1");
    hydrate();
    expect(graph().ontologyId).toBeNull();
    expect(graph().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("a broken ontology still opens, surfacing warnings instead of throwing", () => {
    graph().hydrateFromWire([...ontologyWire(), brokenOntology()], 8, "fixtures");
    graph().setOntologyScope("o.bad");
    expect(graph().ontologyId).toBe("o.bad");
    expect(graph().ontologyWarnings.length).toBeGreaterThan(0);
  });
});

/** The ids a projection of the scope holds: what `inScope` must answer for. */
function projected(s: GraphStateData): Set<string> {
  return new Set(wireToOutlineMap(scopedWireOf(s), new Set(), s.wireNodes).keys());
}

function expectInScopeMatchesProjection(): void {
  const s = graph();
  const keys = projected(s);
  for (const id of [...s.wireNodes.map((n) => n.id), WORKSPACE_ROOT_ID, "n.unknown"]) {
    expect(inScope(s, id), id).toBe(keys.has(id));
  }
}

describe("what a scope shows", () => {
  it("unscoped, holds every node and the workspace root", () => {
    hydrate();
    expectInScopeMatchesProjection();
  });

  it("scoped, holds the members and the ontology itself", () => {
    hydrate();
    graph().setOntologyScope("o.1");
    expectInScopeMatchesProjection();
    expect(inScope(graph(), "o.1")).toBe(true);
    expect(inScope(graph(), "n.other")).toBe(false);
  });

  it("holds the same set after a write under a scope", () => {
    hydrate();
    graph().setOntologyScope("o.1");
    graph().applyTx([], ["n.b"]);
    expectInScopeMatchesProjection();
  });
});

const pair = (n: number) => ({
  undo: [{ id: "node.update", input: { n } }] as ActionInvocation[],
  redo: [{ id: "node.update", input: { n: -n } }] as ActionInvocation[],
});

describe("the write history", () => {
  it("moves one pair between the stacks on undo and redo, and a new write drops redo", () => {
    graph().recordUndo(pair(1));
    graph().recordUndo(pair(2));
    expect(graph().applyUndo()).toEqual(pair(2));
    expect(graph().redoStack).toEqual([pair(2)]);
    expect(graph().applyRedo()).toEqual(pair(2));
    expect(graph().undoStack).toEqual([pair(1), pair(2)]);
    graph().applyUndo();
    graph().recordUndo(pair(3));
    expect(graph().redoStack).toEqual([]);
    expect(graph().applyRedo()).toBeNull();
  });

  it("keeps at most fifty entries", () => {
    for (let n = 0; n < 60; n += 1) graph().recordUndo(pair(n));
    expect(graph().undoStack).toHaveLength(50);
    expect(graph().undoStack[0]).toEqual(pair(10));
  });
});

describe("the editing projection", () => {
  /** What the stand-in projection holds of its own: a store, as the page's projection has. */
  const useFollowed = create<{ rev: number; root: string; changes: GraphChange[] }>()(() => ({
    rev: -1,
    root: "",
    changes: [] as GraphChange[],
  }));
  let calls: string[] = [];

  const projection: EditingProjection = {
    follow: (change, prev, next) => {
      calls.push(`follow:${change}`);
      // It is told before the store moves: `prev` is what the store still holds.
      expect(prev.wireNodes).toBe(graph().wireNodes);
      useFollowed.setState((s) => ({ rev: next.rev, changes: [...s.changes, change] }));
    },
    leave: () => calls.push(`leave@${graph().rootNodeId}`),
    arrive: (at, root) => {
      calls.push(`arrive:${at}->${root}@${graph().rootNodeId}`);
      useFollowed.setState({ root });
    },
  };

  beforeEach(() => {
    calls = [];
    useFollowed.setState({ rev: -1, root: "", changes: [] });
    provideEditingProjection(projection);
  });
  afterEach(() => withdrawEditingProjection(projection));

  /** Every notification either store sends, as the pair of states it lets a reader see. */
  function watch(): {
    seen: Array<{ rev: number; followed: number; root: string; landed: string }>;
    stop: () => void;
  } {
    const seen: Array<{ rev: number; followed: number; root: string; landed: string }> = [];
    const look = () =>
      seen.push({
        rev: graph().rev,
        followed: useFollowed.getState().rev,
        root: graph().rootNodeId,
        landed: useFollowed.getState().root,
      });
    const offGraph = useGraphStore.subscribe(look);
    const offFollowed = useFollowed.subscribe(look);
    return {
      seen,
      stop: () => {
        offGraph();
        offFollowed();
      },
    };
  }

  it("is told once per move, by the move's kind", () => {
    hydrate();
    graph().applyTx([wire("n.new", "x")], [], { rev: 8 });
    graph().refreshFromWire(graph().wireNodes, 9);
    graph().setOntologyScope("o.1");
    expect(useFollowed.getState().changes).toEqual(["load", "tx", "resync", "scope"]);
  });

  it("is told before the store moves, so it is never behind the graph a reader sees", () => {
    hydrate();
    const { seen, stop } = watch();
    graph().applyTx([wire("n.new", "x")], [], { rev: 8 });
    graph().refreshFromWire(graph().wireNodes, 9);
    stop();
    // Each move tells the projection, then moves the store: one notice each.
    expect(seen).toEqual([
      { rev: 7, followed: 8, root: WORKSPACE_ROOT_ID, landed: "" },
      { rev: 8, followed: 8, root: WORKSPACE_ROOT_ID, landed: "" },
      { rev: 8, followed: 9, root: WORKSPACE_ROOT_ID, landed: "" },
      { rev: 9, followed: 9, root: WORKSPACE_ROOT_ID, landed: "" },
    ]);
  });

  it("a zoom lets go of the focus, then lands it at the new root, before the root moves", () => {
    seed();
    calls = [];
    const { seen, stop } = watch();
    graph().zoomTo("n.root-a");
    stop();
    expect(calls).toEqual([
      "leave@" + WORKSPACE_ROOT_ID,
      `arrive:zoom->n.root-a@${WORKSPACE_ROOT_ID}`,
    ]);
    expect(seen.map((look) => [look.root, look.landed])).toEqual([
      [WORKSPACE_ROOT_ID, "n.root-a"],
      ["n.root-a", "n.root-a"],
    ]);
  });

  it("going home lets go, then lands at home, before the root moves", () => {
    seed();
    graph().zoomTo("n.root-a");
    calls = [];
    graph().zoomHome();
    expect(calls).toEqual(["leave@n.root-a", `arrive:home->${WORKSPACE_ROOT_ID}@n.root-a`]);
    expect(graph().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("a scope change lets go of the focus before it is followed", () => {
    hydrate();
    calls = [];
    graph().setOntologyScope("o.1");
    expect(calls).toEqual([`leave@${WORKSPACE_ROOT_ID}`, "follow:scope"]);
  });

  it("one installed after a load follows it at once; one withdrawn is no longer told", () => {
    withdrawEditingProjection(projection);
    hydrate();
    useFollowed.setState({ changes: [] });
    provideEditingProjection(projection);
    expect(useFollowed.getState().changes).toEqual(["load"]);
    withdrawEditingProjection(projection);
    graph().applyTx([wire("n.new", "x")], []);
    expect(useFollowed.getState().changes).toEqual(["load"]);
  });
});
