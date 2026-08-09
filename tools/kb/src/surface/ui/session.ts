import type { KbContext } from "../../context.ts";
import type { KbNode } from "../../foundation/model.ts";
import { buildQueryDb, query } from "../../foundation/query/index.ts";
import {
  ClientMessageSchema,
  GraphSnapshotSchema,
  WireNodeSchema,
  type GraphSnapshot,
  type ServerMessage,
  type WireNode,
} from "../protocol.ts";

export type WsData = {
  clientId: string;
};

interface ClientState {
  ws: Bun.ServerWebSocket<WsData>;
  watchTx: boolean;
  /** subscription id → { query, lastHash } */
  subs: Map<string, { query: string; lastHash: string }>;
}

function toWireNode(node: KbNode): WireNode {
  return WireNodeSchema.parse(node);
}

function nodesToMap(nodes: KbNode[]): Map<string, KbNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

export function contentHash(nodes: KbNode[]): string {
  const sorted = [...nodes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return String(Bun.hash(JSON.stringify(sorted)));
}

export function rowsHash(rows: unknown[][]): string {
  return String(Bun.hash(JSON.stringify(rows)));
}

export function normalizeRows(raw: unknown): unknown[][] {
  if (raw == null) return [];
  const list =
    raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  return list.map((r) => (Array.isArray(r) ? r : [r]));
}

function send(ws: Bun.ServerWebSocket<WsData>, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // client gone — ignore
  }
}

export function diffNodes(
  oldMap: Map<string, KbNode>,
  newMap: Map<string, KbNode>,
): { upserts: WireNode[]; deletes: string[] } {
  const upserts: WireNode[] = [];
  const deletes: string[] = [];
  for (const [id, node] of newMap) {
    const prev = oldMap.get(id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(node)) {
      upserts.push(toWireNode(node));
    }
  }
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) deletes.push(id);
  }
  return { upserts, deletes };
}

/** Live WS graph + query subscription hub for `kb ui`. */
export class SubscriptionHub {
  rev = 0;
  private hash = "";
  private nodeMap = new Map<string, KbNode>();
  private clients = new Map<string, ClientState>();
  private ctx: KbContext;
  /** Virtual nodes (saved queries) merged into every broadcast/snapshot,
   * never written back to .kb/nodes.jsonl. */
  private virtual: KbNode[];

  constructor(ctx: KbContext, virtual: KbNode[] = []) {
    this.ctx = ctx;
    this.virtual = virtual;
    const merged = this.withVirtual(ctx.nodes);
    this.nodeMap = nodesToMap(merged);
    this.hash = contentHash(merged);
    ctx.qdb = buildQueryDb(merged);
  }

  private withVirtual(nodes: KbNode[]): KbNode[] {
    return this.virtual.length === 0 ? nodes : [...nodes, ...this.virtual];
  }

  get snapshot(): GraphSnapshot {
    return GraphSnapshotSchema.parse({
      rev: this.rev,
      nodes: [...this.nodeMap.values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(toWireNode),
    });
  }

  addClient(ws: Bun.ServerWebSocket<WsData>): void {
    const id = ws.data.clientId;
    this.clients.set(id, { ws, watchTx: false, subs: new Map() });
    send(ws, { op: "hello", rev: this.rev });
  }

  removeClient(ws: Bun.ServerWebSocket<WsData>): void {
    this.clients.delete(ws.data.clientId);
  }

  handleMessage(ws: Bun.ServerWebSocket<WsData>, raw: string): void {
    const client = this.clients.get(ws.data.clientId);
    if (!client) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send(ws, {
        op: "error",
        code: "invalid_json",
        message: "message is not valid JSON",
      });
      return;
    }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      send(ws, {
        op: "error",
        code: "invalid_message",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const msg = result.data;
    switch (msg.op) {
      case "ping":
        send(ws, { op: "pong" });
        break;
      case "watch-tx":
        client.watchTx = msg.enabled;
        break;
      case "unsubscribe":
        client.subs.delete(msg.id);
        break;
      case "subscribe": {
        try {
          const rows = normalizeRows(query(this.ctx.qdb, msg.query));
          const hash = rowsHash(rows);
          client.subs.set(msg.id, { query: msg.query, lastHash: hash });
          send(ws, { op: "rows", id: msg.id, rev: this.rev, rows });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send(ws, {
            op: "error",
            id: msg.id,
            code: "query_error",
            message,
          });
        }
        break;
      }
    }
  }

  /**
   * Apply a new node set. No-ops when content hash matches (guards
   * action→fs.watch double-fire). Bumps rev, broadcasts tx + row updates.
   */
  applyNodes(nodes: KbNode[]): void {
    const merged = this.withVirtual(nodes);
    const hash = contentHash(merged);
    if (hash === this.hash) return;

    const oldMap = this.nodeMap;
    const newMap = nodesToMap(merged);
    const { upserts, deletes } = diffNodes(oldMap, newMap);

    this.nodeMap = newMap;
    this.hash = hash;
    this.rev += 1;

    // Real nodes only — virtual saved-query nodes must never reach persist().
    this.ctx.nodes = nodes;
    this.ctx.qdb = buildQueryDb(merged);

    if (upserts.length > 0 || deletes.length > 0) {
      const tx: ServerMessage = {
        op: "tx",
        rev: this.rev,
        upserts,
        deletes,
      };
      for (const c of this.clients.values()) {
        if (c.watchTx) send(c.ws, tx);
      }
    }

    this.pushSubscriptionRows();
  }

  private pushSubscriptionRows(): void {
    for (const c of this.clients.values()) {
      for (const [id, sub] of c.subs) {
        try {
          const rows = normalizeRows(query(this.ctx.qdb, sub.query));
          const hash = rowsHash(rows);
          if (hash === sub.lastHash) continue;
          sub.lastHash = hash;
          send(c.ws, { op: "rows", id, rev: this.rev, rows });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send(c.ws, {
            op: "error",
            id,
            code: "query_error",
            message,
          });
        }
      }
    }
  }
}
