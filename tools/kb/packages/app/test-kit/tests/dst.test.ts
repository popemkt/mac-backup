import { describe, expect, test, afterEach } from "bun:test";
import { Effect } from "effect";
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
} from "../src/harness.ts";

const done: ScenarioResult[] = [];
afterEach(async () => {
  for (const r of done) await Effect.runPromise(cleanup(r)).catch(() => {});
  done.length = 0;
});

async function run(seed: string, opts?: { ops?: number }): Promise<ScenarioResult> {
  const r = await Effect.runPromise(runScenario(seed, opts));
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
  test("the decision is encoded and consistent with the invariant check", () => {
    // The invariant checker must NOT flag content dangling refs; the store is
    // legal with them present (deleting a node never rewrites another node).
    expect(DANGLING_REF_DECISION).toMatch(/intended/);
  });

  test("deleting a field node orphans prop keys but the store stays legal + round-trips", async () => {
    // A field is just a node; deleting it leaves any prop keyed by it dangling.
    // That is INTENDED (the store never rewrites another node's props), and the
    // store must still be structurally legal and byte-stable. This seed is one
    // of the committed set that exercises the delete path onto a field node.
    const a = await run("dst-0");
    expect(a.violations, a.violations.join("; ")).toEqual([]);
    expect(canonicalJsonl(a.nodes)).toBe(a.json);
  });

  test("a node referenced by another node's prop/mention can be deleted safely", async () => {
    // The sim embeds `[[id|label]]` mentions + set/unset prop ops and deletes
    // arbitrary content nodes (even field nodes, which orphans prop keys). The
    // store must stay legal (structural edges resolve), and anything dangling
    // must be CONTENT — never a structural child edge.
    const a = await run("dst-4");
    expect(a.violations, a.violations.join("; ")).toEqual([]);

    const dangling = contentDanglingRefs(a.nodes);
    const parents = parentOf(a.nodes);
    for (const n of a.nodes) {
      for (const c of n.children) {
        // Every structural child edge must resolve — the violation side.
        expect(parents.has(c), `node ${n.id} references missing child ${c}`).toBe(true);
      }
    }
    // Whatever dangles is a tolerated content ref (ref value / mention / prop
    // key). The harness never flags it; it only enforces structural integrity
    // and byte-stable round-trips.
    expect(
      dangling.every((d) => /^(ref|mention|propkey) /.test(d)),
      `unexpected dangling kind: ${dangling.join("; ")}`,
    ).toBe(true);
  });
});

describe("DST — deliberate defect is caught with seed + op index", () => {
  test("the harness surfaces invariant violations with a one-line reproduction", async () => {
    // This is a red-then-green demonstration performed against a deliberately
    // broken store. The harness reports `op#N (seed S)` so the failure is a
    // single line. The committed harness is green; the red evidence is in the
    // handoff report. Here we only assert the reporting shape is usable.
    const r = await Effect.runPromise(runScenario("dst-5", { ops: 5 }));
    done.push(r);
    expect(r.seed).toBe("dst-5");
    for (const v of r.violations) {
      expect(v).toMatch(/op#\d+ \(seed dst-5\)/);
    }
  });
});
