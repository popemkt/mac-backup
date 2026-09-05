import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@kb/contracts";
import { setFetchGraphSnapshot } from "@/api/graph";
import { fixtureGraph } from "@/fixtures/graph";
import { useOutlineStore } from "@/stores/outline.store";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { createLiveClient } from "./live";
import type { WsLike } from "./ws";

class FakeSocket implements WsLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }
}

function resetStore(): void {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    index: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    loadSource: null,
    loadError: null,
  });
}

/** Poll until pred holds (works under both vitest and bun test). */
async function until(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout in until()");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function stubFetch(handler: (input: RequestInfo | URL) => Promise<Response>): {
  calls: Array<string>;
} {
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input instanceof Request ? input.url : String(input));
    return handler(input);
  };
  return { calls };
}

const origFetch = globalThis.fetch;

describe("live wiring: a gap is caught up, a snapshot is the fallback", () => {
  beforeEach(() => {
    resetStore();
    setFetchGraphSnapshot(null);
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    setFetchGraphSnapshot(null);
  });

  it("catches up from the tx frames the server holds — no refetch", async () => {
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, 1, "api");
    const fetchStub = stubFetch(async () => new Response("{}"));

    const socket = new FakeSocket();
    const client = createLiveClient({ url: "ws://test/ws", makeSocket: () => socket });
    client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ op: "hello", rev: 1 }) });

    // rev jumps 1 → 3: ask, do not refetch.
    socket.onmessage?.({
      data: JSON.stringify({ op: "tx", rev: 3, upserts: [], deletes: [] }),
    });
    expect(socket.sent.map((s) => JSON.parse(s) as { op: string })).toContainEqual({
      op: "since",
      rev: 1,
    });
    expect(fetchStub.calls).toEqual([]);

    const arrived = {
      id: "n.from-since",
      text: "arrived via since",
      props: {},
      children: [],
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
    };
    socket.onmessage?.({
      data: JSON.stringify({ op: "tx", rev: 2, upserts: [arrived], deletes: [] }),
    });
    socket.onmessage?.({
      data: JSON.stringify({ op: "tx", rev: 3, upserts: [], deletes: [] }),
    });
    expect(useOutlineStore.getState().rev).toBe(3);
    expect(useOutlineStore.getState().nodes.has("n.from-since")).toBe(true);
    expect(fetchStub.calls).toEqual([]);
    client.disconnect();
  });

  it("refetches the snapshot when the server answers snapshot-required", async () => {
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, 1, "api");

    const serverSnapshot: GraphSnapshot = {
      rev: 5,
      nodes: [
        ...fixtureGraph.nodes,
        {
          id: "n.from-resync",
          text: "arrived via resync",
          props: {},
          children: [],
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:00:00.000Z",
        },
      ],
    };
    const fetchStub = stubFetch(async () => {
      return new Response(JSON.stringify(serverSnapshot), {
        headers: { "content-type": "application/json" },
      });
    });

    const socket = new FakeSocket();
    const client = createLiveClient({
      url: "ws://test/ws",
      makeSocket: () => socket,
    });
    client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ op: "hello", rev: 1 }) });
    expect(fetchStub.calls).toEqual([]); // revs agree — nothing to ask

    // rev jumps 1 → 5, and the server's log no longer covers rev 2.
    socket.onmessage?.({
      data: JSON.stringify({ op: "tx", rev: 5, upserts: [], deletes: [] }),
    });
    expect(fetchStub.calls).toEqual([]);
    socket.onmessage?.({ data: JSON.stringify({ op: "snapshot-required", head: 5 }) });
    expect(fetchStub.calls).toEqual(["/api/graph"]);
    await until(() => useOutlineStore.getState().rev === 5);
    expect(useOutlineStore.getState().nodes.has("n.from-resync")).toBe(true);
    client.disconnect();
  });

  it("refetches when a restarted server cannot serve the client's rev", async () => {
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, 3, "api");

    const fetchStub = stubFetch(
      async () =>
        new Response(JSON.stringify(fixtureGraph), {
          headers: { "content-type": "application/json" },
        }),
    );

    const socket = new FakeSocket();
    const client = createLiveClient({
      url: "ws://test/ws",
      makeSocket: () => socket,
    });
    client.connect();
    socket.onopen?.();
    // A restart resets the per-server rev counter: the client's rev 3 is
    // ahead of head, so the log cannot express the difference as frames.
    socket.onmessage?.({ data: JSON.stringify({ op: "hello", rev: 0 }) });
    expect(fetchStub.calls).toEqual([]);
    socket.onmessage?.({ data: JSON.stringify({ op: "snapshot-required", head: 0 }) });
    expect(fetchStub.calls).toEqual(["/api/graph"]);
    await until(() => useOutlineStore.getState().rev === fixtureGraph.rev);
    client.disconnect();
  });
});
