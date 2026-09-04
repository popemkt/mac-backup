import { Effect } from "effect";
import {
  type KbContext,
  ClientMessageSchema,
  GraphSnapshotSchema,
  WireNodeSchema,
  type GraphSnapshot,
  type ServerMessage,
  type WireNode,
} from "@kb/contracts";
import type { KbNode } from "@kb/model";
import { buildQueryDb, query } from "@kb/query";

/** Bun.serve websocket attachment (server boundary only). */
export type WsData = {
  clientId: string;
};

/** Outbound send handle for a live WS client. Failures are ignored by the hub. */
export type ClientSend = (text: string) => Effect.Effect<void>;

interface ClientState {
  send: ClientSend;
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
  const sorted = [...nodes].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return String(Bun.hash(JSON.stringify(sorted)));
}

export function rowsHash(rows: unknown[][]): string {
  return String(Bun.hash(JSON.stringify(rows)));
}

export function normalizeRows(raw: unknown): unknown[][] {
  if (raw === undefined || raw === null) return [];
  const list = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  return list.map((r) => (Array.isArray(r) ? r : [r]));
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

/**
 * Live WS graph + query subscription hub for `kb ui`.
 *
 * Clients are tracked by an opaque clientId with an Effect-valued send
 * handle (acquired from the socket writer at the server boundary). Message
 * processing, broadcasting and cleanup are Effect programs — every method
 * returns `Effect<void>` and never throws.
 */
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

  /** Test hook: number of live clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  private withVirtual(nodes: KbNode[]): KbNode[] {
    return this.virtual.length === 0 ? nodes : [...nodes, ...this.virtual];
  }

  get snapshot(): GraphSnapshot {
    return GraphSnapshotSchema.parse({
      rev: this.rev,
      nodes: [...this.nodeMap.values()]
        .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(toWireNode),
    });
  }

  /** Register a client and send the connection `hello`. */
  addClient(clientId: string, send: ClientSend): Effect.Effect<void> {
    this.clients.set(clientId, { send, watchTx: false, subs: new Map() });
    return send(JSON.stringify({ op: "hello", rev: this.rev }));
  }

  /** Forget a client (socket closed / session interrupted). */
  removeClient(clientId: string): Effect.Effect<void> {
    this.clients.delete(clientId);
    return Effect.void;
  }

  /** Process one inbound WS frame. Never throws; failures become `error` frames. */
  handleMessage(clientId: string, raw: string): Effect.Effect<void> {
    const client = this.clients.get(clientId);
    if (!client) return Effect.void;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return client.send(
        JSON.stringify({
          op: "error",
          code: "invalid_json",
          message: "message is not valid JSON",
        }),
      );
    }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      return client.send(
        JSON.stringify({
          op: "error",
          code: "invalid_message",
          message: result.error.issues.map((i) => i.message).join("; "),
        }),
      );
    }

    const msg = result.data;
    switch (msg.op) {
      case "ping":
        return client.send(JSON.stringify({ op: "pong" }));
      case "watch-tx":
        client.watchTx = msg.enabled;
        return Effect.void;
      case "unsubscribe":
        client.subs.delete(msg.id);
        return Effect.void;
      case "subscribe": {
        try {
          const rows = normalizeRows(query(this.ctx.qdb, msg.query));
          const hash = rowsHash(rows);
          client.subs.set(msg.id, { query: msg.query, lastHash: hash });
          return client.send(JSON.stringify({ op: "rows", id: msg.id, rev: this.rev, rows }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return client.send(
            JSON.stringify({
              op: "error",
              id: msg.id,
              code: "query_error",
              message,
            }),
          );
        }
      }
      default: {
        // Unreachable: `never` makes the compiler prove the switch is
        // exhaustive over ClientMessage. The clause exists because the switch
        // must produce a value, and it answers with a frame rather than a
        // throw so this method keeps its "never throws" contract.
        const unhandled: never = msg;
        return client.send(
          JSON.stringify({
            op: "error",
            code: "invalid_message",
            message: `unsupported op: ${JSON.stringify(unhandled)}`,
          }),
        );
      }
    }
  }

  /**
   * Apply a new node set. No-ops when content hash matches (guards
   * action→fs.watch double-fire). Bumps rev, broadcasts tx + row updates.
   * The node-set mutation is synchronous (atomic at the JS level); the
   * broadcast sends are returned as an Effect sequence.
   */
  applyNodes(nodes: KbNode[], origin?: string): Effect.Effect<void> {
    const merged = this.withVirtual(nodes);
    const hash = contentHash(merged);
    if (hash === this.hash) return Effect.void;

    const oldMap = this.nodeMap;
    const newMap = nodesToMap(merged);
    const { upserts, deletes } = diffNodes(oldMap, newMap);

    this.nodeMap = newMap;
    this.hash = hash;
    this.rev += 1;

    // Real nodes only — virtual saved-query nodes must never reach persist().
    this.ctx.nodes = nodes;
    this.ctx.qdb = buildQueryDb(merged);

    const sends: Effect.Effect<void>[] = [];

    if (upserts.length > 0 || deletes.length > 0) {
      const tx: ServerMessage = {
        op: "tx",
        rev: this.rev,
        upserts,
        deletes,
      };
      const payload = JSON.stringify(tx);
      for (const [clientId, c] of this.clients) {
        if (c.watchTx && clientId !== origin) sends.push(c.send(payload));
      }
    }

    for (const c of this.clients.values()) {
      for (const [id, sub] of c.subs) {
        try {
          const rows = normalizeRows(query(this.ctx.qdb, sub.query));
          const subHash = rowsHash(rows);
          if (subHash === sub.lastHash) continue;
          sub.lastHash = subHash;
          sends.push(c.send(JSON.stringify({ op: "rows", id, rev: this.rev, rows })));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sends.push(c.send(JSON.stringify({ op: "error", id, code: "query_error", message })));
        }
      }
    }

    if (sends.length === 0) return Effect.void;
    return Effect.all(sends).pipe(Effect.map(() => undefined));
  }
}
