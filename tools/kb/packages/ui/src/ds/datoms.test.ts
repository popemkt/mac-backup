import { describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { buildIdMap, nodesToDatoms, extractMentions } from "./datoms";
import { buildQueryDb } from "./db";

describe("nodesToDatoms", () => {
  it("assigns stable eids by sorted node id", () => {
    const ids = buildIdMap([{ id: "b" }, { id: "a" }]);
    expect(ids.toEid.get("a")).toBe(1);
    expect(ids.toEid.get("b")).toBe(2);
    expect(ids.toId.get(1)).toBe("a");
  });

  it("emits ordered children vector + child refs", () => {
    const { datoms, ids } = nodesToDatoms(fixtureGraph.nodes);
    const parentEid = ids.toEid.get("n.root-a")!;
    const childVec = datoms.find(
      (d) => d[0] === parentEid && d[1] === ":node/children",
    );
    expect(childVec?.[2]).toEqual([
      ids.toEid.get("n.child-a1"),
      ids.toEid.get("n.child-a2"),
    ]);
    const childRefs = datoms.filter(
      (d) => d[0] === parentEid && d[1] === ":node/child",
    );
    expect(childRefs).toHaveLength(2);
  });

  it("maps prop refs to eids when target exists", () => {
    const { datoms, ids, schema } = nodesToDatoms(fixtureGraph.nodes);
    const nodeEid = ids.toEid.get("n.root-a")!;
    const tagEid = ids.toEid.get("tag.todo")!;
    const typeDatom = datoms.find(
      (d) => d[0] === nodeEid && d[1] === ":f/sys.f.type",
    );
    expect(typeDatom?.[2]).toBe(tagEid);
    expect(schema[":f/sys.f.type"]).toEqual({
      ":db/valueType": ":db.type/ref",
      ":db/cardinality": ":db.cardinality/many",
    });
  });

  it("extracts [[mentions]] from text", () => {
    expect(extractMentions("see [[sys.tag|tag]] and [[n.root-a]]")).toEqual([
      "sys.tag",
      "n.root-a",
    ]);
  });

  it("buildQueryDb initializes a DataScript db", () => {
    const qdb = buildQueryDb(fixtureGraph.nodes, 7);
    expect(qdb.rev).toBe(7);
    expect(qdb.nodes.size).toBe(fixtureGraph.nodes.length);
    expect(qdb.db).toBeTruthy();
  });
});
