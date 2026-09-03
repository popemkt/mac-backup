/**
 * WebSocket client for the kb ui server (see protocol.ts for the wire
 * contract). Responsibilities:
 *  - connect /ws, track server rev from hello/tx messages
 *  - opt into node-level tx broadcasts (watch-tx) and hand deltas to the
 *    store's applyTx seam
 *  - detect rev gaps (missed messages / server restart) → onGap, caller
 *    refetches /api/graph
 *  - live query subscriptions (rows pushed on change)
 *  - reconnect with capped exponential backoff, resubscribing on open
 */
import {
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@kb/contracts";
import { getClientOrigin } from "@/api/action";

export type WsStatus = "idle" | "connecting" | "open" | "closed";

/** Minimal socket surface so tests can inject a fake. */
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface TxDelta {
  rev: number;
  upserts: Extract<ServerMessage, { op: "tx" }>["upserts"];
  deletes: string[];
}

export interface KbWsClientOptions {
  /** ws:// URL; defaults to /ws on the current origin. */
  url?: string;
  makeSocket?: (url: string) => WsLike;
  /** Current client graph rev (usually from the outline store). */
  getRev: () => number;
  /** Contiguous node-level delta — transact into local DataScript. */
  onTx: (tx: TxDelta) => void;
  /** Rev gap detected — caller must refetch /api/graph. */
  onGap: (info: { expected: number; got: number }) => void;
  /** Server-sent error (query_error, invalid_message, …). */
  onServerError?: (err: {
    id?: string;
    code: string;
    message: string;
  }) => void;
  onStatus?: (status: WsStatus) => void;
  /** Backoff bounds in ms (initial doubles up to max). */
  backoffInitialMs?: number;
  backoffMaxMs?: number;
}

interface Subscription {
  query: string;
  onRows: (rows: unknown[][], rev: number) => void;
}

function defaultUrl(): string {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws?origin=${encodeURIComponent(getClientOrigin())}`;
}

function defaultMakeSocket(url: string): WsLike {
  return new WebSocket(url) as unknown as WsLike;
}

export class KbWsClient {
  private opts: Required<
    Pick<KbWsClientOptions, "getRev" | "onTx" | "onGap">
  > &
    KbWsClientOptions;
  private socket: WsLike | null = null;
  private subs = new Map<string, Subscription>();
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  status: WsStatus = "idle";

  constructor(opts: KbWsClientOptions) {
    this.opts = opts;
  }

  connect(): void {
    this.closedByUser = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) return; // already connecting/open
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  /** Live query: rows pushed now and on every change. Survives reconnect. */
  subscribe(
    id: string,
    query: string,
    onRows: (rows: unknown[][], rev: number) => void,
  ): void {
    this.subs.set(id, { query, onRows });
    this.send({ op: "subscribe", id, query });
  }

  unsubscribe(id: string): void {
    this.subs.delete(id);
    this.send({ op: "unsubscribe", id });
  }

  private setStatus(status: WsStatus): void {
    this.status = status;
    this.opts.onStatus?.(status);
  }

  private send(msg: ClientMessage): void {
    if (!this.socket || this.status !== "open") return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      // socket died between status check and send; reconnect handles it
    }
  }

  private open(): void {
    const make = this.opts.makeSocket ?? defaultMakeSocket;
    const url = this.opts.url ?? defaultUrl();
    this.setStatus("connecting");
    let socket: WsLike;
    try {
      socket = make(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.attempts = 0;
      this.setStatus("open");
      this.send({ op: "watch-tx", enabled: true });
      for (const [id, sub] of this.subs) {
        this.send({ op: "subscribe", id, query: sub.query });
      }
    };
    socket.onmessage = (ev) => {
      if (socket !== this.socket) return;
      this.handleMessage(String(ev.data));
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose follows; nothing to do here
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const initial = this.opts.backoffInitialMs ?? 500;
    const max = this.opts.backoffMaxMs ?? 10_000;
    const delay = Math.min(initial * 2 ** this.attempts, max);
    this.attempts += 1;
    this.setStatus("closed");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.opts.onServerError?.({
        code: "invalid_server_message",
        message: "server sent non-JSON frame",
      });
      return;
    }
    const parsed = ServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.opts.onServerError?.({
        code: "invalid_server_message",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }
    const msg = parsed.data;
    switch (msg.op) {
      case "hello": {
        // Reconnect (or first connect against a moved server): any rev
        // mismatch means we may have missed txs — resync via snapshot.
        const cur = this.opts.getRev();
        if (msg.rev !== cur) {
          this.opts.onGap({ expected: cur, got: msg.rev });
        }
        break;
      }
      case "tx": {
        const cur = this.opts.getRev();
        if (msg.rev <= cur) break; // duplicate/stale — already have it
        if (msg.rev !== cur + 1) {
          this.opts.onGap({ expected: cur + 1, got: msg.rev });
          break;
        }
        this.opts.onTx({
          rev: msg.rev,
          upserts: msg.upserts,
          deletes: msg.deletes,
        });
        break;
      }
      case "rows": {
        this.subs.get(msg.id)?.onRows(msg.rows, msg.rev);
        break;
      }
      case "error":
        this.opts.onServerError?.(msg);
        break;
      case "pong":
        break;
    }
  }
}
