/**
 * `neighbourhoodQuery`: the nodes within N hops of a root along one edge,
 * one direction at a time, on a real DatascriptIndex. It must stay in the
 * subset `reach` compiles in (never `raw`), and it must bound by hops.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode, PropValue } from "@kb/model";
import { DatascriptIndex, neighbourhoodQuery, parseEdn } from "@kb/query";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, over: Partial<KbNode> = {}): KbNode {
  return { id, text: id, props: {}, children: [], createdAt: AT, updatedAt: AT, ...over };
}
const ref = (v: string): PropValue => ({ t: "ref", v });

/** a → b → c → d along `next`, and e → b. */
const CHAIN = [
  node("a", { props: { next: [ref("b")] } }),
  node("b", { props: { next: [ref("c")] } }),
  node("c", { props: { next: [ref("d")] } }),
  node("d"),
  node("e", { props: { next: [ref("b")] } }),
];

function ids(index: DatascriptIndex, edn: string): string[] {
  return index
    .runDatalog(edn)
    .map((row) => String(row[0]))
    .toSorted();
}

describe("neighbourhoodQuery", () => {
  const index = new DatascriptIndex(CHAIN);

  test("compiles as reach, never as raw", () => {
    expect(parseEdn(neighbourhoodQuery("b", 2, ":f/next", "out")).kind).toBe("query");
    expect(parseEdn(neighbourhoodQuery("b", 2, ":f/next", "in")).kind).toBe("query");
  });

  test("walks out along the edge, bounded by hops, without the root", () => {
    expect(ids(index, neighbourhoodQuery("b", 1, ":f/next", "out"))).toEqual(["c"]);
    expect(ids(index, neighbourhoodQuery("b", 2, ":f/next", "out"))).toEqual(["c", "d"]);
  });

  test("walks in against the edge", () => {
    expect(ids(index, neighbourhoodQuery("b", 1, ":f/next", "in"))).toEqual(["a", "e"]);
    expect(ids(index, neighbourhoodQuery("d", 2, ":f/next", "in"))).toEqual(["b", "c"]);
  });

  test("a root the graph lacks has no neighbourhood", () => {
    expect(ids(index, neighbourhoodQuery("zz", 3, ":f/next", "out"))).toEqual([]);
  });

  test("refuses a hop count that is not a positive integer", () => {
    expect(() => neighbourhoodQuery("b", 0, ":f/next", "out")).toThrow(RangeError);
    expect(() => neighbourhoodQuery("b", 1.5, ":f/next", "out")).toThrow(RangeError);
  });
});
