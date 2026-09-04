import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type WireNode,
} from "@kb/contracts";
import { KbWsClient, type TxDelta, type WsLike } from "./ws";

/**
 * Mock server built from protocol.ts schemas: every frame the client sends
 * is validated against ClientMessageSchema; every frame we push is
 * validated against ServerMessageSchema. Wire-contract violations fail the
 * test at the boundary, exactly like a strict server would.
 */
class FakeSocket implements WsLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: ClientMessage[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(ClientMessageSchema.parse(JSON.parse(data)));
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

class MockServer {
  sockets: FakeSocket[] = [];

  makeSocket = (): WsLike => {
    const s = new FakeSocket();
    this.sockets.push(s);
    return s;
  };

  get socket(): FakeSocket {
    return present(this.sockets.at(-1), "latest socket");
  }

  /** Accept the connection and send the protocol hello. */
  accept(rev: number): void {
    this.socket.onopen?.();
    this.push({ op: "hello", rev });
  }

  push(msg: ServerMessage): void {
    const validated = ServerMessageSchema.parse(msg);
    this.socket.onmessage?.({ data: JSON.stringify(validated) });
  }

  drop(): void {
    this.socket.onclose?.();
  }

  received(op: ClientMessage["op"]): ClientMessage[] {
    return this.socket.sent.filter((m) => m.op === op);
  }
}

function wireNode(id: string, text = id): WireNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

interface Harness {
  server: MockServer;
  client: KbWsClient;
  txs: TxDelta[];
  gaps: Array<{ expected: number; got: number }>;
  errors: Array<{ id?: string; code: string; message: string }>;
  rev: { current: number };
}

function makeHarness(startRev = 0): Harness {
  const server = new MockServer();
  const rev = { current: startRev };
  const txs: TxDelta[] = [];
  const gaps: Array<{ expected: number; got: number }> = [];
  const errors: Array<{ id?: string; code: string; message: string }> = [];
  const client = new KbWsClient({
    url: "ws://test/ws",
    makeSocket: server.makeSocket,
    getRev: () => rev.current,
    onTx: (tx) => {
      txs.push(tx);
      rev.current = tx.rev; // mirror the store applying the delta
    },
    onGap: (info) => gaps.push(info),
    onServerError: (err) => errors.push(err),
    backoffInitialMs: 100,
    backoffMaxMs: 1000,
  });
  return { server, client, txs, gaps, errors, rev };
}

describe("KbWsClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects, receives hello, and turns on watch-tx", () => {
    const h = makeHarness();
    h.client.connect();
    expect(h.client.status).toBe("connecting");
    h.server.accept(0);
    expect(h.client.status).toBe("open");
    expect(h.server.received("watch-tx")).toEqual([{ op: "watch-tx", enabled: true }]);
    expect(h.gaps).toEqual([]);
  });

  it("applies contiguous tx deltas and tracks rev", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(0);
    h.server.push({
      op: "tx",
      rev: 1,
      upserts: [wireNode("n.a")],
      deletes: [],
    });
    h.server.push({
      op: "tx",
      rev: 2,
      upserts: [],
      deletes: ["n.a"],
    });
    expect(h.txs.map((t) => t.rev)).toEqual([1, 2]);
    const tx0 = present(h.txs.at(0), "first tx");
    const upsert0 = present(tx0.upserts.at(0), "first upsert");
    expect(upsert0.id).toBe("n.a");
    const tx1 = present(h.txs.at(1), "second tx");
    expect(tx1.deletes).toEqual(["n.a"]);
    expect(h.rev.current).toBe(2);
    expect(h.gaps).toEqual([]);
  });

  it("ignores duplicate/stale tx revs", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(0);
    h.server.push({ op: "tx", rev: 1, upserts: [wireNode("n.a")], deletes: [] });
    h.server.push({ op: "tx", rev: 1, upserts: [wireNode("n.a")], deletes: [] });
    expect(h.txs).toHaveLength(1);
    expect(h.gaps).toEqual([]);
  });

  it("detects a rev gap in the tx stream and asks for resync", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(0);
    h.server.push({ op: "tx", rev: 3, upserts: [wireNode("n.x")], deletes: [] });
    expect(h.txs).toEqual([]); // gap delta must NOT be applied
    expect(h.gaps).toEqual([{ expected: 1, got: 3 }]);
  });

  it("detects a rev mismatch on hello (reconnect after missed txs)", () => {
    const h = makeHarness(4);
    h.client.connect();
    h.server.accept(7);
    expect(h.gaps).toEqual([{ expected: 4, got: 7 }]);
  });

  it("routes subscription rows and resubscribes after reconnect", () => {
    const h = makeHarness();
    const rowsSeen: unknown[][][] = [];
    h.client.connect();
    h.server.accept(0);
    h.client.subscribe("s1", "[:find ?id :where [?n :node/id ?id]]", (rows) => rowsSeen.push(rows));
    expect(h.server.received("subscribe")).toHaveLength(1);
    h.server.push({ op: "rows", id: "s1", rev: 0, rows: [["n.a"]] });
    h.server.push({ op: "rows", id: "other", rev: 0, rows: [["nope"]] });
    expect(rowsSeen).toEqual([[["n.a"]]]);

    // drop + backoff reconnect → watch-tx and subscription re-sent
    h.server.drop();
    expect(h.client.status).toBe("closed");
    vi.advanceTimersByTime(100);
    expect(h.server.sockets).toHaveLength(2);
    h.server.accept(0);
    expect(h.server.received("watch-tx")).toEqual([{ op: "watch-tx", enabled: true }]);
    expect(h.server.received("subscribe")).toEqual([
      {
        op: "subscribe",
        id: "s1",
        query: "[:find ?id :where [?n :node/id ?id]]",
      },
    ]);
  });

  it("backs off exponentially and stops reconnecting after disconnect()", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(0);
    h.server.drop();
    vi.advanceTimersByTime(100); // attempt 2
    expect(h.server.sockets).toHaveLength(2);
    h.server.drop();
    vi.advanceTimersByTime(100); // not yet — second wait is 200ms
    expect(h.server.sockets).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(h.server.sockets).toHaveLength(3);

    h.client.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(h.server.sockets).toHaveLength(3);
    expect(h.client.status).toBe("closed");
  });

  it("surfaces server error messages", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(0);
    h.server.push({
      op: "error",
      id: "s1",
      code: "query_error",
      message: "bad find spec",
    });
    expect(h.errors).toEqual([
      { op: "error", id: "s1", code: "query_error", message: "bad find spec" },
    ]);
  });

  it("rejects frames that violate the server message schema", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(0);
    h.server.socket.onmessage?.({
      data: JSON.stringify({ op: "tx", rev: "not-a-number" }),
    });
    expect(h.errors.some((e) => e.code === "invalid_server_message")).toBe(true);
    expect(h.txs).toEqual([]);
  });
});
