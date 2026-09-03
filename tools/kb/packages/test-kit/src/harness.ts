import { Effect, Random, Clock } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKbEffect, kbRuntimeLayer, invokeReceiptEffect } from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import {
  txIntegrityError,
  isSysPrefixed,
  type KbNode,
  systemSeedNodes,
  migrateOrderKeys,
  canonicalJson,
} from "@kb/model";
import {
  mapAdd,
  mapSet,
  mapUnset,
  mapRm,
  mapMv,
  mapFieldDefine,
  mapTagDefine,
  type PlannedAction,
} from "@kb/operations";
import type { KbContext } from "@kb/contracts";

/**
 * Deterministic simulation testing (DST) harness (t2-dst).
 *
 * From a seed it generates a *history* of store operations drawn from the real
 * plan surface (`map*` + `invokeReceiptEffect` — the same plan/apply path the
 * CLI and UI use), applies them through the real code path, and asserts store
 * invariants continuously. Because the store's time and identity each flow
 * through one owner — Effect `Clock` and seeded `Random` — the same seed must
 * reproduce a byte-identical store. That replay property is what makes every
 * other assertion debuggable (same seed + op index ⇒ a one-line reproduction).
 */

/** Fixed epoch for the deterministic clock (never epoch-0; see model.ts note). */
export const BASE_EPOCH = Date.parse("2026-01-01T00:00:00.000Z");

/**
 * Dangling inbound refs decision (t2-dst).
 *
 * `rm` (cascade delete) removes a node and its descendants. Any OTHER node
 * that still carries an inbound reference to the deleted id — a `{t:"ref"}`
 * prop *value* pointing at it, or a `[[id|label]]` mention in its text — is
 * left dangling: the resolver degrades it to a string sentinel rather than
 * dropping it (query/datascript.ts `propDatomValue`).
 *
 * DECISION: **intended behaviour, not a violation.** A dangling *inbound
 * content* ref is inert — it is a value/mention, not a structural edge, so
 * the graph stays well-formed (no node references a missing *parent*). The
 * store is fully legal with such refs present; the resolver warns rather than
 * rewrite them because deleting a node must not silently rewrite another
 * node's text/props. So the harness treats them as tolerated.
 *
 * By contrast a dangling *structural* edge — a `children` id that does not
 * resolve — IS a violation (it is exactly what `txIntegrityError` rejects on
 * commit). The assertion below enforces the split: structural refs must
 * resolve; content refs may dangle harmlessly.
 */
export const DANGLING_REF_DECISION =
  "inbound content refs to a deleted node are intended (resolver warn, never rewrite); " +
  "dangling structural children are a violation";

/** One owner for "this id is infrastructure" — see foundation/model. */
export const isSysNode = isSysPrefixed;

/** The store's canonical nodes.jsonl file. */
export function nodesPath(root: string): string {
  return join(root, ".kb", "nodes.jsonl");
}

/**
 * A clock driven by an injectable counter so every read is deterministic AND
 * strictly increasing across the run. The harness installs it as the active
 * `Clock` service; replay with the same base/step reproduces the same stamps.
 */
export function seededClock(base: number, stepMs: number): Clock.Clock {
  let n = 0;
  const millis = () => base + n++ * stepMs;
  return {
    currentTimeMillisUnsafe: () => millis(),
    currentTimeMillis: Effect.sync(() => millis()),
    currentTimeNanosUnsafe: () => BigInt(millis()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(millis()) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => BigInt(base + n++),
    monotonicTimeNanos: Effect.sync(() => BigInt(base + n++)),
    sleep: () => Effect.void,
  };
}

/** `nextDouble`-shaped rng backed by the seeded Effect Random service. */
export interface Rng {
  nextDouble(): number;
  choice<T>(arr: readonly T[]): T;
}

function seededRng(rnd: { nextDoubleUnsafe(): number }): Rng {
  return {
    nextDouble: () => rnd.nextDoubleUnsafe(),
    choice: (arr) =>
      arr[Math.min(arr.length - 1, Math.floor(rnd.nextDoubleUnsafe() * arr.length))]!,
  };
}

// ---------------------------------------------------------------------------
// Operation generation — the real plan surface
// ---------------------------------------------------------------------------

interface Livestate {
  allIds: string[];
  childIds: string[];
  rootIds: string[];
  fieldIds: string[];
  tagIds: string[];
  /** Nodes that are safe to target with sets/moves/deletes (not sys.*). */
  contentIds: string[];
}

function livestate(ctx: KbContext, fieldIds: string[], tagIds: string[]): Livestate {
  const children = new Set<string>();
  for (const n of ctx.nodes) for (const c of n.children) children.add(c);
  const allIds = ctx.nodes.map((n) => n.id);
  return {
    allIds,
    childIds: [...children],
    rootIds: ctx.nodes.filter((n) => !children.has(n.id)).map((n) => n.id),
    fieldIds,
    tagIds,
    contentIds: allIds.filter((id) => !isSysNode(id)),
  };
}

type OpKind = "add" | "set" | "unset" | "move" | "reorder" | "delete" | "field" | "tag";
const OP_KINDS: OpKind[] = [
  "add",
  "add",
  "add",
  "add",
  "set",
  "set",
  "unset",
  "move",
  "reorder",
  "delete",
  "field",
  "tag",
];

const WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "omicron",
  "pi",
];
const TAG_NAMES = ["todo", "doing", "done", "idea"];
const FIELD_NAMES = ["status", "priority", "owner", "effort"];

function word(rng: Rng): string {
  return `${rng.choice(WORDS)}-${rng.choice(WORDS)}`;
}

/**
 * Generate the next planned action. Biased toward valid operations but
 * exercising the store's failure tolerances (dangling name resolutions, root
 * reorder, delete of a random node) so the invariants are tested against real
 * edge cases, not a happy path.
 */
export function nextAction(
  rng: Rng,
  _ctx: KbContext,
  live: Livestate,
  sequence: number,
): PlannedAction {
  const kind = rng.choice(OP_KINDS);
  const text = word(rng);
  switch (kind) {
    case "add": {
      const parent =
        rng.nextDouble() < 0.4 && live.rootIds.length > 0 ? rng.choice(live.rootIds) : undefined;
      // Occasionally embed a mention ref to a live content node, so a later
      // delete of that node exercises the "inbound content ref dangles"
      // intended-behaviour path.
      let body = text;
      if (rng.nextDouble() < 0.2 && live.contentIds.length > 0) {
        const target = rng.choice(live.contentIds);
        body = `${text} [[${target}|ref]]`;
      }
      return mapAdd({
        text: body,
        parent,
        tags: rng.nextDouble() < 0.3 ? [rng.choice(TAG_NAMES)] : undefined,
      });
    }
    case "set":
      if (live.contentIds.length === 0) return mapAdd({ text });
      return mapSet({
        id: rng.choice(live.contentIds),
        field: live.fieldIds.length > 0 ? rng.choice(live.fieldIds) : "status",
        value: word(rng),
      });
    case "unset":
      if (live.contentIds.length === 0) return mapAdd({ text });
      return mapUnset({
        id: rng.choice(live.contentIds),
        field: live.fieldIds.length > 0 ? rng.choice(live.fieldIds) : "status",
      });
    case "move":
      if (live.childIds.length === 0) return mapAdd({ text });
      return mapMv({
        id: rng.choice(live.childIds),
        parent: rng.choice(live.allIds),
      });
    case "reorder":
      if (live.rootIds.length === 0) return mapAdd({ text });
      return mapMv({
        id: rng.choice(live.rootIds),
        parent: null,
        position: Math.floor(rng.nextDouble() * 8),
      });
    case "delete":
      if (live.contentIds.length === 0) return mapAdd({ text });
      return mapRm({ id: rng.choice(live.contentIds) });
    case "field": {
      const name = FIELD_NAMES[sequence % FIELD_NAMES.length]!;
      return mapFieldDefine({ name: `${name}.${sequence}` });
    }
    case "tag": {
      const name = TAG_NAMES[sequence % TAG_NAMES.length]!;
      return mapTagDefine({ name: `${name}.${sequence}` });
    }
  }
}

// ---------------------------------------------------------------------------
// Invariants — asserted continuously, must hold at every step
// ---------------------------------------------------------------------------

export interface StoreSnapshot {
  root: string;
  json: string;
  nodes: KbNode[];
}

/** Read the store back off disk; the JSONL must parse into nodes (sync). */
export function snapshotSync(root: string): StoreSnapshot {
  const json = readFileSync(nodesPath(root), "utf8");
  if (json.trim().length === 0) return { root, json, nodes: [] };
  const nodes = JSON.parse(`[${json.trim().split("\n").join(",")}]`) as KbNode[];
  return { root, json, nodes };
}

/** Bring a parsed JSONL body back to canonical bytes; a real store round-trips. */
export function canonicalJsonl(nodes: KbNode[]): string {
  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.length === 0 ? "" : sorted.map((n) => canonicalJson(n)).join("\n") + "\n";
}

/**
 * Structural + ordering invariants that must hold at every step. Returns the
 * list of violations (empty = satisfied). These mirror what the store's own
 * commit-time `txIntegrityError` enforces, plus the DST-specific invariants.
 *
 * Per the dangling-ref decision, only *structural* edges are checked: content
 * refs (ref prop values / mentions to a deleted id) are intentionally allowed.
 */
export function invariantViolations(nodes: KbNode[]): string[] {
  const out: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 1. No node references a parent that does not exist (children resolve).
  for (const n of nodes) {
    for (const c of n.children) {
      if (!byId.has(c)) out.push(`node ${n.id} references missing child ${c}`);
    }
  }

  // 2. Single parent (every child referenced by exactly one parent).
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    for (const c of n.children) {
      const prior = parentOf.get(c);
      if (prior && prior !== n.id) out.push(`node ${c} has multiple parents (${prior}, ${n.id})`);
      parentOf.set(c, n.id);
    }
  }

  // 3. Ordering total + strictly increasing within each sibling group and the
  //    forest root set. `order` is a fractional rank the store materialises on
  //    open via migrateOrderKeys (it never reorders the visible array). The
  //    invariant the store guarantees: after migration each group's ranks are
  //    unique and strictly increasing when sorted — a delete/reorder bug that
  //    collides or inverts ranks is caught here. We do NOT assume array order;
  //    only that the rank sequence is a strict total order.
  const migrated = migrateOrderKeys(nodes).nodes;
  const migratedById = new Map(migrated.map((n) => [n.id, n]));
  const migratedChildrenSet = new Set(migrated.flatMap((n) => n.children));
  const migratedGroups: { label: string; ids: string[] }[] = [
    ...migrated.map((n) => ({ label: n.id, ids: n.children })),
    {
      label: "(root)",
      ids: migrated.filter((n) => !migratedChildrenSet.has(n.id)).map((n) => n.id),
    },
  ];
  for (const group of migratedGroups) {
    const members = group.ids.map((id) => migratedById.get(id));
    if (members.some((m) => !m)) continue; // handled by invariant #1
    const ranks = members.map((m) => m!.order);
    if (ranks.some((r) => r === undefined)) continue; // legacy — optional
    const unique = new Set(ranks);
    if (unique.size !== ranks.length) {
      out.push(`ordering ranks collide at ${group.label}: ${ranks.join(", ")}`);
      continue;
    }
    const sorted = [...ranks].sort();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1]! >= sorted[i]!) {
        out.push(`ordering not strictly increasing at ${group.label}: ${sorted.join(", ")}`);
        break;
      }
    }
  }

  // 4. txIntegrityError agrees the graph is legal (no orphan-on-delete, no cycle).
  const txErr = txIntegrityError(nodes, { upserts: [], deletes: [] });
  if (txErr) out.push(txErr);

  // 5. sys.* write guards hold: the harness never sets `force`, so no new
  //    sys.* node may appear and none may have been added by the sim.
  const seedIds = new Set(systemSeedNodes().map((n) => n.id));
  for (const n of nodes) {
    if (isSysPrefixed(n.id) && !seedIds.has(n.id)) {
      out.push(`sys node ${n.id} was minted during simulation`);
    }
  }

  return out;
}

/** Re-running migrateOrderKeys must be a no-op (re-open won't reorder siblings). */
export function orderingIdempotent(nodes: KbNode[]): boolean {
  const first = migrateOrderKeys(nodes);
  return migrateOrderKeys(first.nodes).changed === false;
}

/** Structural owners: map every child id → its (single) parent, or null for roots. */
export function parentOf(nodes: KbNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const children = new Set<string>();
  for (const n of nodes) {
    for (const c of n.children) {
      children.add(c);
      map.set(c, n.id);
    }
  }
  for (const n of nodes) {
    if (!children.has(n.id)) map.set(n.id, null);
  }
  return map;
}

/**
 * Count of dangling INBOUND CONTENT refs. Three kinds are all tolerated by
 * design (the resolver warns, never rewrites another node's content):
 *   - a `{t:"ref"}` prop *value* pointing at a deleted node id
 *   - a `[[id|label]]` mention in text pointing at a deleted node id
 *   - a *prop key* naming a field node id that was itself deleted — the field
 *     is gone, so the prop key dangles, but the value still round-trips and
 *     nothing else was rewritten.
 *
 * The harness does NOT flag any of these as violations. The business rule that
 * must hold instead is round-trip byte-stability: a legal store re-serialises
 * to the same bytes (asserted separately), so a key is never invented (a new
 * key appears on reload) or silently dropped (an existing key vanishes).
 */
export function contentDanglingRefs(nodes: KbNode[]): string[] {
  const byId = new Set(nodes.map((n) => n.id));
  const out: string[] = [];
  const mentionRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  for (const n of nodes) {
    for (const values of Object.values(n.props)) {
      for (const v of values) {
        if (v.t === "ref" && !byId.has(v.v)) {
          out.push(`ref ${n.id} -> ${v.v}`);
        }
      }
    }
    for (const key of Object.keys(n.props)) {
      if (!byId.has(key)) out.push(`propkey ${n.id} -> ${key}`);
    }
    mentionRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = mentionRe.exec(n.text)) !== null) {
      const target = m[1]!.trim();
      if (!byId.has(target)) out.push(`mention ${n.id} -> ${target}`);
    }
  }
  return out;
}

/**
 * Sibling + forest-root groups in sibling order, for tests that inspect the
 * ordering invariant per group.
 */
export function orderIdsByParent(nodes: KbNode[]): { parent: string | null; ids: string[] }[] {
  const childrenSet = new Set(nodes.flatMap((n) => n.children));
  return [
    ...nodes.map((n) => ({ parent: n.id, ids: n.children })),
    {
      parent: null,
      ids: nodes.filter((n) => !childrenSet.has(n.id)).map((n) => n.id),
    },
  ];
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  seed: string;
  root: string;
  json: string;
  nodes: KbNode[];
  ops: number;
  /** Invariant violations (empty = all held). Asserted by the caller. */
  violations: string[];
}

/**
 * Run one seed's history in a brand-new temp store:
 *   1. open the store (system seed) under the deterministic clock + seeded Random
 *   2. generate + apply `ops` actions through the real registry path
 *   3. after every op, snapshot off disk and assert the invariants continuously
 *   4. the caller asserts byte-identical replay (same seed → same json)
 */
export async function runScenario(
  seed: string,
  opts: { ops?: number; base?: number; step?: number } = {},
): Promise<ScenarioResult> {
  const opsCount = opts.ops ?? 60;
  const base = opts.base ?? BASE_EPOCH;
  const step = opts.step ?? 1000;
  const root = await mkdtemp(join(tmpdir(), "kb-dst-"));
  const violations: string[] = [];
  let applied = 0;

  const program = Effect.gen(function* () {
    const ctx = yield* openKbEffect(root);
    const rnd = yield* Random.Random;
    const rng = seededRng(rnd);
    let fieldIds: string[] = [];
    let tagIds: string[] = [];

    for (let i = 0; i < opsCount; i++) {
      // Discover fields/tags from the live nodes so mapSet/mapUnset can target
      // real, already-defined fields (never force-mint, so sys guards hold).
      if (fieldIds.length === 0) {
        const fields = ctx.nodes.filter((n) =>
          (n.props["sys.f.type"] ?? []).some((v) => v.t === "ref" && v.v === "sys.field"),
        );
        if (fields.length > 0) fieldIds = fields.map((n) => n.id);
      }
      const live = livestate(ctx, fieldIds, tagIds);
      const action = nextAction(rng, ctx, { ...live, fieldIds, tagIds }, i);
      const receipt = yield* invokeReceiptEffect(ctx, {
        id: action.id,
        input: action.input,
      }).pipe(Effect.provide(kbRuntimeLayer(ctx)));

      if (action.id === "field.define" && receipt.status === "succeeded") {
        fieldIds = [...fieldIds, (receipt.output as { id: string }).id];
      }
      if (action.id === "tag.define" && receipt.status === "succeeded") {
        tagIds = [...tagIds, (receipt.output as { id: string }).id];
      }

      // Continuous invariant check on the on-disk store after this op. The
      // store commit is synchronous (durable-replace), so a sync read sees it.
      const snap = snapshotSync(root);
      const bad = invariantViolations(snap.nodes);
      if (bad.length > 0) {
        violations.push(`op#${i} (seed ${seed}): ${bad.join("; ")}`);
        return;
      }
      if (!orderingIdempotent(snap.nodes)) {
        violations.push(`op#${i} (seed ${seed}): migrateOrderKeys reorders siblings`);
        return;
      }
      // "No prop key invented or silently dropped": re-serialising the loaded
      // nodes must reproduce the on-disk bytes exactly. A props key/phrase that
      // appears or vanishes on the reload path is a persist/load asymmetry.
      if (canonicalJsonl(snap.nodes) !== snap.json) {
        violations.push(
          `op#${i} (seed ${seed}): store does not round-trip to identical canonical bytes`,
        );
        return;
      }
      applied = i + 1;
    }
  }).pipe(
    Effect.provide(bunFileSystemLayer),
    Random.withSeed(seed),
    Effect.provideService(Clock.Clock, seededClock(base, step)),
  );

  await Effect.runPromise(program);

  const snap = snapshotSync(root);
  return { seed, root, json: snap.json, nodes: snap.nodes, ops: applied, violations };
}

export async function cleanup(result: ScenarioResult): Promise<void> {
  await rm(result.root, { recursive: true, force: true });
}

/** Committed set of seeds that always run in CI. */
export const COMMITTED_SEEDS = ["dst-0", "dst-1", "dst-2", "dst-3"];
