import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { syncUiPlugins, SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { useOutlineStore } from "@/stores/outline.store";
import { outlineUiPlugin } from "@/components/outline/plugin";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ISO = "2026-08-23T00:00:00.000Z";

function node(
  id: string,
  text: string,
  props: WireNode["props"] = {},
  children: string[] = [],
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

const TAG = "t.svc";

function tagged(id: string, text: string, children: string[] = []): WireNode {
  return node(id, text, { [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG }] }, children);
}

/**
 *   #svc: n.a (child n.b, child n.out) and n.b
 *   n.out / n.other: untagged, not members
 */
function wire(): WireNode[] {
  return [
    node(TAG, "service", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    }),
    tagged("n.a", "alpha", ["n.b", "n.out"]),
    tagged("n.b", "beta"),
    node("n.out", "outsider"),
    node("n.other", "unrelated"),
    node("o.1", "Services", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
      [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: TAG }],
    }),
  ];
}

function hydrate(): void {
  useGraphStore.getState().hydrateFromWire(wire(), 7, "fixtures");
}

describe("outline store — ontology scope", () => {
  beforeEach(() => {
    hydrate();
  });

  it("restricts the visible node set to resolved members", () => {
    const store = useOutlineStore.getState();
    expect(store.getVisibleNodes()).toContain("n.other");

    useGraphStore.getState().setOntologyScope("o.1");
    const scoped = useOutlineStore.getState();
    const graph = useGraphStore.getState();
    const visible = scoped.getVisibleNodes();
    expect(visible.length).toBeGreaterThan(0);
    for (const id of visible) {
      expect(graph.ontologyMembers?.has(id)).toBe(true);
    }
    expect(visible).not.toContain("n.other");
    expect(visible).not.toContain("n.out");
  });

  it("makes the ontology the zoom root and home root", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    const s = useOutlineStore.getState();
    const graph = useGraphStore.getState();
    expect(graph.rootNodeId).toBe("o.1");
    expect(graph.homeRootId).toBe("o.1");
    expect(s.getBreadcrumbs()).toEqual([]);
  });

  it("keeps wireNodes and index global — scope is a projection", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    const s = useGraphStore.getState();
    expect(s.wireNodes.map((n) => n.id)).toContain("n.other");
    expect(s.index?.getNode("n.other")).toBeDefined();
  });

  it("scopes search for free (it iterates the projection)", () => {
    const before = useGraphStore.getState().search("unrelated");
    expect(before.map((r) => r.id)).toEqual(["n.other"]);
    useGraphStore.getState().setOntologyScope("o.1");
    expect(useGraphStore.getState().search("unrelated")).toEqual([]);
    expect(
      useGraphStore
        .getState()
        .search("alpha")
        .map((r) => r.id),
    ).toEqual(["n.a"]);
  });

  it("restores the previous root and clears membership on exit", () => {
    useGraphStore.getState().zoomTo("n.other");
    expect(useGraphStore.getState().rootNodeId).toBe("n.other");

    useGraphStore.getState().setOntologyScope("o.1");
    expect(useGraphStore.getState().rootNodeId).toBe("o.1");

    useGraphStore.getState().setOntologyScope(null);
    const s = useGraphStore.getState();
    expect(s.ontologyId).toBeNull();
    expect(s.ontologyMembers).toBeNull();
    expect(s.ontologyWarnings).toEqual([]);
    expect(s.rootNodeId).toBe("n.other");
    expect(s.homeRootId).toBe(WORKSPACE_ROOT_ID);
    // Home is the workspace again, and non-members are visible there.
    s.zoomHome();
    useOutlineStore.getState().expandAncestors("n.out");
    expect(useOutlineStore.getState().getVisibleNodes()).toContain("n.out");
  });

  it("falls back to the workspace root when the previous root is gone", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    useGraphStore.getState().applyTx([], ["n.other"]);
    useGraphStore.getState().setOntologyScope(null);
    expect(useGraphStore.getState().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("leaves the scope rather than dead-ending on a non-member jump", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    useGraphStore.getState().zoomTo("n.other");
    const s = useGraphStore.getState();
    expect(s.ontologyId).toBeNull();
    expect(s.rootNodeId).toBe("n.other");
  });

  it("re-resolves membership after a local optimistic edit at the same rev", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    expect(
      [...present(useGraphStore.getState().ontologyMembers, "ontology members")].toSorted(),
    ).toEqual(["n.a", "n.b"]);

    // Exclude n.b with no rev bump — exactly what an optimistic tx looks like.
    const onto = present(
      useGraphStore.getState().wireNodes.find((n) => n.id === "o.1"),
      "ontology wire",
    );
    useGraphStore.getState().applyTx(
      [
        {
          ...onto,
          props: {
            ...onto.props,
            [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: "n.b" }],
          },
        },
      ],
      [],
    );

    const s = useOutlineStore.getState();
    const graph = useGraphStore.getState();
    expect(graph.rev).toBe(7);
    expect([...present(graph.ontologyMembers, "ontology members")]).toEqual(["n.a"]);
    expect(s.getVisibleNodes()).not.toContain("n.b");
  });

  it("a fresh hydrate clears the scope", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    hydrate();
    const s = useGraphStore.getState();
    expect(s.ontologyId).toBeNull();
    expect(s.rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("a broken ontology still opens, surfacing warnings instead of throwing", () => {
    const broken = [
      ...wire(),
      node("o.bad", "Broken", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
        [SYSTEM_IDS.ontoExtendsField]: [{ t: "ref", v: "o.bad" }],
        [SYSTEM_IDS.ontoQueryField]: [{ t: "str", v: "[:find ?id :where" }],
      }),
    ];
    useGraphStore.getState().hydrateFromWire(broken, 8, "fixtures");
    useGraphStore.getState().setOntologyScope("o.bad");
    const s = useOutlineStore.getState();
    const graph = useGraphStore.getState();
    expect(graph.ontologyId).toBe("o.bad");
    expect(graph.ontologyWarnings.length).toBeGreaterThan(0);
    expect(s.getVisibleNodes()).toEqual([]);
  });
});
