/**
 * Debug field visibility is per node.
 *
 * The old mechanism was one device-wide `showAllFields` pref, so revealing
 * `sys.*` props on the node you were inspecting turned every other page into a
 * schema dump too. These pin the isolation and the storage shape (the same
 * id-set encoding the expanded rows use).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEBUG_FIELDS_STORAGE_KEY } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";

const g = globalThis as Record<string, unknown>;
let saved: unknown;

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("per-node debug fields", () => {
  beforeAll(() => {
    saved = g.localStorage;
    g.localStorage = fakeStorage();
  });
  afterAll(() => {
    g.localStorage = saved;
  });
  beforeEach(() => {
    (g.localStorage as Storage).clear();
    useDebugFieldsStore.setState({ ids: new Set() });
  });

  it("turning it on for one node leaves every other node alone", () => {
    const { toggle } = useDebugFieldsStore.getState();
    toggle("a");
    expect(useDebugFieldsStore.getState().isDebug("a")).toBe(true);
    expect(useDebugFieldsStore.getState().isDebug("b")).toBe(false);
  });

  it("toggles back off without disturbing its neighbours", () => {
    const { toggle } = useDebugFieldsStore.getState();
    toggle("a");
    toggle("b");
    toggle("a");
    expect(useDebugFieldsStore.getState().isDebug("a")).toBe(false);
    expect(useDebugFieldsStore.getState().isDebug("b")).toBe(true);
  });

  it("persists the id set under its own key", () => {
    useDebugFieldsStore.getState().toggle("a");
    useDebugFieldsStore.getState().toggle("b");
    const raw = (g.localStorage as Storage).getItem(DEBUG_FIELDS_STORAGE_KEY);
    expect(JSON.parse(raw!).toSorted()).toEqual(["a", "b"]);
  });

  it("replaces the set rather than mutating it, so selectors re-fire", () => {
    const before = useDebugFieldsStore.getState().ids;
    useDebugFieldsStore.getState().toggle("a");
    expect(useDebugFieldsStore.getState().ids).not.toBe(before);
  });
});
