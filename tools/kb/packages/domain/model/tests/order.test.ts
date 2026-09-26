import { expect, test } from "bun:test";
import type { KbNode } from "../src/model.ts";
import { compareRootOrder, rankTx } from "../src/order.ts";

function node(id: string, children: string[] = [], order?: string): KbNode {
  return {
    id,
    text: id,
    props: {},
    children,
    ...(order !== undefined ? { order } : {}),
    createdAt: "",
    updatedAt: "",
  };
}

/** The whole set as a commit of every node would store it. */
function settle(nodes: KbNode[]): Map<string, KbNode> {
  const settled = new Map(nodes.map((n) => [n.id, n]));
  for (const n of rankTx(nodes, { upserts: nodes, deletes: [] }).upserts) settled.set(n.id, n);
  return settled;
}

function orderOf(byId: Map<string, KbNode>, id: string): string {
  const order = byId.get(id)?.order;
  if (order === undefined) throw new Error(`${id} unranked`);
  return order;
}

function rootIds(byId: Map<string, KbNode>): string[] {
  const kids = new Set([...byId.values()].flatMap((n) => n.children));
  return [...byId.values()]
    .filter((n) => !kids.has(n.id))
    .toSorted(compareRootOrder)
    .map((n) => n.id);
}

test("an unranked set is ranked in its visible order: children by array, roots by id", () => {
  const settled = settle([node("b", ["z", "a"]), node("z"), node("a"), node("root-z")]);
  expect(orderOf(settled, "z") < orderOf(settled, "a")).toBe(true);
  expect(rootIds(settled)).toEqual(["b", "root-z"]);
});

test("a well-ranked group is never rewritten, so a reorder survives the next commit", () => {
  // b was deliberately moved above a; rank order, not id order, is the truth.
  const nodes = [node("r-a", [], "p"), node("r-b", [], "c")];
  expect(rankTx(nodes, { upserts: nodes, deletes: [] }).upserts).toEqual(nodes);
});

test("only the gaps in a partly ranked group are filled", () => {
  const settled = settle([
    node("p", ["c1", "c2", "c3"]),
    node("c1", [], "1"),
    node("c2"),
    node("c3", [], "3"),
  ]);
  expect(orderOf(settled, "c1")).toBe("1");
  expect(orderOf(settled, "c3")).toBe("3");
  const c2 = orderOf(settled, "c2");
  expect("1" < c2 && c2 < "3").toBe(true);
});

test("roots sharing a rank are separated with one write, keeping their visible order", () => {
  const nodes = [node("n1", [], "i"), node("n2", [], "i"), node("n3", [], "m")];
  const { upserts } = rankTx(nodes, { upserts: [], deletes: [] });
  expect(upserts).toEqual([]);
  const written = rankTx(nodes, { upserts: [node("n2", [], "i")], deletes: [] }).upserts;
  const settled = new Map(nodes.map((n) => [n.id, n]));
  for (const n of written) settled.set(n.id, n);
  expect(rootIds(settled)).toEqual(["n1", "n2", "n3"]);
  expect(new Set([...settled.values()].map((n) => n.order)).size).toBe(3);
  expect(written.filter((n) => n.order !== nodes.find((m) => m.id === n.id)?.order)).toHaveLength(
    1,
  );
});

test("a child group whose ranks disagree with its array is repaired to follow the array", () => {
  const settled = settle([
    node("p", ["a", "b", "c"]),
    node("a", [], "m"),
    node("b", [], "c"),
    node("c", [], "t"),
  ]);
  const [a, b, c] = ["a", "b", "c"].map((id) => orderOf(settled, id));
  expect((a ?? "") < (b ?? "") && (b ?? "") < (c ?? "")).toBe(true);
});

test("a group holding an over-long or malformed rank is re-spread short, order kept", () => {
  const long = "zzzzzzzzzy" + "h".repeat(40);
  const settled = settle([
    node("p", ["a", "b", "c"]),
    node("a", [], "zzzzzzzzzy"),
    node("b", [], long),
    node("c", [], `${long}h`),
    node("x", [], "1000000000"),
  ]);
  const ranks = ["a", "b", "c"].map((id) => orderOf(settled, id));
  for (const rank of ranks) expect(rank.length).toBeLessThanOrEqual(12);
  expect([...ranks].toSorted()).toEqual(ranks);
  // "1000000000" ends in a zero no rank this module writes can: re-spread too.
  expect(orderOf(settled, "x")).not.toMatch(/0$/);
});

test("groups the transaction does not touch are left exactly as stored", () => {
  const nodes = [
    node("p", ["a", "b"]),
    node("a", [], "k"),
    node("b", [], "k"),
    node("q", ["c"]),
    node("c"),
  ];
  const { upserts } = rankTx(nodes, { upserts: [node("c", [], undefined)], deletes: [] });
  expect(upserts.map((n) => n.id)).toEqual(["c"]);
  expect(upserts[0]?.order).toBeDefined();
});

test("a parent's children group is touched when the parent is written", () => {
  const nodes = [node("p", ["a", "b"]), node("a"), node("b")];
  const { upserts } = rankTx(nodes, { upserts: [node("p", ["a", "b"], "i")], deletes: [] });
  expect(upserts.map((n) => n.id).toSorted()).toEqual(["a", "b", "p"]);
});
