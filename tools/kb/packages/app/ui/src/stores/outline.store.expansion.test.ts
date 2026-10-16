/**
 * The outline's expansion: the reader's open and closed choices, kept only
 * while the reader can undo them, kept in storage exactly as the outline
 * holds them, and read from storage at load.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { COLLAPSED_STORAGE_KEY, EXPANDED_STORAGE_KEY, syncUiPlugins } from "@kb/ui-sdk";
import { fixtureGraph } from "@/api/fixture-graph";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { useGraphStore } from "@/stores/graph.store";
import { outlineNodes, useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";

beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

/** A tab's storage, to read back what the outline kept and to write as another tab would. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const graph = () => useGraphStore.getState();
const outline = () => useOutlineStore.getState();
const wireOf = (id: string): WireNode =>
  present(
    graph().wireNodes.find((n) => n.id === id),
    id,
  );
const collapsed = (id: string) => present(outlineNodes().get(id), id).collapsed;

/** A fresh load of the graph the page holds now, as a reload reads it. */
function reload(): void {
  graph().hydrateFromWire(structuredClone(graph().wireNodes), graph().rev, "fixtures");
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetOutlineStore();
  graph().hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
});
afterEach(() => vi.unstubAllGlobals());

describe("expansion keeps only choices the reader can undo", () => {
  it("a closed row that loses its children and gains them again is never stuck closed", () => {
    // Open, then close: closing returns the row to its default, so no choice is kept.
    outline().toggleCollapse("n.child-a2");
    outline().toggleCollapse("n.child-a2");
    expect(collapsed("n.child-a2")).toBe(true);
    expect(outline().expansion.has("n.child-a2")).toBe(false);

    // It loses its children: a leaf shows open, and there is nothing to toggle.
    graph().applyTx([{ ...wireOf("n.child-a2"), children: [] }], [], { rev: 2 });
    expect(collapsed("n.child-a2")).toBe(false);
    expect(outline().expansion.has("n.child-a2")).toBe(false);

    // It gains them again while shown open: it stays open, as a choice the reader can undo.
    graph().applyTx([{ ...wireOf("n.child-a2"), children: ["n.grandchild"] }], [], { rev: 3 });
    expect(collapsed("n.child-a2")).toBe(false);
    outline().toggleCollapse("n.child-a2");
    expect(collapsed("n.child-a2")).toBe(true);
    outline().toggleCollapse("n.child-a2");
    expect(collapsed("n.child-a2")).toBe(false);

    // A reload shows what the page showed.
    reload();
    expect(collapsed("n.child-a2")).toBe(false);
  });

  it("a row closed against an open default reopens once it cannot expand, and storage agrees", () => {
    // A tagged row with no value yet: its tag's field slot makes it expandable, open by default.
    const tagged = {
      ...wireOf("n.root-c"),
      props: { "sys.f.type": [{ t: "ref" as const, v: "tag.todo" }] },
    };
    graph().applyTx([tagged], [], { rev: 2 });
    expect(collapsed("n.root-c")).toBe(false);
    outline().toggleCollapse("n.root-c");
    expect(collapsed("n.root-c")).toBe(true);
    expect(outline().expansion.get("n.root-c")).toBe(false);
    // Storage keeps the closed choice, so a reload shows it closed too.
    expect(localStorage.getItem(COLLAPSED_STORAGE_KEY)).toContain("n.root-c");

    // The tag goes: the row cannot expand, so no choice can hold it closed.
    graph().applyTx([{ ...tagged, props: {} }], [], { rev: 3 });
    expect(collapsed("n.root-c")).toBe(false);
    expect(outline().expansion.has("n.root-c")).toBe(false);
    expect(localStorage.getItem(COLLAPSED_STORAGE_KEY)).not.toContain("n.root-c");
    reload();
    expect(collapsed("n.root-c")).toBe(false);
  });

  it("storage holds exactly the outline's choices", () => {
    outline().toggleCollapse("n.root-a");
    outline().toggleCollapse("n.child-a2");
    outline().toggleCollapse("n.child-a2");
    const opened: string[] = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) ?? "[]");
    const closed: string[] = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "[]");
    const held = [...outline().expansion];
    expect(new Set(opened)).toEqual(new Set(held.filter(([, open]) => open).map(([id]) => id)));
    expect(new Set(closed)).toEqual(new Set(held.filter(([, open]) => !open).map(([id]) => id)));
    expect(opened).toEqual(["n.root-a"]);
  });
});

describe("each tab keeps its own expansion while open; storage seeds it at load", () => {
  it("another tab's write is not merged in by a graph move, and is read at the next load", () => {
    expect(collapsed("n.root-a")).toBe(true);
    // Another tab opens `n.root-a`: it writes the shared storage.
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(["n.root-a"]));
    graph().applyTx([{ ...wireOf("n.root-c"), text: "renamed" }], [], { rev: 2 });
    expect(collapsed("n.root-a")).toBe(true);
    reload();
    expect(collapsed("n.root-a")).toBe(false);
  });
});
