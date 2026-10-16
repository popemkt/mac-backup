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
import {
  EMPTY_PROJECTION,
  type GraphChange,
  inScope,
  type PageGraphState,
  type PageProjection,
  scopedWireOf,
  SYSTEM_IDS,
  wireToOutlineMap,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  type GraphStateData,
  providePageProjection,
  useGraphStore,
  withdrawPageProjection,
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

/** The revision of a state the store handed on: the store hands its whole state. */
const revOf = (state: PageGraphState): number =>
  "rev" in state && typeof state.rev === "number" ? state.rev : -1;

describe("the editing projection", () => {
  /** What the stand-in projection holds of its own: a store, as the page's projection has. */
  const useFollowed = create<{ rev: number; root: string; changes: GraphChange[] }>()(() => ({
    rev: -1,
    root: "",
    changes: [] as GraphChange[],
  }));

  /** Each member as told, with the graph states it was handed: it reads nothing else. */
  type Told =
    | {
        readonly member: "follow";
        readonly change: GraphChange;
        readonly prev: PageGraphState;
        readonly next: PageGraphState;
      }
    | { readonly member: "leave"; readonly from: PageGraphState }
    | { readonly member: "arrive"; readonly at: "zoom" | "home"; readonly to: PageGraphState };
  let told: Array<{ readonly told: Told; readonly held: GraphStateData }> = [];

  /** Record what was told, beside the state the store held when it was told. */
  const record = (entry: Told) => told.push({ told: entry, held: graph() });

  const projection: PageProjection = {
    ...EMPTY_PROJECTION,
    follow: (change, prev, next) => {
      record({ member: "follow", change, prev, next });
      useFollowed.setState((s) => ({ rev: revOf(next), changes: [...s.changes, change] }));
    },
    leave: (from) => {
      record({ member: "leave", from });
      return null;
    },
    arrive: (at, to) => {
      record({ member: "arrive", at, to });
      useFollowed.setState({ root: to.rootNodeId });
    },
  };

  beforeEach(() => {
    told = [];
    useFollowed.setState({ rev: -1, root: "", changes: [] });
    providePageProjection(projection);
  });
  afterEach(() => withdrawPageProjection(projection));

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

  it("follow is handed the state being left and the one the store then holds", () => {
    hydrate();
    told = [];
    graph().applyTx([wire("n.new", "x")], [], { rev: 8 });
    const [entry] = told;
    if (entry?.told.member !== "follow") throw new Error("follow was not told");
    expect(entry.told.prev).toBe(entry.held);
    expect(revOf(entry.told.next)).toBe(8);
    expect(entry.told.next.wireNodes).toBe(graph().wireNodes);
  });

  it("a reader never sees the projection behind the graph", () => {
    hydrate();
    const { seen, stop } = watch();
    graph().applyTx([wire("n.new", "x")], [], { rev: 8 });
    graph().refreshFromWire(graph().wireNodes, 9);
    stop();
    expect(seen.length).toBeGreaterThan(0);
    for (const look of seen) expect(look.followed).toBeGreaterThanOrEqual(look.rev);
    expect(seen.at(-1)).toMatchObject({ rev: 9, followed: 9 });
  });

  it("a zoom hands leave the page it leaves and arrive the page it stands at", () => {
    seed();
    told = [];
    const { seen, stop } = watch();
    graph().zoomTo("n.root-a");
    stop();
    expect(told.map(({ told: t }) => t.member)).toEqual(["leave", "arrive"]);
    const [leave, arrive] = told;
    if (leave?.told.member !== "leave" || arrive?.told.member !== "arrive") throw new Error();
    expect(leave.told.from).toBe(leave.held);
    expect(leave.told.from.rootNodeId).toBe(WORKSPACE_ROOT_ID);
    expect(arrive.told.at).toBe("zoom");
    expect(arrive.told.to).toMatchObject({ rootNodeId: "n.root-a", wireNodes: graph().wireNodes });
    expect(graph().rootNodeId).toBe(arrive.told.to.rootNodeId);
    // No reader sees the page at the new root before the projection landed there.
    for (const look of seen) if (look.root === "n.root-a") expect(look.landed).toBe("n.root-a");
  });

  it("going home hands arrive the home it stands at", () => {
    seed();
    graph().zoomTo("n.root-a");
    told = [];
    graph().zoomHome();
    const [leave, arrive] = told;
    if (leave?.told.member !== "leave" || arrive?.told.member !== "arrive") throw new Error();
    expect(leave.told.from.rootNodeId).toBe("n.root-a");
    expect(arrive.told.at).toBe("home");
    expect(arrive.told.to.rootNodeId).toBe(WORKSPACE_ROOT_ID);
    expect(graph().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("a scope change lets go of the page before it is followed", () => {
    hydrate();
    told = [];
    graph().setOntologyScope("o.1");
    expect(told.map(({ told: t }) => t.member)).toEqual(["leave", "follow"]);
  });

  it("one installed after a load follows it at once; one withdrawn leaves, then is no longer told", () => {
    withdrawPageProjection(projection);
    hydrate();
    useFollowed.setState({ changes: [] });
    providePageProjection(projection);
    expect(useFollowed.getState().changes).toEqual(["load"]);
    told = [];
    withdrawPageProjection(projection);
    expect(told.map(({ told: t }) => t.member)).toEqual(["leave"]);
    graph().applyTx([wire("n.new", "x")], []);
    expect(useFollowed.getState().changes).toEqual(["load"]);
  });
});
