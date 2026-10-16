/**
 * The outline's expansion: the reader's open and closed choices, kept only
 * while the reader can undo them, kept in storage exactly as the outline
 * holds them, and read from storage at load.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { EXPANDED_STORAGE_KEY, EXPANSION_STORAGE_KEY, syncUiPlugins } from "@kb/ui-sdk";
import { fixtureGraph } from "@/api/fixture-graph";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { useGraphStore } from "@/stores/graph.store";
import { outlineNodes, useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";

beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

/** Writes to the stubbed storage since the last `writes()`. */
let writeCount = 0;
function writes(): number {
  const count = writeCount;
  writeCount = 0;
  return count;
}

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
      writeCount += 1;
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

/** The expansion storage holds, as `kb-expansion` keeps it. */
function stored(): { open: string[]; closed: string[] } {
  return JSON.parse(localStorage.getItem(EXPANSION_STORAGE_KEY) ?? '{"open":[],"closed":[]}');
}

/** Another tab's write: its whole stored expansion. */
function anotherTabStores(open: string[], closed: string[] = []): void {
  localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify({ open, closed }));
}

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
    expect(stored().closed).toContain("n.root-c");

    // The tag goes: the row cannot expand, so no choice can hold it closed.
    graph().applyTx([{ ...tagged, props: {} }], [], { rev: 3 });
    expect(collapsed("n.root-c")).toBe(false);
    expect(outline().expansion.has("n.root-c")).toBe(false);
    expect(stored().closed).not.toContain("n.root-c");
    reload();
    expect(collapsed("n.root-c")).toBe(false);
  });

  it("a row deleted and restored by an undo comes back as the reader left it", () => {
    outline().toggleCollapse("n.child-a2");
    expect(collapsed("n.child-a2")).toBe(false);
    const parent = wireOf("n.root-a");
    const row = wireOf("n.child-a2");
    graph().applyTx([{ ...parent, children: ["n.child-a1"] }], ["n.child-a2"], { rev: 2 });
    expect(outline().expansion.get("n.child-a2")).toBe(true);
    graph().applyTx([parent, row], [], { rev: 3 });
    expect(collapsed("n.child-a2")).toBe(false);
    expect(stored().open).toContain("n.child-a2");
  });

  it("storage holds exactly the outline's choices", () => {
    outline().toggleCollapse("n.root-a");
    outline().toggleCollapse("n.child-a2");
    outline().toggleCollapse("n.child-a2");
    const { open: opened, closed } = stored();
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
    anotherTabStores(["n.root-a"]);
    graph().applyTx([{ ...wireOf("n.root-c"), text: "renamed" }], [], { rev: 2 });
    expect(collapsed("n.root-a")).toBe(true);
    reload();
    expect(collapsed("n.root-a")).toBe(false);
  });

  it("a choice this tab makes keeps the other tab's choices: a save writes changes, not a snapshot", () => {
    anotherTabStores(["n.child-a2"]);
    outline().toggleCollapse("n.root-a");
    expect(stored().open.toSorted()).toEqual(["n.child-a2", "n.root-a"]);
    reload();
    expect(collapsed("n.root-a")).toBe(false);
    expect(collapsed("n.child-a2")).toBe(false);
  });

  it("a load writes nothing", () => {
    outline().toggleCollapse("n.root-a");
    writes();
    reload();
    expect(writes()).toBe(0);
  });
});

describe("the legacy stored form", () => {
  it("is read whole while no build has written the current one, and is not rewritten", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    // Open by default: a leaf (`n.child-a1`); collapsed by default: rows with
    // children (`n.root-a`, `n.child-a2`) or a field value (`n.root-b`).
    const legacy = JSON.stringify(["n.root-a", "n.child-a1", "n.child-a2"]);
    localStorage.setItem(EXPANDED_STORAGE_KEY, legacy);
    writes();
    reload();
    expect(writes()).toBe(0);
    expect(collapsed("n.root-a")).toBe(false);
    expect(collapsed("n.child-a1")).toBe(false);
    expect(collapsed("n.child-a2")).toBe(false);
    expect(collapsed("n.root-b")).toBe(true);
    expect(collapsed("n.root-c")).toBe(false);
    // The open default is no choice to keep.
    expect(outline().expansion.has("n.child-a1")).toBe(false);
    expect(localStorage.getItem(EXPANSION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(EXPANDED_STORAGE_KEY)).toBe(legacy);
  });
});
