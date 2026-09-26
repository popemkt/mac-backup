/**
 * The browser replica's sync, end to end: every scenario the hold contract
 * (DESIGN-UI.md → Mutations) has to survive, driven through the real live
 * client, runtime and outline store against a scripted server. One row per
 * scenario; each row is the server's moves and what the replica must show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot, WireNode } from "@kb/contracts";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { setFetchGraphSnapshot } from "@/api/graph";
import { createLiveClient } from "@/api/live";
import type { KbWsClient } from "@/api/ws";
import { __resetPendingContentForTests, mutations } from "@/actions/mutations";
import { invoke } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import { FakeWsSocket } from "@/test-support/ws";

const X = "n.child-a1";
const Y = "n.root-c";

type Images = Record<string, string | null>;

type Step =
  | { write: string; text: string }
  | { remove: string }
  | { type: string; text: string }
  | { receipt: number; rev: number }
  | { fail: number }
  | { throws: number }
  | { frame: number; images: Images }
  | { hello: number }
  | { reconnect: number }
  | { snapshotRequired: number }
  | { snapshot: number; images?: Images }
  | { snapshotFails: true }
  | { wait: number }
  | { expect: { images?: Images; rev?: number; fetches?: number; since?: number } };

interface Scenario {
  name: string;
  hydrateAt?: number;
  steps: Step[];
}

function image(id: string, text: string): WireNode {
  const base = fixtureGraph.nodes.find((node) => node.id === id);
  if (base === undefined) throw new Error(`no fixture node ${id}`);
  return {
    ...structuredClone(base),
    text,
    updatedAt: `2026-09-27T00:00:0${text.length % 10}.000Z`,
  };
}

function applyImages(nodes: readonly WireNode[], images: Images): WireNode[] {
  const out = new Map(nodes.map((node) => [node.id, node]));
  for (const [id, text] of Object.entries(images)) {
    if (text === null) out.delete(id);
    else out.set(id, image(id, text));
  }
  return [...out.values()];
}

const scenarios: Scenario[] = [
  {
    name: "original bug: an earlier write's frame never rolls back a newer optimistic write",
    steps: [
      { write: X, text: "a" },
      { write: X, text: "b" },
      { receipt: 0, rev: 2 },
      { frame: 2, images: { [X]: "a" } },
      { expect: { images: { [X]: "b" } } },
      { receipt: 1, rev: 3 },
      { frame: 3, images: { [X]: "b" } },
      { frame: 4, images: { [X]: "c" } },
      { expect: { images: { [X]: "c" }, rev: 4 } },
    ],
  },
  {
    name: "round 1: a held local delete is not resurrected by an earlier write's upsert",
    steps: [
      { write: X, text: "a" },
      { remove: X },
      { receipt: 0, rev: 2 },
      { frame: 2, images: { [X]: "a" } },
      { expect: { images: { [X]: null } } },
      { receipt: 1, rev: 3 },
      { frame: 3, images: { [X]: null } },
      { expect: { images: { [X]: null }, rev: 3 } },
    ],
  },
  {
    name: "round 1: a failed push shows the foreign frames it swallowed",
    steps: [
      { write: X, text: "a" },
      { frame: 2, images: { [X]: "foreign" } },
      { expect: { images: { [X]: "a" } } },
      { fail: 0 },
      { expect: { images: { [X]: "foreign" }, rev: 2, since: 2 } },
    ],
  },
  {
    name: "round 1: a thrown push falls back to the server image and asks since",
    steps: [
      { write: X, text: "a" },
      { throws: 0 },
      { expect: { images: { [X]: "Load graph into client DataScript" }, since: 1, fetches: 0 } },
    ],
  },
  {
    name: "round 2: a failed push keeps every other hold and never fetches a snapshot",
    steps: [
      { write: X, text: "a" },
      { write: Y, text: "b" },
      { write: X, text: "c" },
      { fail: 0 },
      { expect: { images: { [X]: "c", [Y]: "b" }, rev: 1, fetches: 0, since: 1 } },
      { receipt: 1, rev: 2 },
      { receipt: 2, rev: 3 },
      { frame: 2, images: { [Y]: "b" } },
      { frame: 3, images: { [X]: "c" } },
      { expect: { images: { [X]: "c", [Y]: "b" }, rev: 3 } },
    ],
  },
  {
    name: "round 3: frames that arrive while a snapshot is fetched are not lost to it",
    steps: [
      { snapshotRequired: 3 },
      { frame: 4, images: { [Y]: "four" } },
      { frame: 5, images: { [Y]: "five" } },
      { snapshot: 3, images: { [Y]: "three" } },
      { expect: { since: 3 } },
      { frame: 4, images: { [Y]: "four" } },
      { frame: 5, images: { [Y]: "five" } },
      { expect: { images: { [Y]: "five" }, rev: 5, fetches: 1 } },
    ],
  },
  {
    name: "round 3: a server whose head is behind the replica is resynced by its own verdict",
    hydrateAt: 3,
    steps: [
      { hello: 0 },
      { expect: { since: 3, fetches: 0 } },
      { snapshotRequired: 0 },
      { snapshot: 0, images: { [Y]: "restarted" } },
      { frame: 1, images: { [Y]: "after restart" } },
      { expect: { images: { [Y]: "after restart" }, rev: 1, fetches: 1 } },
    ],
  },
  {
    name: "round 4: a failed snapshot fetch is retried when the socket says hello again",
    hydrateAt: 3,
    steps: [
      { hello: 0 },
      { snapshotRequired: 0 },
      { snapshotFails: true },
      { reconnect: 3 },
      { expect: { fetches: 2 } },
      { snapshot: 3, images: { [Y]: "resynced" } },
      { frame: 4, images: { [Y]: "live again" } },
      { expect: { images: { [Y]: "live again" }, rev: 4 } },
    ],
  },
  {
    name: "round 4: a failed snapshot fetch is retried after a backoff",
    steps: [
      { snapshotRequired: 5 },
      { snapshotFails: true },
      { expect: { fetches: 1 } },
      { wait: 1_000 },
      { expect: { fetches: 2 } },
      { snapshot: 5, images: { [Y]: "resynced" } },
      { frame: 6, images: { [Y]: "live again" } },
      { expect: { images: { [Y]: "live again" }, rev: 6 } },
    ],
  },
  {
    name: "round 4: a hello while the snapshot is in flight does not fetch it twice",
    steps: [
      { snapshotRequired: 5 },
      { reconnect: 5 },
      { expect: { fetches: 1 } },
      { snapshot: 5, images: { [Y]: "resynced" } },
      { expect: { images: { [Y]: "resynced" }, rev: 5 } },
    ],
  },
  {
    name: "round 4: a hold confirmed at or below the snapshot's rev is released by it",
    steps: [
      { write: X, text: "a" },
      { receipt: 0, rev: 2 },
      { snapshotRequired: 2 },
      { snapshot: 2, images: { [X]: "a" } },
      { frame: 3, images: { [X]: "edited elsewhere" } },
      { expect: { images: { [X]: "edited elsewhere" }, rev: 3 } },
    ],
  },
  {
    name: "a hold confirmed above the snapshot's rev keeps its image until since delivers it",
    steps: [
      { write: X, text: "a" },
      { snapshotRequired: 2 },
      { snapshot: 2, images: { [X]: "older" } },
      { expect: { images: { [X]: "a" }, since: 2 } },
      { receipt: 0, rev: 3 },
      { frame: 3, images: { [X]: "a" } },
      { frame: 4, images: { [X]: "edited elsewhere" } },
      { expect: { images: { [X]: "edited elsewhere" }, rev: 4 } },
    ],
  },
  {
    name: "a write the server commits as a no-op is released by its receipt alone",
    steps: [
      { write: X, text: "a" },
      { receipt: 0, rev: 1 },
      { frame: 2, images: { [X]: "edited elsewhere" } },
      { expect: { images: { [X]: "edited elsewhere" }, rev: 2 } },
    ],
  },
  {
    name: "typed text not yet pushed survives a frame, then yields to the server once confirmed",
    steps: [
      { type: X, text: "typed" },
      { frame: 2, images: { [X]: "remote" } },
      { expect: { images: { [X]: "typed" } } },
      { wait: 400 },
      { receipt: 0, rev: 3 },
      { frame: 3, images: { [X]: "typed" } },
      { frame: 4, images: { [X]: "edited elsewhere" } },
      { expect: { images: { [X]: "edited elsewhere" }, rev: 4 } },
    ],
  },
];

interface Push {
  id: string;
  settle: (outcome: { rev: number } | { fail: true } | { throws: true }) => void;
}

class Harness {
  readonly pushes: Push[] = [];
  readonly sockets: FakeWsSocket[] = [];
  fetches = 0;
  private pendingSnapshot: {
    resolve: (snapshot: GraphSnapshot) => void;
    reject: (err: Error) => void;
  } | null = null;
  private server: WireNode[] = structuredClone(fixtureGraph.nodes);
  client: KbWsClient;

  constructor(rev: number) {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), rev, "api");
    setPostAction(
      (invocation) =>
        new Promise((resolve, reject) => {
          this.pushes.push({
            id: invocation.id,
            settle: (outcome) => {
              if ("throws" in outcome) reject(new Error("network down"));
              else if ("fail" in outcome)
                resolve({ status: "failed", id: invocation.id, code: "internal", message: "no" });
              else
                resolve({ status: "succeeded", id: invocation.id, output: {}, rev: outcome.rev });
            },
          });
        }),
    );
    setFetchGraphSnapshot(() => {
      this.fetches += 1;
      return new Promise((resolve, reject) => {
        this.pendingSnapshot = { resolve, reject };
      });
    });
    this.client = createLiveClient({
      url: "ws://test/ws",
      makeSocket: () => {
        const socket = new FakeWsSocket();
        this.sockets.push(socket);
        return socket;
      },
    });
    this.client.connect();
    this.socket.accept();
    this.socket.deliver({ op: "hello", rev });
  }

  get socket(): FakeWsSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) throw new Error("no socket");
    return socket;
  }

  lastSince(): number | undefined {
    const asks = this.sockets
      .flatMap((socket) => socket.sent)
      .map((raw) => JSON.parse(raw) as { op: string; rev?: number })
      .filter((msg) => msg.op === "since");
    return asks.at(-1)?.rev;
  }

  visible(id: string): string | null {
    const state = useOutlineStore.getState();
    const indexed = state.index?.getNode(id)?.text ?? null;
    const wired = state.wireNodes.find((node) => node.id === id)?.text ?? null;
    expect(wired, `wireNodes and index disagree on ${id}`).toBe(indexed);
    return indexed;
  }

  push(i: number): Push {
    const push = this.pushes[i];
    if (push === undefined) throw new Error(`push ${i} was never sent`);
    return push;
  }

  async run(step: Step): Promise<void> {
    if ("write" in step) await invoke("node.update", { id: step.write, text: step.text });
    else if ("remove" in step) await invoke("node.update", { id: step.remove, delete: true });
    else if ("type" in step) await mutations.updateNodeContent(step.type, step.text);
    else if ("receipt" in step) this.push(step.receipt).settle({ rev: step.rev });
    else if ("fail" in step) this.push(step.fail).settle({ fail: true });
    else if ("throws" in step) this.push(step.throws).settle({ throws: true });
    else if ("wait" in step) await vi.advanceTimersByTimeAsync(step.wait);
    else if ("expect" in step) this.check(step.expect);
    else await this.serve(step);
    await vi.advanceTimersByTimeAsync(0);
  }

  /** The server's moves: frames, hellos, and the snapshot it was asked for. */
  private async serve(step: Step): Promise<void> {
    if ("frame" in step) {
      this.server = applyImages(this.server, step.images);
      const entries = Object.entries(step.images);
      this.socket.deliver({
        op: "tx",
        rev: step.frame,
        upserts: entries.flatMap(([id, text]) => (text === null ? [] : [image(id, text)])),
        deletes: entries.flatMap(([id, text]) => (text === null ? [id] : [])),
      });
    } else if ("hello" in step) {
      this.socket.deliver({ op: "hello", rev: step.hello });
    } else if ("reconnect" in step) {
      this.socket.drop();
      await vi.advanceTimersByTimeAsync(10_000);
      this.socket.accept();
      this.socket.deliver({ op: "hello", rev: step.reconnect });
    } else if ("snapshotRequired" in step) {
      this.socket.deliver({ op: "snapshot-required", head: step.snapshotRequired });
    } else if ("snapshot" in step) {
      this.server = applyImages(this.server, step.images ?? {});
      this.takeSnapshot().resolve({ rev: step.snapshot, nodes: structuredClone(this.server) });
    } else if ("snapshotFails" in step) {
      this.takeSnapshot().reject(new Error("GET /api/graph → 503"));
    }
  }

  private takeSnapshot(): NonNullable<Harness["pendingSnapshot"]> {
    const pending = this.pendingSnapshot;
    if (pending === null) throw new Error("no snapshot fetch in flight");
    this.pendingSnapshot = null;
    return pending;
  }

  private check(want: Extract<Step, { expect: unknown }>["expect"]): void {
    for (const [id, text] of Object.entries(want.images ?? {})) {
      expect(this.visible(id), id).toBe(text);
    }
    if (want.rev !== undefined) expect(useOutlineStore.getState().rev).toBe(want.rev);
    if (want.fetches !== undefined) expect(this.fetches).toBe(want.fetches);
    if (want.since !== undefined) expect(this.lastSince()).toBe(want.since);
  }
}

describe("browser replica sync scenarios", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetPendingContentForTests();
  });

  afterEach(() => {
    harness?.client.disconnect();
    harness = null;
    setPostAction(null);
    setFetchGraphSnapshot(null);
    __resetPendingContentForTests();
    vi.useRealTimers();
  });

  it.each(scenarios)("$name", async ({ hydrateAt, steps }) => {
    harness = new Harness(hydrateAt ?? 1);
    for (const step of steps) await harness.run(step);
  });
});
