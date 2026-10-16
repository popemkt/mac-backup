/**
 * How many node maps a move builds, a reader's read of the rows included:
 * one per snapshot. Unscoped, the outline's rows are the schema itself, or a
 * view over it that opens and closes rows (`withExpansion`), which builds no
 * map; so the schema's build is the only pass over the wire. A toggle builds
 * nothing; a scope builds only its own, smaller projection.
 *
 * A build is counted where every node map is built: `wireToOutlineMap`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { schemaOf, wireToOutlineMap } from "@kb/ui-sdk";
import type * as UiSdk from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { outlineNodes, useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { node, ontologyWire } from "@/test-support/ontology-wire";

// The schema builds inside the kit, so the mock names the module that builds,
// not the barrel that re-exports it.
vi.mock("../../../../kit/ui-sdk/src/lib/graph-view", async (importOriginal) => {
  const actual = await importOriginal<Pick<typeof UiSdk, "wireToOutlineMap">>();
  return { ...actual, wireToOutlineMap: vi.fn(actual.wireToOutlineMap) };
});

const graph = () => useGraphStore.getState();

/** The maps built since the last call, once a reader has read the rows. */
function builds(): number {
  outlineNodes();
  const count = vi.mocked(wireToOutlineMap).mock.calls.length;
  vi.mocked(wireToOutlineMap).mockClear();
  return count;
}

function hydrate(nodes: WireNode[] = ontologyWire()): void {
  graph().hydrateFromWire(nodes, 7, "fixtures");
  builds();
}

beforeEach(() => {
  resetOutlineStore();
  builds();
});

describe("node maps built per move", () => {
  it("a load builds the graph once", () => {
    graph().hydrateFromWire(ontologyWire(), 7, "fixtures");
    expect(builds()).toBe(1);
  });

  it("an unscoped transaction builds the graph once", () => {
    hydrate();
    graph().applyTx([node("n.new", "x")], [], { rev: 8 });
    expect(builds()).toBe(1);
    expect(outlineNodes().has("n.new")).toBe(true);
  });

  it("an unscoped resync builds the graph once", () => {
    hydrate();
    graph().refreshFromWire([...graph().wireNodes, node("n.new", "x")], 9);
    expect(builds()).toBe(1);
  });

  it("a toggle builds nothing: the rows are a view over the schema", () => {
    hydrate();
    expect(outlineNodes()).toBe(schemaOf(graph()));
    const parent = graph().wireNodes.find((n) => n.children.length > 0);
    expect(parent).toBeDefined();
    useOutlineStore.getState().toggleCollapse(parent?.id ?? "");
    expect(builds()).toBe(0);
    expect(outlineNodes()).not.toBeInstanceOf(Map);
    expect(outlineNodes().get(parent?.id ?? "")?.collapsed).toBe(false);
  });

  it("entering a scope builds the scope's projection alone; leaving it builds nothing", () => {
    hydrate();
    graph().setOntologyScope("o.1");
    expect(builds()).toBe(1);
    graph().setOntologyScope(null);
    expect(builds()).toBe(0);
  });
});
