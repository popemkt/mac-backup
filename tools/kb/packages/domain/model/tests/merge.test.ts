/**
 * Three-way merge of the node store (`mergeNodeSets`).
 *
 * The cases are the ones a real parallel wave produces: two branches each
 * appending nodes whose ULIDs land on adjacent lines, one branch editing what
 * the other left alone, one branch deleting what the other left alone, and the
 * two branches editing the same node.
 *
 * The rules are DESIGN.md → Merge. Each case below names the rule it holds;
 * the ones under "found in review" each failed an earlier implementation.
 */
import { describe, expect, test } from "bun:test";
import { canonicalJsonl } from "../src/canonical.ts";
import { mergeNodeSets } from "../src/merge.ts";
import type { KbNode } from "../src/model.ts";
import { rankForInsert, ranksFor } from "../src/order.ts";
import { txIntegrityError } from "../src/tx.ts";

function node(id: string, text: string, updatedAt = "2026-01-01T00:00:00.000Z"): KbNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

/** Ids as the store orders them, which is the only order the file has. */
function ids(nodes: readonly KbNode[]): string[] {
  return [...nodes].map((n) => n.id).toSorted();
}

/** Ranked, as every committed node is; a merge of well-ranked sides changes no rank. */
const A = { ...node("01AAA", "a"), order: "c" };
const B = { ...node("01BBB", "b"), order: "m" };

/** A store from `parent -> children` in rank order; ranks as a writer spreads them. */
function forest(shape: Record<string, readonly string[]>, all: readonly string[]): KbNode[] {
  const claimed = new Set(Object.values(shape).flat());
  const roots = all.filter((id) => !claimed.has(id));
  const rootRanks = ranksFor(roots);
  const ranks = new Map(rootRanks);
  for (const children of Object.values(shape)) {
    for (const [id, rank] of ranksFor(children)) ranks.set(id, rank);
  }
  return all.map((id) => ({
    ...node(id, id),
    children: [...(shape[id] ?? [])],
    order: ranks.get(id),
  }));
}

const valid = (nodes: readonly KbNode[]) =>
  txIntegrityError([], { upserts: [...nodes], deletes: [] });

describe("mergeNodeSets", () => {
  test("both sides append: the tail collision git cannot resolve", () => {
    const base = [A];
    const ours = [A, node("01OUR", "from our branch")];
    const theirs = [A, node("01THEIR", "from their branch")];

    const merged = mergeNodeSets(base, ours, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.nodes)).toEqual(["01AAA", "01OUR", "01THEIR"]);
  });

  test("a side that equals base yields to the side that changed", () => {
    const base = [A, B];
    const ours = [A, B];
    const theirs = [A, node("01BBB", "b, edited", "2026-02-01T00:00:00.000Z")];

    const merged = mergeNodeSets(base, ours, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes.find((n) => n.id === "01BBB")?.text).toBe("b, edited");
  });

  test("a deletion of a base-identical node is honoured", () => {
    const merged = mergeNodeSets([A, B], [A, B], [A]);

    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.nodes)).toEqual(["01AAA"]);
  });

  test("both changed: the newer updatedAt wins, whichever side it is on", () => {
    const base = [B];
    const oursNewer = mergeNodeSets(
      base,
      [node("01BBB", "ours", "2026-03-01T00:00:00.000Z")],
      [node("01BBB", "theirs", "2026-02-01T00:00:00.000Z")],
    );
    expect(oursNewer.conflicts).toEqual([]);
    expect(oursNewer.nodes.at(0)?.text).toBe("ours");

    const theirsNewer = mergeNodeSets(
      base,
      [node("01BBB", "ours", "2026-02-01T00:00:00.000Z")],
      [node("01BBB", "theirs", "2026-03-01T00:00:00.000Z")],
    );
    expect(theirsNewer.conflicts).toEqual([]);
    expect(theirsNewer.nodes.at(0)?.text).toBe("theirs");
  });

  test("both sides made the identical edit: agreement, not conflict", () => {
    const edited = node("01BBB", "same edit", "2026-02-01T00:00:00.000Z");
    const merged = mergeNodeSets([B], [edited], [edited]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes.at(0)?.text).toBe("same edit");
  });

  test("both sides deleted it: agreement, not conflict", () => {
    const merged = mergeNodeSets([A, B], [A], [A]);

    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.nodes)).toEqual(["01AAA"]);
  });

  test("deleted on one side, edited on the other: reported, and nothing lost", () => {
    const merged = mergeNodeSets([B], [], [node("01BBB", "edited", "2026-02-01T00:00:00.000Z")]);

    expect(merged.conflicts).toEqual([{ id: "01BBB", reason: "deleted-and-modified" }]);
    expect(merged.nodes.at(0)?.text).toBe("edited");
  });

  test("a conflicted child deletion keeps its surviving parent membership", () => {
    const parent = { ...node("parent", "parent"), children: ["a"], order: "m" };
    const child = { ...node("a", "a"), order: "c" };
    const merged = mergeNodeSets(
      [parent, child],
      [
        { ...parent, text: "parent edited", updatedAt: "2026-02-01T00:00:00.000Z" },
        { ...child, text: "child edited", updatedAt: "2026-02-01T00:00:00.000Z" },
      ],
      [{ ...parent, children: [] }],
    );

    expect(merged.conflicts).toEqual([{ id: "a", reason: "deleted-and-modified" }]);
    expect(merged.nodes.find((n) => n.id === "parent")?.children).toEqual(["a"]);
    expect(merged.nodes.find((n) => n.id === "a")?.text).toBe("child edited");
  });

  test("a stamp-only touch does not conflict with deletion", () => {
    const merged = mergeNodeSets([B], [], [{ ...B, updatedAt: "2026-02-01T00:00:00.000Z" }]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes).toEqual([]);
  });

  test("a rank-preserving reparent conflicts with deletion and remains linked", () => {
    const oldParent = { ...node("old", "old"), order: "c", children: ["a"] };
    const newParent = { ...node("new", "new"), order: "m" };
    const child = { ...node("a", "a"), order: "k" };
    const base = [oldParent, newParent, child];
    const ours = [
      { ...oldParent, children: [] },
      { ...newParent, children: ["a"] },
      { ...child, order: rankForInsert([], 0, child.order) },
    ];
    const theirs = [{ ...oldParent, children: [] }, newParent];

    expect(ours[2]?.order).toBe("k");
    const merged = mergeNodeSets(base, ours, theirs);
    expect(merged.conflicts).toContainEqual({ id: "a", reason: "deleted-and-modified" });
    expect(merged.nodes.find((n) => n.id === "a")).toBeDefined();
    expect(merged.nodes.find((n) => n.id === "new")?.children).toEqual(["a"]);
    expect(txIntegrityError(base, { upserts: merged.nodes, deletes: [] })).toBeNull();
  });

  test("a kept parent drops its stamp-only child when the subtree is deleted", () => {
    const parent = { ...node("parent", "parent"), order: "m", children: ["a"] };
    const child = { ...node("a", "a"), order: "k" };
    const base = [parent, child];
    const merged = mergeNodeSets(
      base,
      [
        { ...parent, text: "edited", updatedAt: "2026-02-01T00:00:00.000Z" },
        { ...child, updatedAt: "2026-02-01T00:00:00.000Z" },
      ],
      [],
    );

    expect(merged.conflicts).toContainEqual({ id: "parent", reason: "deleted-and-modified" });
    expect(merged.nodes.find((n) => n.id === "a")).toBeUndefined();
    expect(merged.nodes.find((n) => n.id === "parent")?.children).toEqual([]);
    expect(txIntegrityError(base, { upserts: merged.nodes, deletes: ["a"] })).toBeNull();
  });

  test("a changed ancestor deleted with its subtree has its own conflict", () => {
    const grand = { ...node("grand", "grand"), order: "c", children: ["parent"] };
    const parent = { ...node("parent", "parent"), order: "m", children: ["a"] };
    const child = { ...node("a", "a"), order: "k" };
    const merged = mergeNodeSets(
      [grand, parent, child],
      [grand, { ...parent, text: "edited parent" }, { ...child, text: "edited child" }],
      [],
    );

    expect(merged.conflicts).toContainEqual({ id: "parent", reason: "deleted-and-modified" });
    expect(merged.conflicts).toContainEqual({ id: "a", reason: "deleted-and-modified" });
    expect(merged.nodes.find((n) => n.id === "grand")?.children).toEqual(["parent"]);
  });

  test("independent moves cannot merge into a parent cycle", () => {
    const first = { ...node("first", "first"), order: "c" };
    const second = { ...node("second", "second"), order: "m" };
    const base = [first, second];
    const merged = mergeNodeSets(
      base,
      [first, { ...second, children: ["first"] }],
      [{ ...first, children: ["second"] }, second],
    );

    expect(txIntegrityError(base, { upserts: merged.nodes, deletes: [] })).toBeNull();
    // The cycle adopts ours: theirs' move of `second` is the one undone, and named.
    expect(merged.conflicts).toEqual([{ id: "second", reason: "modified-both-position" }]);
    expect(merged.nodes.find((n) => n.id === "second")?.children).toEqual(["first"]);
  });

  test("cycle repair does not orphan a descendant of a deleted ancestor", () => {
    const child = { ...node("a", "a"), order: "k" };
    const ancestor = { ...node("b", "b"), order: "c", children: ["a"] };
    const other = { ...node("c", "c"), order: "m" };
    const base = [child, ancestor, other];
    const ours = [child, { ...other, children: ["a"] }];
    const theirs = [{ ...child, children: ["c"] }, ancestor, other];

    expect(txIntegrityError(base, { upserts: ours, deletes: ["b"] })).toBeNull();
    expect(txIntegrityError(base, { upserts: theirs, deletes: [] })).toBeNull();
    const merged = mergeNodeSets(base, ours, theirs);
    expect(txIntegrityError(base, { upserts: merged.nodes, deletes: ["b"] })).toBeNull();
    expect(merged.nodes.find((n) => n.id === "c")?.children).toEqual(["a"]);
  });

  test("cycle repair can take an alternate side position when reverting one move is insufficient", () => {
    const first = { ...node("a", "a"), order: "c" };
    const second = { ...node("b", "b"), order: "m" };
    const root = { ...node("c", "c"), order: "t", children: ["a", "b"] };
    const base = [first, second, root];
    const ours = [{ ...first, children: ["b"] }, second, { ...root, children: ["a"] }];
    const theirs = [
      { ...first, children: ["c"] },
      { ...second, children: ["a"] },
      { ...root, children: [] },
    ];

    expect(txIntegrityError(base, { upserts: ours, deletes: [] })).toBeNull();
    expect(txIntegrityError(base, { upserts: theirs, deletes: [] })).toBeNull();
    const merged = mergeNodeSets(base, ours, theirs);
    expect(txIntegrityError(base, { upserts: merged.nodes, deletes: [] })).toBeNull();
  });

  test("a conflicted child keeps its parent when the deletion removed the subtree", () => {
    const parent = { ...node("parent", "parent"), children: ["a"], order: "m" };
    const child = { ...node("a", "a"), order: "c" };
    const merged = mergeNodeSets(
      [parent, child],
      [parent, { ...child, text: "edited", updatedAt: "2026-02-01T00:00:00.000Z" }],
      [],
    );

    expect(merged.nodes.find((n) => n.id === "parent")?.children).toEqual(["a"]);
    expect(merged.nodes.find((n) => n.id === "a")?.text).toBe("edited");
  });

  test("both edited to the same stamp: no basis to choose, so it is reported", () => {
    const merged = mergeNodeSets(
      [B],
      [node("01BBB", "ours", "2026-02-01T00:00:00.000Z")],
      [node("01BBB", "theirs", "2026-02-01T00:00:00.000Z")],
    );

    expect(merged.conflicts).toEqual([{ id: "01BBB", reason: "modified-both-same-stamp" }]);
    expect(merged.nodes.at(0)?.text).toBe("ours");
  });

  test("re-ranking and editing a node on opposite sides preserves both", () => {
    const long = "zzzzzzzzzyhhhhhhhhhhhhhhhhhhhh";
    const at = "2026-09-26T13:51:00.000Z";
    const base = ["a", "b", "c"].map((id) => ({ ...node(id, id, at), order: long }));
    const ours = base.map((n, index) => ({ ...n, order: ["zkk", "zpp", "zuu"][index] }));
    const theirs = base.map((n) =>
      n.id === "a" ? { ...n, text: "a edited", updatedAt: "2026-09-26T14:51:00.000Z" } : n,
    );

    const merged = mergeNodeSets(base, ours, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes.map((n) => [n.id, n.order, n.text])).toEqual([
      ["a", "zkk", "a edited"],
      ["b", "zpp", "b"],
      ["c", "zuu", "c"],
    ]);
  });

  test("a parent's child order survives a concurrent content edit", () => {
    const parent = { ...node("parent", "parent"), children: ["a", "b"], order: "c" };
    const children = [
      { ...node("a", "a"), order: "c" },
      { ...node("b", "b"), order: "m" },
    ];
    const merged = mergeNodeSets(
      [parent, ...children],
      [{ ...parent, children: ["b", "a"] }, ...children],
      [{ ...parent, text: "edited", updatedAt: "2026-02-01T00:00:00.000Z" }, ...children],
    );

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes.find((n) => n.id === "parent")).toMatchObject({
      children: ["b", "a"],
      text: "edited",
    });
    const byId = new Map(merged.nodes.map((n) => [n.id, n]));
    expect((byId.get("b")?.order ?? "") < (byId.get("a")?.order ?? "")).toBe(true);
  });

  test("two divergent positions require a decision, not a content timestamp", () => {
    const merged = mergeNodeSets(
      [B],
      [{ ...B, order: "n" }],
      [{ ...B, order: "p", updatedAt: "2026-03-01T00:00:00.000Z" }],
    );

    expect(merged.conflicts).toEqual([{ id: B.id, reason: "modified-both-position" }]);
    expect(merged.nodes[0]?.order).toBe("n");
  });

  test("only one side changed: byte-identical to taking that side wholesale", () => {
    const base = [A, B];
    const theirs = [
      A,
      { ...node("01BBB", "b, edited", "2026-02-01T00:00:00.000Z"), order: "m" },
      { ...node("01CCC", "c"), order: "t" },
    ];

    const merged = mergeNodeSets(base, base, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(canonicalJsonl(merged.nodes)).toBe(canonicalJsonl(theirs));
  });

  test("two branches that each appended a root from one read merge with distinct ranks", () => {
    // Both ranked their new root as the step after B's: the collision that
    // left groups of roots sharing a rank before the merge settled them.
    const ours = [A, B, { ...node("01OUR", "ours"), order: "n" }];
    const theirs = [A, B, { ...node("01THEIR", "theirs"), order: "n" }];

    const merged = mergeNodeSets([A, B], ours, theirs);

    expect(merged.conflicts).toEqual([]);
    const ranks = merged.nodes.map((n) => n.order);
    expect(new Set(ranks).size).toBe(4);
    // Nothing that already fitted moved: A, B and the first "n" keep theirs.
    expect(
      merged.nodes
        .filter((n) => n.order !== "n" && n.order !== "c" && n.order !== "m")
        .map((n) => n.id),
    ).toEqual(["01THEIR"]);
  });

  test("output is canonical: sorted by id, one line each, trailing newline", () => {
    const merged = mergeNodeSets([], [node("01ZZZ", "z")], [node("01AAA", "a")]);
    const body = canonicalJsonl(merged.nodes);

    expect(body.endsWith("\n")).toBe(true);
    expect(
      body
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l).id as string),
    ).toEqual(["01AAA", "01ZZZ"]);
    expect(body).not.toContain(" ");
  });

  describe("found in review", () => {
    test("two valid forests whose moves join into a cycle merge to one of them", () => {
      // Base a -> {c, d}; ours moves d under c; theirs is b -> d -> c -> a.
      const all = ["a", "b", "c", "d"];
      const base = forest({ a: ["c", "d"] }, all);
      const ours = forest({ a: ["c"], c: ["d"] }, all);
      const theirs = forest({ b: ["d"], d: ["c"], c: ["a"] }, all);
      for (const side of [base, ours, theirs]) expect(valid(side)).toBeNull();

      const merged = mergeNodeSets(base, ours, theirs);

      expect(valid(merged.nodes)).toBeNull();
      const parents = Object.fromEntries(
        merged.nodes.flatMap((n) => n.children.map((child) => [child, n.id])),
      );
      expect(parents).toEqual({ c: "a", d: "c" });
      expect(merged.conflicts.map((c) => c.reason)).toEqual(
        merged.conflicts.map(() => "modified-both-position"),
      );
      expect(merged.conflicts.map((c) => c.id).toSorted()).toEqual(["a", "c", "d"]);
    });

    test("a re-rank against a reparent of the same node is one position conflict", () => {
      // Ours moves a after b inside p; theirs moves a, rank kept, under q.
      const p = { ...node("p", "p"), order: "c", children: ["a", "b"] };
      const q = { ...node("q", "q"), order: "m", children: ["x"] };
      const a = { ...node("a", "a"), order: "c" };
      const b = { ...node("b", "b"), order: "m" };
      const x = { ...node("x", "x"), order: "t" };
      const base = [p, q, a, b, x];
      const ours = [{ ...p, children: ["b", "a"] }, q, { ...a, order: "t" }, b, x];
      const theirs = [{ ...p, children: ["b"] }, { ...q, children: ["a", "x"] }, a, b, x];

      const merged = mergeNodeSets(base, ours, theirs);

      expect(merged.conflicts).toEqual([{ id: "a", reason: "modified-both-position" }]);
      // Ours' whole position — its parent and its rank — not ours' rank under theirs' parent.
      const byId = new Map(merged.nodes.map((n) => [n.id, n]));
      expect(byId.get("p")?.children).toEqual(["b", "a"]);
      expect(byId.get("q")?.children).toEqual(["x"]);
      expect(byId.get("a")?.order).toBe("t");
    });

    test("a reorder of the parent's array against a reparent is one position conflict", () => {
      // Ours reorders p's children without touching a rank; theirs moves a to q.
      const p = { ...node("p", "p"), order: "c", children: ["a", "b"] };
      const q = { ...node("q", "q"), order: "m" };
      const a = { ...node("a", "a"), order: "c" };
      const b = { ...node("b", "b"), order: "m" };
      const base = [p, q, a, b];

      const merged = mergeNodeSets(
        base,
        [{ ...p, children: ["b", "a"] }, q, a, b],
        [{ ...p, children: ["b"] }, { ...q, children: ["a"] }, a, b],
      );

      expect(merged.conflicts).toEqual([{ id: "a", reason: "modified-both-position" }]);
      const byId = new Map(merged.nodes.map((n) => [n.id, n]));
      expect(byId.get("p")?.children).toEqual(["b", "a"]);
      expect(byId.get("q")?.children).toEqual([]);
    });

    test("an edited leaf against a deleted subtree is one conflict, on the leaf", () => {
      const grand = { ...node("grand", "grand"), order: "c", children: ["parent"] };
      const parent = { ...node("parent", "parent"), order: "m", children: ["leaf", "other"] };
      const leaf = { ...node("leaf", "leaf"), order: "c" };
      const other = { ...node("other", "other"), order: "m" };
      const base = [grand, parent, leaf, other];

      const merged = mergeNodeSets(
        base,
        [grand, parent, { ...leaf, text: "edited", updatedAt: "2026-02-01T00:00:00.000Z" }, other],
        [],
      );

      expect(merged.conflicts).toEqual([{ id: "leaf", reason: "deleted-and-modified" }]);
      expect(ids(merged.nodes)).toEqual(["grand", "leaf", "parent"]);
      expect(merged.nodes.find((n) => n.id === "parent")?.children).toEqual(["leaf"]);
      expect(valid(merged.nodes)).toBeNull();
    });

    test("a side that is not a forest still merges to a store", () => {
      // No store holds a cycle; the merge stays total over one all the same.
      const a = { ...node("a", "a"), order: "c" };
      const b = { ...node("b", "b"), order: "m" };
      const merged = mergeNodeSets(
        [a, b],
        [
          { ...a, children: ["b"] },
          { ...b, children: ["a"] },
        ],
        [a, b],
      );

      expect(valid(merged.nodes)).toBeNull();
      expect(merged.conflicts).toEqual([{ id: "a", reason: "modified-both-position" }]);
    });

    test("a child added under a parent the other side deleted brings it back, reported", () => {
      const parent = { ...node("parent", "parent"), order: "m" };
      const merged = mergeNodeSets(
        [parent],
        [
          { ...parent, children: ["new"] },
          { ...node("new", "new"), order: "m" },
        ],
        [],
      );

      expect(merged.conflicts).toEqual([{ id: "parent", reason: "deleted-and-modified" }]);
      expect(merged.nodes.find((n) => n.id === "parent")?.children).toEqual(["new"]);
    });
  });
});
