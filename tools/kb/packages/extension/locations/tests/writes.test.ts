/**
 * What each location action writes in the home store, planned over its
 * nodes: the mints once, a location once per path, recency as list order,
 * and forgetting that never reaches past the home store.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { LOCATION_IDS, forgetWrites, locationEntries, registerWrites } from "../src/index.ts";
import { defaultLabel, locationMints } from "../src/writes.ts";

const AT = "2026-01-01T00:00:00.000Z";

/** The home store after applying `upserts` and `deletes` over `nodes`. */
function apply(
  nodes: readonly KbNode[],
  write: { upserts: readonly KbNode[]; deletes: readonly string[] },
): KbNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of write.upserts) byId.set(node.id, node);
  for (const id of write.deletes) byId.delete(id);
  return [...byId.values()];
}

function register(nodes: readonly KbNode[], path: string, id: string, label?: string) {
  const write = registerWrites(nodes, { path, id, ...(label === undefined ? {} : { label }) }, AT);
  return { write, nodes: apply(nodes, write) };
}

describe("location writes", () => {
  test("the first register mints the tag, the field and the list; later ones mint nothing", () => {
    const first = register([], "/work/a", "l.a");
    const minted = first.write.upserts.map((node) => node.id);
    expect(minted).toEqual(
      expect.arrayContaining([LOCATION_IDS.tag, LOCATION_IDS.pathField, LOCATION_IDS.list, "l.a"]),
    );
    const byId = new Map(first.nodes.map((node) => [node.id, node]));
    expect(locationMints((id) => byId.get(id), AT)).toEqual([]);
    const second = register(first.nodes, "/work/b", "l.b");
    expect(second.write.upserts.map((node) => node.id).toSorted()).toEqual(
      [LOCATION_IDS.list, "l.b"].toSorted(),
    );
  });

  test("registering a path already listed writes nothing, and keeps its node", () => {
    const { nodes } = register([], "/work/a", "l.a");
    const again = register(nodes, "/work/a", "l.other");
    expect(again.write).toEqual({ id: "l.a", upserts: [], deletes: [] });
  });

  test("registering ranks a location first, and opening order is the list's", () => {
    let nodes = register([], "/work/a", "l.a").nodes;
    nodes = register(nodes, "/work/b", "l.b").nodes;
    expect(locationEntries(nodes).map((entry) => entry.id)).toEqual(["l.b", "l.a"]);
    nodes = register(nodes, "/work/a", "unused").nodes;
    expect(locationEntries(nodes).map((entry) => entry.id)).toEqual(["l.a", "l.b"]);
  });

  test("a label given for a known location renames it", () => {
    const { nodes } = register([], "/work/a", "l.a");
    const renamed = register(nodes, "/work/a", "unused", "Alpha");
    expect(locationEntries(renamed.nodes)[0]?.label).toBe("Alpha");
  });

  test("a default label is the directory's name, or its parent's and its own when taken", () => {
    expect(defaultLabel("/x/.dotfiles", new Set())).toBe(".dotfiles");
    expect(defaultLabel("/x/tools/kb", new Set(["kb"]))).toBe("tools/kb");
    let nodes = register([], "/x/one/kb", "l.one").nodes;
    nodes = register(nodes, "/x/two/kb", "l.two").nodes;
    expect(locationEntries(nodes).map((entry) => entry.label)).toEqual(["two/kb", "kb"]);
  });

  test("pinned locations come first, then the list, then a node tagged by hand", () => {
    let nodes = register([], "/work/a", "l.a").nodes;
    nodes = register(nodes, "/work/b", "l.b").nodes;
    const byHand: KbNode = {
      id: "l.hand",
      text: "hand",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: LOCATION_IDS.tag }],
        [LOCATION_IDS.pathField]: [
          { t: "str", v: "/work/c" },
          { t: "str", v: "/work/d" },
        ],
      },
      children: [],
      createdAt: AT,
      updatedAt: AT,
    };
    const pin: KbNode = {
      id: "pin.a",
      text: "",
      props: { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "l.a" }] },
      children: [],
      createdAt: AT,
      updatedAt: AT,
    };
    const pinned: KbNode = {
      id: SYSTEM_IDS.pinnedRoot,
      text: "Pinned",
      props: {},
      children: ["pin.a"],
      createdAt: AT,
      updatedAt: AT,
    };
    const entries = locationEntries([...nodes, byHand, pin, pinned]);
    expect(entries.map(({ id, pinned: p }) => [id, p])).toEqual([
      ["l.a", true],
      ["l.b", false],
      ["l.hand", false],
    ]);
    expect(entries[2]?.paths).toEqual(["/work/c", "/work/d"]);

    const forgot = forgetWrites([...nodes, byHand, pin, pinned], "l.a", AT);
    expect(forgot?.deletes.toSorted()).toEqual(["l.a", "pin.a"]);
    const after = apply([...nodes, byHand, pin, pinned], forgot ?? { upserts: [], deletes: [] });
    expect(after.find((node) => node.id === SYSTEM_IDS.pinnedRoot)?.children).toEqual([]);
    expect(after.find((node) => node.id === LOCATION_IDS.list)?.children).toEqual(["l.b"]);
  });

  test("forgetting what is no location writes nothing", () => {
    const { nodes } = register([], "/work/a", "l.a");
    expect(forgetWrites(nodes, LOCATION_IDS.list, AT)).toBeNull();
    expect(forgetWrites(nodes, "l.none", AT)).toBeNull();
  });
});
