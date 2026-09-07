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
import type { KbNode, KbTx } from "@kb/model";

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

/** What one query answered this transaction, shared by every subscription on it. */
type QueryAnswer = { ok: true; rows: unknown[][]; hash: string } | { ok: false; message: string };

function toWireNode(node: KbNode): WireNode {
  return WireNodeSchema.parse(node);
}

export function rowsHash(rows: unknown[][]): string {
  return String(Bun.hash(JSON.stringify(rows)));
}

/**
 * Live WS graph + query subscription hub for `kb ui`.
 *
 * The hub is a reader of the session's transaction log, not a second producer
 * of deltas. It used to keep a private copy of the node set as clients last
 * saw it and diff `storedNodes()` against it on every commit, which made it
 * the third place a delta was derived and the only one that could disagree
 * with the store. Now it subscribes at construction and forwards what the log
 * says happened.
 *
 * Every frame goes to every watcher, including the client that caused the
 * write. Suppressing the echo was what left an origin's `rev` one behind after
 * each of its own writes, so the next foreign tx read as a gap and cost a full
 * snapshot; an optimistic local apply is idempotent under its own confirming
 * frame, so sending it is both cheaper and simpler than not.
 *
 * Clients are tracked by an opaque clientId with an Effect-valued send
 * handle (acquired from the socket writer at the server boundary). Message
 * processing, publishing and cleanup are Effect programs — every method
 * returns `Effect<void>` and never throws.
 *
 * It knows nothing about the saved-query virtual set any more. It used to be
 * handed those nodes at construction, which made it the one surface where a
 * node reached a client without a transaction; `SavedQuerySet` owns them now
 * and logs their changes, so the hub reads them off the log like everything
 * else.
 */
export class SubscriptionHub {
  private clients = new Map<string, ClientState>();
  private ctx: KbContext;
  private readonly unsubscribe: () => void;

  constructor(ctx: KbContext) {
    this.ctx = ctx;
    this.unsubscribe = ctx.log.subscribe((tx) => {
      // The log calls back synchronously from inside the commit; the sends it
      // produces are synchronous too, so forking keeps frame order while
      // refusing to let a slow client block the writer.
      Effect.runFork(this.publish(tx));
    });
  }

  /** Detach from the log. The server scope owns this. */
  dispose(): void {
    this.unsubscribe();
    this.clients.clear();
  }

  /** Test hook: number of live clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  get snapshot(): GraphSnapshot {
    return GraphSnapshotSchema.parse({
      rev: this.ctx.log.head,
      nodes: [...this.ctx.index.allNodes()]
        .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(toWireNode),
    });
  }

  /** Register a client and send the connection `hello`. */
  addClient(clientId: string, send: ClientSend): Effect.Effect<void> {
    this.clients.set(clientId, { send, watchTx: false, subs: new Map() });
    return send(JSON.stringify({ op: "hello", rev: this.ctx.log.head }));
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
      case "since": {
        // The frames themselves, not a nudge to refetch: a client that missed
        // three edits should receive three edits. Sent regardless of
        // `watchTx`, because asking is the opt-in.
        const caught = this.ctx.log.since(msg.rev);
        if (caught === "snapshot-required") {
          return client.send(JSON.stringify({ op: "snapshot-required", head: this.ctx.log.head }));
        }
        if (caught.length === 0) return Effect.void;
        return Effect.forEach(caught, (tx) => client.send(this.txFrame(tx))).pipe(Effect.asVoid);
      }
      case "subscribe": {
        try {
          const rows = this.ctx.index.runDatalog(msg.query);
          const hash = rowsHash(rows);
          client.subs.set(msg.id, { query: msg.query, lastHash: hash });
          return client.send(
            JSON.stringify({ op: "rows", id: msg.id, rev: this.ctx.log.head, rows }),
          );
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

  /** The `tx` frame for one logged transaction. */
  private txFrame(tx: KbTx): string {
    const frame: ServerMessage = {
      op: "tx",
      rev: tx.rev,
      upserts: tx.ops.upserts.map(toWireNode),
      deletes: tx.ops.deletes,
    };
    return JSON.stringify(frame);
  }

  /**
   * Forward one logged transaction: the delta to every watcher, then the rows
   * of every subscription whose answer moved.
   *
   * A query's answer depends on the index, not on who asked for it, so each
   * distinct query is run once per transaction and every subscription holding
   * it reads that one answer. The UI opens a subscription per query node on
   * screen, so the same board view in three tabs used to cost three identical
   * datalog runs on the hot path of every keystroke.
   *
   * The evaluation is shared; the decision is not. Each subscription keeps its
   * own last-seen hash, because two clients holding the same query can be at
   * different points in it — one just subscribed, one has been watching.
   */
  private publish(tx: KbTx): Effect.Effect<void> {
    const payload = this.txFrame(tx);
    const sends: Effect.Effect<void>[] = [];

    for (const c of this.clients.values()) {
      if (c.watchTx) sends.push(c.send(payload));
    }

    const answers = new Map<string, QueryAnswer>();
    for (const c of this.clients.values()) {
      for (const [id, sub] of c.subs) {
        let answer = answers.get(sub.query);
        if (answer === undefined) {
          answer = this.evaluate(sub.query);
          answers.set(sub.query, answer);
        }
        if (!answer.ok) {
          sends.push(
            c.send(
              JSON.stringify({ op: "error", id, code: "query_error", message: answer.message }),
            ),
          );
          continue;
        }
        if (answer.hash === sub.lastHash) continue;
        sub.lastHash = answer.hash;
        sends.push(c.send(JSON.stringify({ op: "rows", id, rev: tx.rev, rows: answer.rows })));
      }
    }

    if (sends.length === 0) return Effect.void;
    return Effect.all(sends).pipe(Effect.asVoid);
  }

  /** Run one query against the index; a datalog failure is an answer too. */
  private evaluate(query: string): QueryAnswer {
    try {
      const rows = this.ctx.index.runDatalog(query);
      return { ok: true, rows, hash: rowsHash(rows) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
