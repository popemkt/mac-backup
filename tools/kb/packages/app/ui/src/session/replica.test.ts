/**
 * The replica's sync machine, one row per transition (DESIGN-UI.md → Replica
 * sync). Each row starts from a rev, feeds events, and states the phase, rev
 * and network moves that must follow.
 */
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { BrowserReplica, type SyncEvent, type SyncPhase } from "./replica";

function node(id: string): WireNode {
  return {
    id,
    text: id,
    props: {},
    children: [],
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

const tx = (rev: number): SyncEvent => ({
  op: "tx",
  rev,
  upserts: [node(`n.${rev}`)],
  deletes: [],
});
const snapshot = (rev: number): SyncEvent => ({
  op: "snapshot",
  snapshot: { rev, nodes: [node(`n.snap-${rev}`)] },
});

interface Row {
  name: string;
  rev: number;
  events: SyncEvent[];
  phase: SyncPhase["tag"];
  endRev: number;
  since?: number[];
  fetches?: number;
  applied?: number[];
  installed?: number[];
}

const rows: Row[] = [
  {
    name: "live: a contiguous frame applies and advances rev",
    rev: 0,
    events: [tx(1), tx(2)],
    phase: "live",
    endRev: 2,
    applied: [1, 2],
  },
  {
    name: "live: a duplicate or stale frame is ignored",
    rev: 1,
    events: [tx(1), tx(0)],
    phase: "live",
    endRev: 1,
    applied: [],
  },
  {
    name: "live: a gap asks since and applies nothing",
    rev: 0,
    events: [tx(3)],
    phase: "catching-up",
    endRev: 0,
    since: [0],
    applied: [],
  },
  {
    name: "catching-up: more frames past the same gap ask once",
    rev: 0,
    events: [tx(3), tx(4), tx(5)],
    phase: "catching-up",
    endRev: 0,
    since: [0],
  },
  {
    name: "catching-up: the replayed frames apply in order and return to live",
    rev: 0,
    events: [tx(3), tx(1), tx(2), tx(3)],
    phase: "live",
    endRev: 3,
    since: [0],
    applied: [1, 2, 3],
  },
  {
    name: "live: a hello at the replica's rev asks nothing",
    rev: 4,
    events: [{ op: "hello", rev: 4 }],
    phase: "live",
    endRev: 4,
    since: [],
  },
  {
    name: "live: a hello at another rev asks since from the replica's rev",
    rev: 4,
    events: [{ op: "hello", rev: 7 }],
    phase: "catching-up",
    endRev: 4,
    since: [4],
  },
  {
    name: "catching-up: a hello on a new socket asks again",
    rev: 4,
    events: [
      { op: "hello", rev: 7 },
      { op: "hello", rev: 7 },
    ],
    phase: "catching-up",
    endRev: 4,
    since: [4, 4],
  },
  {
    name: "live: reconcile asks since once per rev",
    rev: 4,
    events: [{ op: "reconcile" }, { op: "reconcile" }],
    phase: "catching-up",
    endRev: 4,
    since: [4],
  },
  {
    name: "any phase: only the server's snapshot-required fetches a snapshot",
    rev: 4,
    events: [
      { op: "hello", rev: 7 },
      { op: "snapshot-required", head: 7 },
    ],
    phase: "awaiting-snapshot",
    endRev: 4,
    since: [4],
    fetches: 1,
  },
  {
    name: "awaiting: a second snapshot-required does not fetch twice",
    rev: 4,
    events: [
      { op: "snapshot-required", head: 7 },
      { op: "snapshot-required", head: 7 },
    ],
    phase: "awaiting-snapshot",
    endRev: 4,
    fetches: 1,
  },
  {
    name: "awaiting: the snapshot installs at its own rev",
    rev: 4,
    events: [{ op: "snapshot-required", head: 7 }, snapshot(7)],
    phase: "live",
    endRev: 7,
    installed: [7],
  },
  {
    name: "a snapshot nobody asked for is ignored",
    rev: 4,
    events: [snapshot(7)],
    phase: "live",
    endRev: 4,
    installed: [],
  },
];

function run(row: Row) {
  const since: number[] = [];
  const applied: number[] = [];
  const installed: number[] = [];
  let fetches = 0;
  const replica = new BrowserReplica(
    row.rev,
    {
      apply: (_tx, rev) => applied.push(rev),
      install: (_nodes, rev) => installed.push(rev),
    },
    () => ({
      since: (rev) => since.push(rev),
      fetchSnapshot: () => {
        fetches += 1;
      },
    }),
  );
  for (const event of row.events) replica.receive(event);
  return { replica, since, applied, installed, fetches };
}

describe("browser replica sync machine", () => {
  it.each(rows)("$name", (row) => {
    const out = run(row);
    expect(out.replica.state.phase.tag).toBe(row.phase);
    expect(out.replica.state.rev).toBe(row.endRev);
    if (row.since !== undefined) expect(out.since).toEqual(row.since);
    if (row.fetches !== undefined) expect(out.fetches).toBe(row.fetches);
    if (row.applied !== undefined) expect(out.applied).toEqual(row.applied);
    if (row.installed !== undefined) expect(out.installed).toEqual(row.installed);
  });
});
