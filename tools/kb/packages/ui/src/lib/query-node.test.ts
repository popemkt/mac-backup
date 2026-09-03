/**
 * W4 query-node lib: definition extraction, result-id mapping, and the
 * subscribe/unsubscribe lifecycle over the /ws client.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { KbWsClient, type WsLike } from "@/api/ws";
import { fixtureGraph } from "@/fixtures/graph";
import {
  isQueryNode,
  queryDefOf,
  querySubscriptionId,
  resultNodeIds,
  subscribeQueryNode,
} from "@/lib/query-node";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import type { WireNode } from "@kb/contracts";

const EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";

function queryWire(id = "n.q1", extraProps: WireNode["props"] = {}): WireNode {
  return {
    id,
    text: "Open todos",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
      [SYSTEM_IDS.queryField]: [{ t: "str", v: EDN }],
      ...extraProps,
    },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function hydrate(extra: WireNode[] = []): void {
  useOutlineStore.getState().hydrateFromWire([...fixtureGraph.nodes, ...extra], 1, "fixtures");
}

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

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // node env without localStorage
  }
  hydrate([queryWire()]);
});

describe("queryDefOf / isQueryNode", () => {
  it("extracts EDN and limit from a #query node", () => {
    hydrate([
      queryWire("n.q1", {
        [SYSTEM_IDS.queryLimitField]: [{ t: "num", v: 3 }],
      }),
    ]);
    const node = useOutlineStore.getState().nodes.get("n.q1");
    expect(isQueryNode(node)).toBe(true);
    expect(queryDefOf(node)).toEqual({ edn: EDN, limit: 3 });
  });

  it("null for untagged nodes and tagged nodes without EDN", () => {
    const plain = useOutlineStore.getState().nodes.get("n.root-c");
    expect(isQueryNode(plain)).toBe(false);
    expect(queryDefOf(plain)).toBeNull();

    hydrate([
      {
        ...queryWire("n.q2"),
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
        },
      },
    ]);
    const noEdn = useOutlineStore.getState().nodes.get("n.q2");
    expect(isQueryNode(noEdn)).toBe(true);
    expect(queryDefOf(noEdn)).toBeNull();
  });
});

describe("resultNodeIds", () => {
  it("picks known node ids, dedupes, excludes self, applies limit", () => {
    const nodes = useOutlineStore.getState().nodes;
    const rows: unknown[][] = [
      ["n.root-a", "Ship kb ui shell"],
      ["n.root-a", "duplicate"],
      ["n.q1", "the query node itself"],
      ["not-a-node", "unknown id → skipped"],
      ["n.root-b", "Search jumps to matching nodes"],
      ["n.root-c", "over limit"],
    ];
    expect(resultNodeIds(rows, nodes, { limit: 2, excludeId: "n.q1" })).toEqual([
      "n.root-a",
      "n.root-b",
    ]);
    expect(resultNodeIds(rows, nodes, { excludeId: "n.q1" })).toEqual([
      "n.root-a",
      "n.root-b",
      "n.root-c",
    ]);
  });
});

describe("query node collapse state (cheap-by-default)", () => {
  it("defaults collapsed, toggles without children, others still gated", () => {
    const store = useOutlineStore.getState();
    expect(store.nodes.get("n.q1")!.collapsed).toBe(true);
    expect(store.nodes.get("n.q1")!.children).toEqual([]);

    store.toggleCollapse("n.q1");
    expect(useOutlineStore.getState().nodes.get("n.q1")!.collapsed).toBe(false);

    // Non-query leaf nodes still cannot toggle.
    useOutlineStore.getState().toggleCollapse("n.root-c");
    expect(useOutlineStore.getState().nodes.get("n.root-c")!.collapsed).toBe(false);

    useOutlineStore.getState().toggleCollapse("n.q1");
    expect(useOutlineStore.getState().nodes.get("n.q1")!.collapsed).toBe(true);
  });

  it("expanded state survives a tx-driven map rebuild", () => {
    const store = useOutlineStore.getState();
    store.toggleCollapse("n.q1");
    expect(useOutlineStore.getState().nodes.get("n.q1")!.collapsed).toBe(false);
    // Simulate an incoming WS tx touching an unrelated node.
    useOutlineStore.getState().applyTx(
      [
        {
          id: "n.new",
          text: "from tx",
          props: {},
          children: [],
          createdAt: "2026-08-08T01:00:00.000Z",
          updatedAt: "2026-08-08T01:00:00.000Z",
        },
      ],
      [],
      { rev: 2 },
    );
    const after = useOutlineStore.getState();
    expect(after.nodes.get("n.new")).toBeDefined();
    expect(after.nodes.get("n.q1")!.collapsed).toBe(false);
    expect(after.rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });
});

describe("subscribe/unsubscribe lifecycle over /ws", () => {
  function openClient(): { client: KbWsClient; socket: FakeSocket } {
    const socket = new FakeSocket();
    const client = new KbWsClient({
      url: "ws://test/ws",
      makeSocket: () => socket,
      getRev: () => 1,
      onTx: () => {},
      onGap: () => {},
    });
    client.connect();
    socket.onopen?.();
    return { client, socket };
  }

  it("expand → subscribe frame, rows delivered, collapse → unsubscribe", () => {
    const { client, socket } = openClient();
    const got: unknown[][][] = [];

    const unsubscribe = subscribeQueryNode(client, "n.q1", EDN, (rows) => got.push(rows));
    const subFrame = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
    expect(subFrame).toEqual({
      op: "subscribe",
      id: querySubscriptionId("n.q1"),
      query: EDN,
    });

    socket.onmessage?.({
      data: JSON.stringify({
        op: "rows",
        id: querySubscriptionId("n.q1"),
        rev: 1,
        rows: [["n.root-a", "Ship kb ui shell"]],
      }),
    });
    expect(got).toEqual([[["n.root-a", "Ship kb ui shell"]]]);

    unsubscribe();
    const unsubFrame = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
    expect(unsubFrame).toEqual({
      op: "unsubscribe",
      id: querySubscriptionId("n.q1"),
    });

    // Late rows for a dead subscription never reach the callback.
    socket.onmessage?.({
      data: JSON.stringify({
        op: "rows",
        id: querySubscriptionId("n.q1"),
        rev: 2,
        rows: [["n.root-b", "late"]],
      }),
    });
    expect(got.length).toBe(1);
    client.disconnect();
  });

  it("active query subscriptions resubscribe after reconnect", () => {
    const { client, socket } = openClient();
    subscribeQueryNode(client, "n.q1", EDN, () => {});
    socket.sent.length = 0;

    // Drop and reopen the socket (client reconnects with same subs).
    socket.onclose?.();
    // KbWsClient schedules reconnect; simulate by reconnecting directly.
    client.connect();
    // connect() replaced the socket via makeSocket — same fake instance.
    socket.onopen?.();
    const frames = socket.sent.map((f) => JSON.parse(f) as { op: string; id?: string });
    expect(frames.some((f) => f.op === "subscribe" && f.id === querySubscriptionId("n.q1"))).toBe(
      true,
    );
    client.disconnect();
  });
});
