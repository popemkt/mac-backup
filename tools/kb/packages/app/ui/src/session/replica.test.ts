/**
 * The replica's sync machine, one row per transition of the table in
 * DESIGN-UI.md → Replica sync. A row starts from a rev and a graph, feeds
 * steps (network events and local writes), and states the phase, rev, network
 * moves and visible graph that must follow.
 */
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { BrowserReplica, type Hold, type SyncEvent, type SyncPhase } from "./replica";

function node(id: string, text = id): WireNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

type Images = Record<string, string | null>;

const frame = (rev: number, images: Images = {}): SyncEvent => ({
  op: "tx",
  rev,
  upserts: Object.entries(images)
    .filter(([, text]) => text !== null)
    .map(([id, text]) => node(id, text ?? "")),
  deletes: Object.entries(images)
    .filter(([, text]) => text === null)
    .map(([id]) => id),
});
const snapshot = (rev: number, images: Images = { "n.a": "a" }): SyncEvent => ({
  op: "snapshot",
  snapshot: {
    rev,
    nodes: Object.entries(images)
      .filter(([, text]) => text !== null)
      .map(([id, text]) => node(id, text ?? "")),
  },
});
const hello = (rev: number): SyncEvent => ({ op: "hello", rev });
const required = (head: number): SyncEvent => ({ op: "snapshot-required", head });
const failed: SyncEvent = { op: "snapshot-failed" };
const retry: SyncEvent = { op: "retry" };
const reconcile: SyncEvent = { op: "reconcile" };

/** A local write: commit `images` locally and hold them as `hold` (joined if open). */
type Write = { write: string; images: Images };
type Step =
  | SyncEvent
  | Write
  | { settle: string; rev: number }
  | { drop: string }
  | { stillHeld: true };

interface Row {
  name: string;
  rev: number;
  steps: Step[];
  phase: SyncPhase["tag"];
  endRev: number;
  fetching?: boolean;
  since?: number[];
  fetches?: number;
  retries?: number[];
  visible?: Images;
  holds?: number;
}

const rows: Row[] = [
  // ── live / catching-up ───────────────────────────────────────────────
  {
    name: "live · contiguous tx: applies and advances rev",
    rev: 0,
    steps: [frame(1, { "n.a": "one" }), frame(2, { "n.a": "two" })],
    phase: "live",
    endRev: 2,
    visible: { "n.a": "two" },
  },
  {
    name: "live · tx at or below rev: ignored",
    rev: 2,
    steps: [frame(2, { "n.a": "dup" }), frame(1, { "n.a": "stale" })],
    phase: "live",
    endRev: 2,
    visible: { "n.a": "a" },
  },
  {
    name: "live · tx past a gap: asks since, applies nothing",
    rev: 0,
    steps: [frame(3, { "n.a": "three" })],
    phase: "catching-up",
    endRev: 0,
    since: [0],
    visible: { "n.a": "a" },
  },
  {
    name: "catching-up · more frames past the same gap: asked once",
    rev: 0,
    steps: [frame(3), frame(4), frame(5)],
    phase: "catching-up",
    endRev: 0,
    since: [0],
  },
  {
    name: "catching-up · the replayed frames: apply in order, back to live",
    rev: 0,
    steps: [frame(3), frame(1), frame(2), frame(3, { "n.a": "three" })],
    phase: "live",
    endRev: 3,
    since: [0],
    visible: { "n.a": "three" },
  },
  {
    name: "live · hello at rev: asks nothing",
    rev: 4,
    steps: [hello(4)],
    phase: "live",
    endRev: 4,
    since: [],
  },
  {
    name: "live · hello at another rev: asks since from rev",
    rev: 4,
    steps: [hello(7)],
    phase: "catching-up",
    endRev: 4,
    since: [4],
  },
  {
    name: "catching-up · hello on a new socket: asks again",
    rev: 4,
    steps: [hello(7), hello(7)],
    phase: "catching-up",
    endRev: 4,
    since: [4, 4],
  },
  {
    name: "catching-up · hello at rev: back to live",
    rev: 4,
    steps: [frame(6), hello(4)],
    phase: "live",
    endRev: 4,
    since: [4],
  },
  {
    name: "live · reconcile: asks since once per rev",
    rev: 4,
    steps: [reconcile, reconcile],
    phase: "catching-up",
    endRev: 4,
    since: [4],
  },
  {
    name: "live · a server head behind rev is judged by the server, not inferred",
    rev: 4,
    steps: [hello(0)],
    phase: "catching-up",
    endRev: 4,
    since: [4],
    fetches: 0,
  },
  // ── awaiting-snapshot ────────────────────────────────────────────────
  {
    name: "any phase · snapshot-required: fetches, awaits",
    rev: 4,
    steps: [hello(7), required(7)],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetching: true,
    since: [4],
    fetches: 1,
  },
  {
    name: "awaiting · snapshot-required while fetching: no second fetch",
    rev: 4,
    steps: [required(7), required(7)],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetches: 1,
  },
  {
    name: "awaiting · tx of any rev: ignored",
    rev: 4,
    steps: [required(7), frame(5, { "n.a": "five" }), frame(9)],
    phase: "awaiting-snapshot",
    endRev: 4,
    since: [],
    visible: { "n.a": "a" },
  },
  {
    name: "awaiting · reconcile: ignored",
    rev: 4,
    steps: [required(7), reconcile],
    phase: "awaiting-snapshot",
    endRev: 4,
    since: [],
  },
  {
    name: "awaiting · snapshot fetched: installs at its rev, asks since after it",
    rev: 4,
    steps: [required(7), snapshot(7, { "n.a": "seven", "n.b": "b" })],
    phase: "catching-up",
    endRev: 7,
    since: [7],
    visible: { "n.a": "seven", "n.b": "b" },
  },
  {
    name: "awaiting · a snapshot below rev: installs anyway, the server's rev is the rev",
    rev: 4,
    steps: [hello(0), required(0), snapshot(0, { "n.a": "restarted" })],
    phase: "catching-up",
    endRev: 0,
    since: [4, 0],
    visible: { "n.a": "restarted" },
  },
  {
    name: "live · a snapshot nobody asked for: ignored",
    rev: 4,
    steps: [snapshot(7, { "n.a": "unasked" })],
    phase: "live",
    endRev: 4,
    visible: { "n.a": "a" },
  },
  {
    name: "awaiting · fetch failed: stays awaiting, retries after a backoff",
    rev: 4,
    steps: [required(7), failed],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetching: false,
    retries: [500],
  },
  {
    name: "awaiting · retry due: fetches again; each failure doubles the wait",
    rev: 4,
    steps: [required(7), failed, retry, failed, retry],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetching: true,
    fetches: 3,
    retries: [500, 1000],
  },
  {
    name: "awaiting · hello while not fetching: fetches now",
    rev: 4,
    steps: [required(7), failed, hello(7)],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetching: true,
    fetches: 2,
    since: [],
  },
  {
    name: "awaiting · hello at rev does not clear it",
    rev: 3,
    steps: [hello(0), required(0), failed, hello(3), frame(4, { "n.a": "lost" })],
    phase: "awaiting-snapshot",
    endRev: 3,
    fetches: 2,
    visible: { "n.a": "a" },
  },
  {
    name: "awaiting · hello while fetching: no second fetch",
    rev: 4,
    steps: [required(7), hello(7)],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetches: 1,
  },
  {
    name: "awaiting · retry or failure with nothing to retry: ignored",
    rev: 4,
    steps: [required(7), retry, failed, failed],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetches: 1,
    retries: [500],
  },
  {
    name: "awaiting → live again: a failed fetch, a retry, the install, then frames",
    rev: 4,
    steps: [required(7), failed, retry, snapshot(7), frame(8, { "n.a": "live" })],
    phase: "live",
    endRev: 8,
    visible: { "n.a": "live" },
  },
  // ── holds ────────────────────────────────────────────────────────────
  {
    name: "hold · a frame on a held id lands in the server image, not on screen",
    rev: 1,
    steps: [{ write: "w", images: { "n.a": "local" } }, frame(2, { "n.a": "older" })],
    phase: "live",
    endRev: 2,
    visible: { "n.a": "local" },
    holds: 1,
  },
  {
    name: "hold · settled at or below rev: released at once to the server image",
    rev: 1,
    steps: [
      { write: "w", images: { "n.a": "local" } },
      frame(2, { "n.a": "server" }),
      { settle: "w", rev: 2 },
    ],
    phase: "live",
    endRev: 2,
    visible: { "n.a": "server" },
    holds: 0,
  },
  {
    name: "hold · settled above rev: released when a frame reaches it",
    rev: 1,
    steps: [
      { write: "w", images: { "n.a": "local" } },
      { settle: "w", rev: 3 },
      frame(2, { "n.a": "older" }),
      { stillHeld: true },
      frame(3, { "n.a": "local" }),
      frame(4, { "n.a": "elsewhere" }),
    ],
    phase: "live",
    endRev: 4,
    visible: { "n.a": "elsewhere" },
    holds: 0,
  },
  {
    name: "hold · dropped: the server image returns, since is asked",
    rev: 1,
    steps: [
      { write: "w", images: { "n.a": "local" } },
      frame(2, { "n.a": "foreign" }),
      { drop: "w" },
    ],
    phase: "catching-up",
    endRev: 2,
    since: [2],
    visible: { "n.a": "foreign" },
    holds: 0,
  },
  {
    name: "hold · dropping one keeps an id another hold still holds",
    rev: 1,
    steps: [
      { write: "w1", images: { "n.a": "first" } },
      { write: "w2", images: { "n.a": "second", "n.b": "b2" } },
      { drop: "w1" },
    ],
    phase: "catching-up",
    endRev: 1,
    visible: { "n.a": "second", "n.b": "b2" },
    holds: 1,
  },
  {
    name: "hold · a held local delete is not resurrected by an older upsert",
    rev: 1,
    steps: [
      { write: "w1", images: { "n.a": "edited" } },
      { write: "w2", images: { "n.a": null } },
      { settle: "w1", rev: 2 },
      frame(2, { "n.a": "edited" }),
    ],
    phase: "live",
    endRev: 2,
    visible: { "n.a": null },
    holds: 1,
  },
  {
    name: "hold · released to an absence when the server never had the node",
    rev: 1,
    steps: [{ write: "w", images: { "n.new": "local" } }, { drop: "w" }],
    phase: "catching-up",
    endRev: 1,
    visible: { "n.new": null },
  },
  {
    name: "hold · the snapshot releases a hold settled at or below its rev",
    rev: 1,
    steps: [
      { write: "w", images: { "n.a": "local" } },
      { settle: "w", rev: 2 },
      required(2),
      snapshot(2, { "n.a": "local" }),
      frame(3, { "n.a": "elsewhere" }),
    ],
    phase: "live",
    endRev: 3,
    visible: { "n.a": "elsewhere" },
    holds: 0,
  },
  {
    name: "hold · the snapshot keeps an unsettled hold's local image",
    rev: 1,
    steps: [
      { write: "w", images: { "n.a": "local", "n.new": "mine" } },
      required(2),
      snapshot(2, { "n.a": "older", "n.b": "b" }),
    ],
    phase: "catching-up",
    endRev: 2,
    visible: { "n.a": "local", "n.new": "mine", "n.b": "b" },
    holds: 1,
  },
  {
    name: "hold · settled while awaiting: waits for the install, even at or below rev",
    rev: 3,
    steps: [
      { write: "w", images: { "n.a": "local" } },
      required(9),
      { settle: "w", rev: 2 },
      { stillHeld: true },
      snapshot(9, { "n.a": "local" }),
    ],
    phase: "catching-up",
    endRev: 9,
    visible: { "n.a": "local" },
    holds: 0,
  },
  {
    name: "hold · text keystrokes join the open hold; a settled hold is never joined",
    rev: 1,
    steps: [
      { write: "t", images: { "n.a": "h" } },
      { write: "t", images: { "n.a": "hi" } },
      { settle: "t", rev: 2 },
      { write: "t", images: { "n.a": "hi!" } },
      frame(2, { "n.a": "hi" }),
    ],
    phase: "live",
    endRev: 2,
    visible: { "n.a": "hi!" },
    holds: 1,
  },
];

function run(row: Row) {
  const since: number[] = [];
  const retries: number[] = [];
  let fetches = 0;
  const visible = new Map<string, WireNode>([["n.a", node("n.a", "a")]]);
  const replica = new BrowserReplica(
    [...visible.values()],
    row.rev,
    {
      apply: (tx) => {
        for (const id of tx.deletes) visible.delete(id);
        for (const n of tx.upserts) visible.set(n.id, n);
      },
      install: (nodes) => {
        visible.clear();
        for (const n of nodes) visible.set(n.id, n);
      },
      local: (id) => visible.get(id),
    },
    () => ({
      since: (rev) => since.push(rev),
      fetchSnapshot: () => {
        fetches += 1;
      },
      retryAfter: (ms) => retries.push(ms),
    }),
  );
  const holds = new Map<string, Hold>();
  for (const step of row.steps) {
    if ("op" in step) replica.receive(step);
    else if ("write" in step) {
      for (const [id, text] of Object.entries(step.images)) {
        if (text === null) visible.delete(id);
        else visible.set(id, node(id, text));
      }
      holds.set(step.write, replica.hold(Object.keys(step.images), holds.get(step.write)));
    } else if ("settle" in step) {
      const hold = holds.get(step.settle);
      if (hold) replica.settle(hold, step.rev);
    } else if ("drop" in step) {
      const hold = holds.get(step.drop);
      if (hold) replica.drop(hold);
    } else {
      expect(replica.state.holds, "still held").toBeGreaterThan(0);
    }
  }
  return { replica, since, retries, fetches, visible };
}

describe("browser replica sync machine", () => {
  it.each(rows)("$name", (row) => {
    const out = run(row);
    const { phase, rev, holds } = out.replica.state;
    expect(phase.tag).toBe(row.phase);
    expect(rev).toBe(row.endRev);
    if (row.fetching !== undefined) expect(phase).toMatchObject({ fetching: row.fetching });
    if (row.since !== undefined) expect(out.since).toEqual(row.since);
    if (row.fetches !== undefined) expect(out.fetches).toBe(row.fetches);
    if (row.retries !== undefined) expect(out.retries).toEqual(row.retries);
    if (row.holds !== undefined) expect(holds).toBe(row.holds);
    for (const [id, text] of Object.entries(row.visible ?? {})) {
      expect(out.visible.get(id)?.text ?? null, id).toBe(text);
    }
  });
});

describe("a burst of events is one view apply", () => {
  function recording() {
    const applied: Array<{ upserts: string[]; deletes: string[]; rev: number }> = [];
    const replica = new BrowserReplica(
      [node("n.a", "a"), node("n.b", "b")],
      0,
      {
        apply: (tx, rev) =>
          applied.push({ upserts: tx.upserts.map((n) => n.text), deletes: tx.deletes, rev }),
        install: () => {},
        local: () => undefined,
      },
      () => null,
    );
    return { replica, applied };
  }

  it("applies the frames' net change once, at the last frame's rev", () => {
    const { replica, applied } = recording();
    replica.receiveAll([
      frame(1, { "n.a": "one", "n.c": "c" }),
      frame(2, { "n.a": "two" }),
      frame(3, { "n.c": null, "n.b": null }),
    ]);
    expect(applied).toEqual([{ upserts: ["two"], deletes: ["n.c", "n.b"], rev: 3 }]);
  });

  it("still moves the view's rev for a frame that changes nothing", () => {
    const { replica, applied } = recording();
    replica.receiveAll([frame(1), frame(2)]);
    expect(applied).toEqual([{ upserts: [], deletes: [], rev: 2 }]);
  });
});
