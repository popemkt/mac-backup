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
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
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
    calls.push(String(input));
    return handler(input);
  };
  return { calls };
}

const origFetch = globalThis.fetch;

describe("live wiring: rev gap → /api/graph refetch", () => {
  beforeEach(() => {
    resetStore();
    setFetchGraphSnapshot(null);
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    setFetchGraphSnapshot(null);
  });

  it("refetches the snapshot when the tx stream jumps a rev", async () => {
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
    expect(fetchStub.calls).toEqual([]); // revs agree — no refetch

    // rev jumps 1 → 5: client must not apply, must resync via snapshot
    socket.onmessage?.({
      data: JSON.stringify({ op: "tx", rev: 5, upserts: [], deletes: [] }),
    });
    expect(fetchStub.calls).toEqual(["/api/graph"]);
    await until(() => useOutlineStore.getState().rev === 5);
    expect(useOutlineStore.getState().nodes.has("n.from-resync")).toBe(true);
    client.disconnect();
  });

  it("refetches when hello reports a different rev (server restarted)", async () => {
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
    socket.onmessage?.({ data: JSON.stringify({ op: "hello", rev: 0 }) });
    expect(fetchStub.calls).toEqual(["/api/graph"]);
    await until(() => useOutlineStore.getState().rev === fixtureGraph.rev);
    client.disconnect();
  });
});
