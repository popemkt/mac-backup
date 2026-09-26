/**
 * `mergeNodeSets` over whole forests (DESIGN.md → Merge).
 *
 * Each side is the base after a few writes of the kinds the operations make —
 * edit, stamp-only touch, move (re-rank, reparent, or both), subtree delete,
 * add — so every side is a store, exactly as a branch would commit it. The
 * properties are the merge's promises: it never throws and always returns a
 * store; a concern only one side changed survives unless a conflict names the
 * node; nothing either side modified is dropped silently; and swapping the
 * sides changes nothing unless a conflict is reported.
 *
 * Red case: resolve a cycle by reverting one move to its base parent — the
 * exhaustive forest test then throws or loads a cycle.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { canonicalJsonl } from "../src/canonical.ts";
import { mergeNodeSets, type MergeResult } from "../src/merge.ts";
import type { KbNode } from "../src/model.ts";
import { compareRootOrder, rankForInsert, ranksFor, rankTx } from "../src/order.ts";
import { present } from "../src/present.ts";
import { txIntegrityError } from "../src/tx.ts";

const T0 = "2026-01-01T00:00:00.000Z";
const STAMPS = ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"] as const;

interface Draft {
  text: string;
  parent: string | null;
  order: string;
  updatedAt: string;
}
type Store = Map<string, Draft>;

type Op =
  | { kind: "edit"; target: number; text: boolean; stamp: number }
  | { kind: "move"; target: number; parent: number; position: number }
  | { kind: "delete"; target: number }
  | { kind: "add"; parent: number; position: number };

function group(store: Store, parent: string | null, excluding?: string) {
  return [...store]
    .filter(([id, d]) => d.parent === parent && id !== excluding)
    .map(([id, d]) => ({ id, order: d.order }))
    .toSorted(compareRootOrder);
}

function descends(store: Store, id: string, ancestor: string): boolean {
  for (let at: string | null = id; at !== null; at = store.get(at)?.parent ?? null) {
    if (at === ancestor) return true;
  }
  return false;
}

function apply(store: Store, op: Op, prefix: string, serial: number): void {
  const ids = [...store.keys()].toSorted();
  const pick = (n: number) => ids[n % Math.max(ids.length, 1)];
  const parentOf = (n: number) => [null, ...ids][n % (ids.length + 1)] ?? null;
  switch (op.kind) {
    case "edit": {
      const id = pick(op.target);
      const d = id === undefined ? undefined : store.get(id);
      if (d === undefined) return;
      if (op.text) d.text = `${d.text}+${prefix}`;
      d.updatedAt = present(STAMPS[op.stamp % STAMPS.length], "stamp");
      return;
    }
    case "move": {
      const id = pick(op.target);
      const d = id === undefined ? undefined : store.get(id);
      const parent = parentOf(op.parent);
      if (id === undefined || d === undefined) return;
      if (parent !== null && descends(store, parent, id)) return;
      const siblings = group(store, parent, id);
      d.order = rankForInsert(siblings, op.position % (siblings.length + 1), d.order);
      d.parent = parent;
      return;
    }
    case "delete": {
      const id = pick(op.target);
      if (id === undefined) return;
      const subtree = ids.filter((other) => descends(store, other, id));
      for (const gone of subtree) store.delete(gone);
      return;
    }
    case "add": {
      const parent = parentOf(op.parent);
      const siblings = group(store, parent);
      store.set(`${prefix}${serial}`, {
        text: `new ${prefix}${serial}`,
        parent,
        order: rankForInsert(siblings, op.position % (siblings.length + 1)),
        updatedAt: T0,
      });
      return;
    }
    default:
      op satisfies never;
  }
}

function toNodes(store: Store): KbNode[] {
  return [...store].map(([id, d]) => ({
    id,
    text: d.text,
    props: {},
    children: group(store, id).map((c) => c.id),
    order: d.order,
    createdAt: T0,
    updatedAt: d.updatedAt,
  }));
}

/** A base forest: node i hangs under an earlier node or is a root, ranked per group. */
const baseArb = fc
  .array(fc.integer({ min: -1, max: 4 }), { minLength: 1, maxLength: 5 })
  .map((choices) => {
    const chosen = choices.map((c, i) => (c >= 0 && c < i ? `n${c}` : null));
    const store: Store = new Map();
    const groups = new Map<string | null, string[]>();
    chosen.forEach((parent, i) => {
      groups.set(parent, [...(groups.get(parent) ?? []), `n${i}`]);
    });
    for (const [parent, members] of groups) {
      for (const [id, order] of ranksFor(members)) {
        store.set(id, { text: id, parent, order, updatedAt: T0 });
      }
    }
    return store;
  });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("edit" as const),
    target: fc.nat(),
    text: fc.boolean(),
    stamp: fc.nat(),
  }),
  {
    // Moves are what can join two forests into a cycle; weight them up.
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("move" as const),
      target: fc.nat(),
      parent: fc.nat(),
      position: fc.nat(),
    }),
  },
  fc.record({ kind: fc.constant("delete" as const), target: fc.nat() }),
  fc.record({ kind: fc.constant("add" as const), parent: fc.nat(), position: fc.nat() }),
);

const opsArb = fc.array(opArb, { maxLength: 4 });

function side(base: Store, ops: readonly Op[], prefix: string): Store {
  const store: Store = new Map([...base].map(([id, d]) => [id, { ...d }]));
  ops.forEach((op, i) => apply(store, op, prefix, i));
  return store;
}

const scenario = fc.tuple(baseArb, opsArb, opsArb).map(([base, oursOps, theirsOps]) => ({
  base,
  ours: side(base, oursOps, "o"),
  theirs: side(base, theirsOps, "t"),
}));

/** The store promise: a forest, and every group settled as a commit leaves it. */
function expectStore(nodes: readonly KbNode[]): void {
  expect(txIntegrityError([], { upserts: [...nodes], deletes: [] })).toBeNull();
  const settled = rankTx([], { upserts: [...nodes], deletes: [] }).upserts;
  expect(canonicalJsonl(settled)).toBe(canonicalJsonl(nodes));
}

function parents(nodes: readonly KbNode[]): Map<string, string | null> {
  const out = new Map<string, string | null>(nodes.map((n) => [n.id, null]));
  for (const n of nodes) for (const child of n.children) out.set(child, n.id);
  return out;
}

const samePosition = (a: Draft | undefined, b: Draft | undefined) =>
  a !== undefined && b !== undefined && a.parent === b.parent && a.order === b.order;

const modified = (before: Draft | undefined, after: Draft | undefined) =>
  after !== undefined &&
  (before === undefined || before.text !== after.text || !samePosition(before, after));

function merge(base: Store, ours: Store, theirs: Store): MergeResult {
  return mergeNodeSets(toNodes(base), toNodes(ours), toNodes(theirs));
}

/** A merge result, read the way the survival property asks about it. */
class Outcome {
  readonly byId: Map<string, KbNode>;
  private readonly conflicted: Set<string>;
  private readonly parentIn: Map<string, string | null>;
  private readonly result: MergeResult;

  constructor(result: MergeResult) {
    this.result = result;
    this.byId = new Map(result.nodes.map((n) => [n.id, n]));
    this.conflicted = new Set(result.conflicts.map((c) => c.id));
    this.parentIn = parents(result.nodes);
  }

  /** The group `parent` holds, in visible order. */
  private slots(parent: string | null): string[] {
    if (parent !== null) return this.byId.get(parent)?.children ?? [];
    return this.result.nodes
      .filter((n) => this.parentIn.get(n.id) === null)
      .toSorted(compareRootOrder)
      .map((n) => n.id);
  }

  /**
   * `id` sits where `changer` put it: its parent, and its side of every
   * sibling neither side moved (`stableRank` is that sibling's rank, else
   * undefined).
   */
  expectPosition(
    id: string,
    changer: Draft,
    stableRank: (sibling: string) => string | undefined,
  ): void {
    if (this.conflicted.has(id) || !this.byId.has(id)) return;
    expect(this.parentIn.get(id)).toBe(changer.parent);
    const slots = this.slots(changer.parent);
    for (const sibling of slots) {
      const order = stableRank(sibling);
      if (sibling === id || this.conflicted.has(sibling) || order === undefined) continue;
      expect(slots.indexOf(id) < slots.indexOf(sibling)).toBe(changer.order < order);
    }
  }

  /** Gone — or kept only for a descendant that a conflict names. */
  expectDeleted(id: string): void {
    const reported = (n: string): boolean =>
      this.conflicted.has(n) || (this.byId.get(n)?.children ?? []).some(reported);
    if (this.byId.has(id)) expect(reported(id)).toBe(true);
  }
}

describe("merge over whole forests (fast-check)", () => {
  test("never throws, and the result is always a store", () => {
    fc.assert(
      fc.property(scenario, ({ base, ours, theirs }) => {
        expectStore(merge(base, ours, theirs).nodes);
      }),
      { numRuns: 2000 },
    );
  });

  test("every pair of 4-node forests over a base merges to a store", () => {
    // All 125 rooted forests on four labelled nodes, ranked by id per group.
    const all = ["a", "b", "c", "d"];
    const forests: Store[] = [];
    const choose = (i: number, chosen: (string | null)[]): void => {
      if (i === all.length) {
        const store: Store = new Map();
        for (const [j, id] of all.entries()) {
          store.set(id, { text: id, parent: chosen[j] ?? null, order: "", updatedAt: T0 });
        }
        for (const id of all) {
          let at: string | null = id;
          for (let step = 0; at !== null; step++) {
            if (step > all.length) return;
            at = store.get(at)?.parent ?? null;
          }
        }
        for (const parent of [null, ...all]) {
          const members = all.filter((id) => store.get(id)?.parent === parent);
          for (const [id, order] of ranksFor(members)) present(store.get(id), id).order = order;
        }
        forests.push(store);
        return;
      }
      for (const parent of [null, ...all.filter((id) => id !== all[i])]) {
        choose(i + 1, [...chosen, parent]);
      }
    };
    choose(0, []);
    expect(forests.length).toBe(125);

    const shape = (f: Store) => all.map((id) => f.get(id)?.parent ?? "-").join("");
    // Every node a root, and the base of the cycle found in review: a -> {c, d}.
    const bases = ["----", "--aa"].map((want) => forests.find((f) => shape(f) === want));
    for (const base of bases.map((b) => present(b, "base forest"))) {
      for (const ours of forests) {
        for (const theirs of forests) expectStore(merge(base, ours, theirs).nodes);
      }
    }
  });

  test("a concern only one side changed survives, unless a conflict names the node", () => {
    fc.assert(
      fc.property(scenario, ({ base, ours, theirs }) => {
        const outcome = new Outcome(merge(base, ours, theirs));
        for (const id of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
          const [before, o, t] = [base.get(id), ours.get(id), theirs.get(id)];
          for (const [changer, other] of [
            [o, t],
            [t, o],
          ] as const) {
            if (changer === undefined || other === undefined) continue;
            if (
              before !== undefined &&
              changer.text !== before.text &&
              other.text === before.text
            ) {
              expect(outcome.byId.get(id)?.text).toBe(changer.text);
            }
            if (samePosition(before, other) && !samePosition(before, changer)) {
              outcome.expectPosition(id, changer, (sibling) => {
                const at = base.get(sibling);
                const still = [ours, theirs].every((x) => samePosition(at, x.get(sibling)));
                return still ? at?.order : undefined;
              });
            }
          }
          if (
            before !== undefined &&
            (o === undefined) !== (t === undefined) &&
            !modified(before, o ?? t)
          ) {
            outcome.expectDeleted(id);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("nothing either side added or modified is dropped", () => {
    fc.assert(
      fc.property(scenario, ({ base, ours, theirs }) => {
        const result = merge(base, ours, theirs);
        const live = new Set(result.nodes.map((n) => n.id));
        for (const [id, after] of [...ours, ...theirs]) {
          if (modified(base.get(id), after)) expect(live.has(id)).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("swapping the sides changes nothing unless a conflict is reported", () => {
    fc.assert(
      fc.property(scenario, ({ base, ours, theirs }) => {
        const forward = merge(base, ours, theirs);
        const reverse = merge(base, theirs, ours);
        expect(forward.conflicts.length === 0).toBe(reverse.conflicts.length === 0);
        if (forward.conflicts.length === 0) {
          expect(canonicalJsonl(forward.nodes)).toBe(canonicalJsonl(reverse.nodes));
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("a side merged with an untouched base, or with itself, is that side", () => {
    fc.assert(
      fc.property(scenario, ({ base, ours }) => {
        const expected = canonicalJsonl(toNodes(ours));
        for (const result of [
          merge(base, base, ours),
          merge(base, ours, base),
          merge(base, ours, ours),
        ]) {
          expect(result.conflicts).toEqual([]);
          expect(canonicalJsonl(result.nodes)).toBe(expected);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
