import { beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "./outline.store";

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
  useOutlineStore.getState().hydrateFromWire(wire(), 7, "fixtures");
}

describe("outline store — ontology scope", () => {
  beforeEach(() => {
    hydrate();
  });

  it("restricts the visible node set to resolved members", () => {
    const store = useOutlineStore.getState();
    expect(store.getVisibleNodes()).toContain("n.other");

    store.setOntologyScope("o.1");
    const scoped = useOutlineStore.getState();
    const visible = scoped.getVisibleNodes();
    expect(visible.length).toBeGreaterThan(0);
    for (const id of visible) {
      expect(scoped.ontologyMembers?.has(id)).toBe(true);
    }
    expect(visible).not.toContain("n.other");
    expect(visible).not.toContain("n.out");
  });

  it("makes the ontology the zoom root and home root", () => {
    useOutlineStore.getState().setOntologyScope("o.1");
    const s = useOutlineStore.getState();
    expect(s.rootNodeId).toBe("o.1");
    expect(s.homeRootId).toBe("o.1");
    expect(s.getBreadcrumbs()).toEqual([]);
  });

  it("keeps wireNodes and queryDb global — scope is a projection", () => {
    useOutlineStore.getState().setOntologyScope("o.1");
    const s = useOutlineStore.getState();
    expect(s.wireNodes.map((n) => n.id)).toContain("n.other");
    expect(s.queryDb?.nodes.has("n.other")).toBe(true);
  });

  it("scopes search for free (it iterates the projection)", () => {
    const before = useOutlineStore.getState().search("unrelated");
    expect(before.map((r) => r.id)).toEqual(["n.other"]);
    useOutlineStore.getState().setOntologyScope("o.1");
    expect(useOutlineStore.getState().search("unrelated")).toEqual([]);
    expect(
      useOutlineStore
        .getState()
        .search("alpha")
        .map((r) => r.id),
    ).toEqual(["n.a"]);
  });

  it("restores the previous root and clears membership on exit", () => {
    useOutlineStore.getState().zoomTo("n.other");
    expect(useOutlineStore.getState().rootNodeId).toBe("n.other");

    useOutlineStore.getState().setOntologyScope("o.1");
    expect(useOutlineStore.getState().rootNodeId).toBe("o.1");

    useOutlineStore.getState().setOntologyScope(null);
    const s = useOutlineStore.getState();
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
    useOutlineStore.getState().setOntologyScope("o.1");
    useOutlineStore.getState().applyTx([], ["n.other"]);
    useOutlineStore.getState().setOntologyScope(null);
    expect(useOutlineStore.getState().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("leaves the scope rather than dead-ending on a non-member jump", () => {
    useOutlineStore.getState().setOntologyScope("o.1");
    useOutlineStore.getState().zoomTo("n.other");
    const s = useOutlineStore.getState();
    expect(s.ontologyId).toBeNull();
    expect(s.rootNodeId).toBe("n.other");
  });

  it("re-resolves membership after a local optimistic edit at the same rev", () => {
    useOutlineStore.getState().setOntologyScope("o.1");
    expect([...useOutlineStore.getState().ontologyMembers!].toSorted()).toEqual(["n.a", "n.b"]);

    // Exclude n.b with no rev bump — exactly what an optimistic tx looks like.
    const onto = useOutlineStore.getState().wireNodes.find((n) => n.id === "o.1")!;
    useOutlineStore.getState().applyTx(
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
    expect(s.rev).toBe(7);
    expect([...s.ontologyMembers!]).toEqual(["n.a"]);
    expect(s.getVisibleNodes()).not.toContain("n.b");
  });

  it("a fresh hydrate clears the scope", () => {
    useOutlineStore.getState().setOntologyScope("o.1");
    hydrate();
    const s = useOutlineStore.getState();
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
    useOutlineStore.getState().hydrateFromWire(broken, 8, "fixtures");
    useOutlineStore.getState().setOntologyScope("o.bad");
    const s = useOutlineStore.getState();
    expect(s.ontologyId).toBe("o.bad");
    expect(s.ontologyWarnings.length).toBeGreaterThan(0);
    expect(s.getVisibleNodes()).toEqual([]);
  });
});
