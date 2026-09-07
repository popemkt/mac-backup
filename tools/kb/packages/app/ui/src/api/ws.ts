/**
 * WebSocket client for the kb ui server (see protocol.ts for the wire
 * contract). Responsibilities:
 *  - connect /ws, track server rev from hello/tx messages
 *  - opt into node-level tx broadcasts (watch-tx) and hand deltas to the
 *    store's applyTx seam
 *  - close rev gaps by asking the server for the transactions it is holding
 *    (`since`), and fall back to onGap → /api/graph only when it answers
 *    `snapshot-required`
 *  - live query subscriptions (rows pushed on change)
 *  - reconnect with capped exponential backoff, resubscribing on open
 */
import { ServerMessageSchema, type ClientMessage, type ServerMessage } from "@kb/contracts";
import { getClientOrigin } from "@/api/action";

export type WsStatus = "idle" | "connecting" | "open" | "closed";

/**
 * The socket events this client listens to, and what each one carries. `error`
 * is absent on purpose: a browser socket always follows an error with a close,
 * and close is where reconnect belongs, so an error listener would be a seam
 * nothing reads.
 */
export interface WsEventMap {
  open: void;
  close: void;
  message: { data: unknown };
}

export type WsListener<K extends keyof WsEventMap> = (event: WsEventMap[K]) => void;

/**
 * Minimal socket surface so tests can inject a fake. It is the browser
 * listener contract narrowed to the three events the client uses, so a real
 * `WebSocket` satisfies it directly and a second listener never clobbers the
 * first.
 */
export interface WsLike {
  send(data: string): void;
  close(): void;
  addEventListener<K extends keyof WsEventMap>(type: K, listener: WsListener<K>): void;
  removeEventListener<K extends keyof WsEventMap>(type: K, listener: WsListener<K>): void;
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
  /**
   * The server cannot catch us up from our rev — its log window has moved
   * past it, or the rev belongs to a previous server process. The caller must
   * refetch /api/graph. An ordinary gap in the tx stream does *not* land here:
   * it is answered with `since` first, and only its `snapshot-required` reply
   * does.
   */
  onGap: (info: { expected: number; got: number }) => void;
  /** Server-sent error (query_error, invalid_message, …). */
  onServerError?: (err: { id?: string; code: string; message: string }) => void;
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

/**
 * A browser `WebSocket` *is* a `WsLike`: the port asks for the listener pair
 * it already has. The adapter that used to bridge on* handlers is gone with
 * the handlers.
 */
function defaultMakeSocket(url: string): WsLike {
  return new WebSocket(url);
}

export class KbWsClient {
  private opts: Required<Pick<KbWsClientOptions, "getRev" | "onTx" | "onGap">> & KbWsClientOptions;
  private socket: WsLike | null = null;
  /** Detaches the listeners attached to {@link socket}; null when there are none. */
  private detachSocket: (() => void) | null = null;
  private subs = new Map<string, Subscription>();
  private attempts = 0;
  /**
   * The rev we last asked to be caught up from. A burst of out-of-order
   * frames is one gap, not one request each; `rev` only moves when a delta is
   * applied, so this is exactly "we already asked about this state".
   */
  private catchUpFrom: number | null = null;
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
    const socket = this.socket;
    // Detach before closing: the close this asks for is ours, not a drop to
    // reconnect from, and a detached socket cannot report it back to us.
    this.dropSocket();
    socket?.close();
    this.setStatus("closed");
  }

  /** Live query: rows pushed now and on every change. Survives reconnect. */
  subscribe(id: string, query: string, onRows: (rows: unknown[][], rev: number) => void): void {
    this.subs.set(id, { query, onRows });
    this.send({ op: "subscribe", id, query });
  }

  unsubscribe(id: string): void {
    this.subs.delete(id);
    this.send({ op: "unsubscribe", id });
  }

  /** Ask for every transaction after the store's current rev. */
  reconcile(): void {
    this.requestCatchUp(this.opts.getRev());
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

    const onOpen = (): void => {
      this.attempts = 0;
      this.catchUpFrom = null;
      this.setStatus("open");
      this.send({ op: "watch-tx", enabled: true });
      for (const [id, sub] of this.subs) {
        this.send({ op: "subscribe", id, query: sub.query });
      }
    };
    const onMessage = (event: { data: unknown }): void => {
      this.handleMessage(String(event.data));
    };
    const onClose = (): void => {
      this.dropSocket();
      // No-op once the caller has disconnected; scheduleReconnect owns that test.
      this.scheduleReconnect();
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    this.detachSocket = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
  }

  /**
   * Forget the current socket. Detaching is what makes it forgotten — with the
   * listeners off, a late frame from an abandoned socket cannot reach us, so
   * no handler has to re-check which socket it belongs to.
   */
  private dropSocket(): void {
    this.detachSocket?.();
    this.detachSocket = null;
    this.socket = null;
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

  /** Ask the server for everything after `rev`. Idempotent per rev. */
  private requestCatchUp(rev: number): void {
    if (this.catchUpFrom === rev) return;
    this.catchUpFrom = rev;
    this.send({ op: "since", rev });
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
        // mismatch means we may have missed txs. Ask for them; the server
        // says `snapshot-required` when it cannot produce them.
        const cur = this.opts.getRev();
        if (msg.rev !== cur) this.requestCatchUp(cur);
        break;
      }
      case "tx": {
        const cur = this.opts.getRev();
        if (msg.rev <= cur) break; // duplicate/stale — already have it
        if (msg.rev !== cur + 1) {
          this.requestCatchUp(cur);
          break;
        }
        this.catchUpFrom = null;
        this.opts.onTx({
          rev: msg.rev,
          upserts: msg.upserts,
          deletes: msg.deletes,
        });
        break;
      }
      case "snapshot-required": {
        this.catchUpFrom = null;
        this.opts.onGap({ expected: this.opts.getRev(), got: msg.head });
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
      // Exhaustive over ServerMessage['op']; switch-exhaustiveness-check guards it
      // no default
    }
  }
}
