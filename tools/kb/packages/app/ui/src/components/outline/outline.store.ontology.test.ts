/**
 * The outline under an ontology scope: what it projects and shows. The scope
 * itself — membership, the zoom and home roots, search — is the graph
 * store's, and `graph.store.test.ts` holds it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { syncUiPlugins, SYSTEM_IDS } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { useOutlineStore } from "./outline.store";
import { outlineUiPlugin } from "./plugin";
import { brokenOntology, ontologyWire } from "@/test-support/ontology-wire";
import { syncPagePlugins } from "@/test-support/page-plugins";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

function hydrate(): void {
  useGraphStore.getState().hydrateFromWire(ontologyWire(), 7, "fixtures");
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

  it("shows no breadcrumbs at the ontology, its zoom root", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    expect(useOutlineStore.getState().getBreadcrumbs()).toEqual([]);
  });

  it("shows non-members again once the scope is left", () => {
    useGraphStore.getState().setOntologyScope("o.1");
    useGraphStore.getState().setOntologyScope(null);
    // Home is the workspace again, and non-members are visible there.
    useGraphStore.getState().zoomHome();
    useOutlineStore.getState().expandAncestors("n.out");
    expect(useOutlineStore.getState().getVisibleNodes()).toContain("n.out");
  });

  it("re-projects when a local optimistic edit at the same rev excludes a member", () => {
    useGraphStore.getState().setOntologyScope("o.1");
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
    expect(useOutlineStore.getState().getVisibleNodes()).not.toContain("n.b");
  });

  it("a broken ontology opens with no rows", () => {
    useGraphStore.getState().hydrateFromWire([...ontologyWire(), brokenOntology()], 8, "fixtures");
    useGraphStore.getState().setOntologyScope("o.bad");
    expect(useOutlineStore.getState().getVisibleNodes()).toEqual([]);
  });
});
