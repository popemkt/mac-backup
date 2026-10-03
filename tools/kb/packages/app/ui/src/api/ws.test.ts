import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientMessage,
  type ScreenCommand,
  type ScreenState,
  type ServerMessage,
  type WireNode,
} from "@kb/contracts";
import type { GraphMessage } from "@/session/replica";
import { KbWsClient, type WsLike } from "./ws";
import { FakeWsSocket } from "@/test-support/ws";

/**
 * Mock server built from protocol.ts schemas: every frame the client sends
 * is validated against ClientMessageSchema; every frame we push is
 * validated against ServerMessageSchema. Wire-contract violations fail the
 * test at the boundary, exactly like a strict server would.
 */
class MockServer {
  sockets: FakeWsSocket[] = [];

  makeSocket = (): WsLike => {
    const s = new FakeWsSocket();
    this.sockets.push(s);
    return s;
  };

  get socket(): FakeWsSocket {
    return present(this.sockets.at(-1), "latest socket");
  }

  /** Accept the connection and send the protocol hello. */
  accept(rev: number): void {
    this.socket.accept();
    this.push({ op: "hello", rev });
  }

  push(msg: ServerMessage): void {
    this.socket.deliver(ServerMessageSchema.parse(msg));
  }

  drop(): void {
    this.socket.drop();
  }

  /** Every frame the client has sent, validated against the wire contract. */
  get sent(): ClientMessage[] {
    return this.socket.sent.map((raw) => ClientMessageSchema.parse(JSON.parse(raw)));
  }

  received(op: ClientMessage["op"]): ClientMessage[] {
    return this.sent.filter((m) => m.op === op);
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
  graph: GraphMessage[];
  errors: Array<{ id?: string; code: string; message: string }>;
}

function makeHarness(): Harness {
  const server = new MockServer();
  const graph: GraphMessage[] = [];
  const errors: Array<{ id?: string; code: string; message: string }> = [];
  const client = new KbWsClient({
    url: "ws://test/ws",
    makeSocket: server.makeSocket,
    onGraph: (msg) => graph.push(msg),
    onServerError: (err) => errors.push(err),
    backoffInitialMs: 100,
    backoffMaxMs: 1000,
  });
  return { server, client, graph, errors };
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
  });

  it("carries the graph stream to the replica without reading it", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(4);
    // Out of order and behind: judging that is the replica's job, not the socket's.
    h.server.push({ op: "tx", rev: 9, upserts: [wireNode("n.a")], deletes: [] });
    h.server.push({ op: "tx", rev: 2, upserts: [], deletes: ["n.a"] });
    h.server.push({ op: "snapshot-required", head: 9 });
    expect(h.graph).toEqual([
      { op: "hello", rev: 4 },
      { op: "tx", rev: 9, upserts: [wireNode("n.a")], deletes: [] },
      { op: "tx", rev: 2, upserts: [], deletes: ["n.a"] },
      { op: "snapshot-required", head: 9 },
    ]);
    expect(h.server.received("since")).toEqual([]);
  });

  it("asks since on the replica's behalf", () => {
    const h = makeHarness();
    h.client.connect();
    h.server.accept(4);
    h.client.since(4);
    expect(h.server.received("since")).toEqual([{ op: "since", rev: 4 }]);
  });

  it("routes subscription rows and resubscribes after reconnect", () => {
    const h = makeHarness();
    const rowsSeen: unknown[][][] = [];
    h.client.connect();
    h.server.accept(0);
    h.client.subscribe("s1", "[:find ?id :where [?n :node/id ?id]]", {
      rows: (rows) => rowsSeen.push(rows),
      error: () => {},
    });
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

  it("routes an error naming a live subscription to that subscription, not the toast", () => {
    const h = makeHarness();
    const errors: { code: string; message: string }[] = [];
    h.client.connect();
    h.server.accept(0);
    h.client.subscribe("s1", "[:find", { rows: () => {}, error: (err) => errors.push(err) });
    h.server.push({ op: "error", id: "s1", code: "query_error", message: "bad find spec" });
    expect(errors).toEqual([
      { op: "error", id: "s1", code: "query_error", message: "bad find spec" },
    ]);
    expect(h.errors).toEqual([]);
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
    // Bypasses MockServer.push on purpose: this frame is invalid, so it has to
    // reach the client without passing ServerMessageSchema on the way out.
    h.server.socket.deliver({ op: "tx", rev: "not-a-number" });
    expect(h.errors.some((e) => e.code === "invalid_server_message")).toBe(true);
    expect(h.graph).toEqual([{ op: "hello", rev: 0 }]);
  });

  it("publishes the tab's latest screen, again on every open", () => {
    const h = makeHarness();
    const state: ScreenState = {
      route: "/",
      active: true,
      activePane: "main",
      panes: [{ id: "main", route: "/", view: null, focused: null, selection: [] }],
    };
    // Published before the socket is open: it goes out when the socket opens.
    h.client.publishScreen("tab.a", { ...state, route: "/canvas" });
    h.client.publishScreen("tab.a", state);
    h.client.connect();
    h.server.accept(0);
    expect(h.server.received("screen")).toEqual([{ op: "screen", tab: "tab.a", state }]);
    h.server.drop();
    vi.advanceTimersByTime(100);
    h.server.accept(0);
    expect(h.server.received("screen")).toEqual([{ op: "screen", tab: "tab.a", state }]);
  });

  it("hands a screen command to its handler and sends the answer back under its id", () => {
    const commands: Array<[string, ScreenCommand]> = [];
    const server = new MockServer();
    const client = new KbWsClient({
      url: "ws://test/ws",
      makeSocket: server.makeSocket,
      onGraph: () => {},
      onScreenCommand: (id, command) => {
        commands.push([id, command]);
        client.answerScreenCommand(id, { outcome: "applied" });
      },
    });
    client.connect();
    server.accept(0);
    server.push({
      op: "screen-command",
      id: "c1",
      command: { kind: "navigate", to: { node: "n.a" } },
    });
    expect(commands).toEqual([["c1", { kind: "navigate", to: { node: "n.a" } }]]);
    expect(server.received("screen-ack")).toEqual([
      { op: "screen-ack", id: "c1", result: { outcome: "applied" } },
    ]);
  });

  it("hands a refused tab id to its handler", () => {
    const refused: string[] = [];
    const server = new MockServer();
    const client = new KbWsClient({
      url: "ws://test/ws",
      makeSocket: server.makeSocket,
      onGraph: () => {},
      onScreenRefused: (tab) => refused.push(tab),
    });
    client.connect();
    server.accept(0);
    server.push({ op: "screen-refused", tab: "tab.a", code: "tab_in_use" });
    expect(refused).toEqual(["tab.a"]);
  });

  it("carries a plugin channel both ways, and its error to its own sink", () => {
    const h = makeHarness();
    const data: unknown[] = [];
    const errors: { code: string; message: string }[] = [];
    h.client.connect();
    h.server.accept(0);
    const unlisten = h.client.listen("agent.chat", {
      data: (frame) => data.push(frame),
      error: (err) => errors.push(err),
    });
    h.client.sendChannel("agent.chat", { type: "send", text: "hi" });
    expect(h.server.received("channel")).toEqual([
      { op: "channel", channel: "agent.chat", data: { type: "send", text: "hi" } },
    ]);
    h.server.push({ op: "channel", channel: "agent.chat", data: { type: "text", delta: "yo" } });
    h.server.push({ op: "channel", channel: "other", data: "not ours" });
    h.server.push({ op: "error", id: "agent.chat", code: "unknown_channel", message: "none" });
    expect(data).toEqual([{ type: "text", delta: "yo" }]);
    expect(errors).toEqual([
      { op: "error", id: "agent.chat", code: "unknown_channel", message: "none" },
    ]);
    expect(h.errors).toEqual([]);
    unlisten();
    h.server.push({ op: "channel", channel: "agent.chat", data: "late" });
    expect(data).toHaveLength(1);
  });

  it("drops a channel frame sent while the socket is down", () => {
    const h = makeHarness();
    h.client.sendChannel("agent.chat", { type: "send" });
    h.client.connect();
    h.server.accept(0);
    expect(h.server.received("channel")).toEqual([]);
  });
});
