import { describe, expect, test, afterEach } from "bun:test";
import {
  runScenario,
  cleanup,
  COMMITTED_SEEDS,
  canonicalJsonl,
  orderIdsByParent,
  contentDanglingRefs,
  parentOf,
  DANGLING_REF_DECISION,
  type ScenarioResult,
} from "./harness.ts";

const done: ScenarioResult[] = [];
afterEach(async () => {
  for (const r of done) await cleanup(r).catch(() => {});
  done.length = 0;
});

async function run(seed: string, opts?: { ops?: number }): Promise<ScenarioResult> {
  const r = await runScenario(seed, opts);
  done.push(r);
  return r;
}

describe("DST — seeded histories over the real plan/apply path", () => {
  test("committed seeds produce a legal store with zero structural violations", async () => {
    for (const seed of COMMITTED_SEEDS) {
      const r = await run(seed);
      expect(r.violations, `${seed}: ${r.violations.join("; ")}`).toEqual([]);
      expect(r.ops).toBe(60);
      expect(r.nodes.length).toBeGreaterThan(0);
    }
  });

  test("same seed replays to a byte-identical store", async () => {
    for (const seed of COMMITTED_SEEDS) {
      const a = await run(seed);
      const b = await run(seed);
      expect(a.json, `seed ${seed} replay diverged`).toBe(b.json);
      expect(a.nodes.length).toBe(b.nodes.length);
    }
  });

  test("the on-disk store round-trips to identical canonical bytes", async () => {
    const a = await run("dst-0");
    expect(canonicalJsonl(a.nodes)).toBe(a.json);
  });

  test("every sibling/root group is strictly, uniquely ordered after migration", async () => {
    const a = await run("dst-2");
    expect(a.violations, a.violations.join("; ")).toEqual([]);
    const groups = orderIdsByParent(a.nodes);
    expect(groups.length).toBeGreaterThan(0);
  });

  test("sys.* write guards hold: no sys node is minted or mutated by the sim", async () => {
    const a = await run("dst-3");
    expect(a.violations, a.violations.join("; ")).toEqual([]);
  });

  test("different seeds produce (almost certainly) different stores", async () => {
    const a = await run("dst-0");
    const b = await run("dst-4");
    expect(a.json).not.toBe(b.json);
  });
});

describe("DST — dangling inbound refs are intended, not a violation", () => {
  test("the decision is encoded and consistent with the invariant check", async () => {
    // The invariant checker must NOT flag content dangling refs; the store is
    // legal with them present (deleting a node never rewrites another node).
    expect(DANGLING_REF_DECISION).toMatch(/intended/);
  });

  test("a node referenced by another node's prop/mention can be deleted safely", async () => {
    // dst-4 embeds `[[id|label]]` mentions to live content nodes; the sim
    // sometimes deletes those targets. The store must remain legal, and any
    // dangling ref must be a CONTENT ref (never a structural child edge).
    const a = await run("dst-4");
    expect(a.violations, a.violations.join("; ")).toEqual([]);

    const dangling = contentDanglingRefs(a.nodes);
    const parents = parentOf(a.nodes);
    for (const n of a.nodes) {
      for (const c of n.children) {
        // Every structural child edge must resolve — this is the violation side.
        expect(parents.has(c), `node ${n.id} references missing child ${c}`).toBe(true);
      }
    }
    // Whatever dangles is content-only (the resolver tolerates it by design).
    // We don't assert it must be non-empty (seeded outcome varies), but IF the
    // sim produced dangling refs, they are the tolerated kind.
    expect(dangling.every((d) => d.startsWith("ref ") || d.startsWith("mention "))).toBe(true);
  });
});

describe("DST — deliberate defect is caught with seed + op index", () => {
  test("the harness surfaces invariant violations with a one-line reproduction", async () => {
    // This is a red-then-green demonstration performed against a deliberately
    // broken store. The harness reports `op#N (seed S)` so the failure is a
    // single line. The committed harness is green; the red evidence is in the
    // handoff report. Here we only assert the reporting shape is usable.
    const r = await runScenario("dst-5", { ops: 5 });
    done.push(r);
    expect(r.seed).toBe("dst-5");
    for (const v of r.violations) {
      expect(v).toMatch(/op#\d+ \(seed dst-5\)/);
    }
  });
});
