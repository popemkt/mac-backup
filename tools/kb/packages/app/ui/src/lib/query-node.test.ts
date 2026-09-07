/**
 * W4 query-node lib: definition extraction, result-id mapping, and the
 * subscribe/unsubscribe lifecycle over the /ws client.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { KbWsClient } from "@/api/ws";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  isQueryNode,
  queryDefOf,
  querySubscriptionId,
  resultNodeIds,
  subscribeQueryNode,
} from "@/lib/query-node";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FakeWsSocket } from "@/test-support/ws";
import type { WireNode } from "@kb/contracts";

const EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";

function queryWire(id = "n.q1", extraProps: WireNode["props"] = {}): WireNode {
  return {
    id,
    text: "Open todos",
    props: {
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

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // node env without localStorage
  }
  hydrate([queryWire()]);
});

describe("queryDefOf / isQueryNode", () => {
  it("extracts EDN and limit from a query node", () => {
    hydrate([
      queryWire("n.q1", {
        [SYSTEM_IDS.queryLimitField]: [{ t: "num", v: 3 }],
      }),
    ]);
    const node = useOutlineStore.getState().nodes.get("n.q1");
    expect(isQueryNode(node)).toBe(true);
    expect(queryDefOf(node)).toEqual({ edn: EDN, limit: 3 });
  });

  it("null for plain nodes, and for a query node whose EDN is blank", () => {
    const plain = useOutlineStore.getState().nodes.get("n.root-c");
    expect(isQueryNode(plain)).toBe(false);
    expect(queryDefOf(plain)).toBeNull();

    // The field is present but empty — still a query node (that is what the
    // row the user is editing looks like), with nothing yet to subscribe to.
    hydrate([
      {
        ...queryWire("n.q2"),
        props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "" }] },
      },
    ]);
    const noEdn = useOutlineStore.getState().nodes.get("n.q2");
    expect(isQueryNode(noEdn)).toBe(true);
    expect(queryDefOf(noEdn)).toBeNull();
  });

  it("a node merely TAGGED `query` is not a query node — the field is the kind", () => {
    // The old reader accepted any tag whose name was "query", so a user tag
    // called `query` silently turned its members into live subscriptions.
    hydrate([
      {
        id: "t.query",
        text: "query",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
        children: [],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
      {
        id: "n.tagged",
        text: "tagged, not a query",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.query" }] },
        children: [],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    ]);
    const tagged = useOutlineStore.getState().nodes.get("n.tagged");
    expect(isQueryNode(tagged)).toBe(false);
    expect(queryDefOf(tagged)).toBeNull();
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
    const q1 = present(store.nodes.get("n.q1"), "n.q1");
    expect(q1.collapsed).toBe(true);
    expect(q1.children).toEqual([]);

    store.toggleCollapse("n.q1");
    expect(present(useOutlineStore.getState().nodes.get("n.q1"), "n.q1").collapsed).toBe(false);

    // Non-query leaf nodes still cannot toggle.
    useOutlineStore.getState().toggleCollapse("n.root-c");
    expect(present(useOutlineStore.getState().nodes.get("n.root-c"), "n.root-c").collapsed).toBe(
      false,
    );

    useOutlineStore.getState().toggleCollapse("n.q1");
    expect(present(useOutlineStore.getState().nodes.get("n.q1"), "n.q1").collapsed).toBe(true);
  });

  it("expanded state survives a tx-driven map rebuild", () => {
    const store = useOutlineStore.getState();
    store.toggleCollapse("n.q1");
    expect(present(useOutlineStore.getState().nodes.get("n.q1"), "n.q1").collapsed).toBe(false);
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
    expect(present(after.nodes.get("n.q1"), "n.q1").collapsed).toBe(false);
    expect(after.rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });
});

function openClient(): { client: KbWsClient; socket: FakeWsSocket } {
  const socket = new FakeWsSocket();
  const client = new KbWsClient({
    url: "ws://test/ws",
    makeSocket: () => socket,
    getRev: () => 1,
    onTx: () => {},
    onGap: () => {},
  });
  client.connect();
  socket.accept();
  return { client, socket };
}

describe("subscribe/unsubscribe lifecycle over /ws", () => {
  it("expand → subscribe frame, rows delivered, collapse → unsubscribe", () => {
    const { client, socket } = openClient();
    const got: unknown[][][] = [];

    const unsubscribe = subscribeQueryNode(client, "n.q1", EDN, (rows) => got.push(rows));
    const subFrame = JSON.parse(present(socket.sent.at(-1), "last frame")) as Record<
      string,
      unknown
    >;
    expect(subFrame).toEqual({
      op: "subscribe",
      id: querySubscriptionId("n.q1"),
      query: EDN,
    });

    socket.deliver({
      op: "rows",
      id: querySubscriptionId("n.q1"),
      rev: 1,
      rows: [["n.root-a", "Ship kb ui shell"]],
    });
    expect(got).toEqual([[["n.root-a", "Ship kb ui shell"]]]);

    unsubscribe();
    const unsubFrame = JSON.parse(present(socket.sent.at(-1), "last frame")) as Record<
      string,
      unknown
    >;
    expect(unsubFrame).toEqual({
      op: "unsubscribe",
      id: querySubscriptionId("n.q1"),
    });

    // Late rows for a dead subscription never reach the callback.
    socket.deliver({
      op: "rows",
      id: querySubscriptionId("n.q1"),
      rev: 2,
      rows: [["n.root-b", "late"]],
    });
    expect(got.length).toBe(1);
    client.disconnect();
  });

  it("active query subscriptions resubscribe after reconnect", () => {
    const { client, socket } = openClient();
    subscribeQueryNode(client, "n.q1", EDN, () => {});
    socket.sent.length = 0;

    // Drop and reopen the socket (client reconnects with same subs).
    socket.drop();
    // KbWsClient schedules reconnect; simulate by reconnecting directly.
    client.connect();
    // connect() replaced the socket via makeSocket — same fake instance.
    socket.accept();
    const frames = socket.sent.map((f) => JSON.parse(f) as { op: string; id?: string });
    expect(frames.some((f) => f.op === "subscribe" && f.id === querySubscriptionId("n.q1"))).toBe(
      true,
    );
    client.disconnect();
  });
});
