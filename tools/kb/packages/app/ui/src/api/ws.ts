/**
 * WebSocket client for the kb ui server (see protocol.ts for the wire
 * contract). Responsibilities:
 *  - connect /ws and opt into node-level tx broadcasts (watch-tx)
 *  - carry the graph stream (`hello`, `tx`, `snapshot-required`, and the
 *    `since` question) between the socket and the replica's sync machine,
 *    which alone decides what they mean (session/replica.ts)
 *  - live query subscriptions (rows pushed on change)
 *  - this tab's screen: the latest record it published, and the commands the
 *    server sends it and their answers
 *  - plugin channels: a plugin's frames to this connection, and ours to it
 *  - reconnect with capped exponential backoff, resubscribing and
 *    republishing the screen on open
 */
import {
  ServerMessageSchema,
  type ClientMessage,
  type ScreenAck,
  type ScreenCommand,
  type ScreenState,
} from "@kb/contracts";
import { getClientOrigin } from "@/api/action";
import type { GraphMessage } from "@/session/replica";

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

export interface KbWsClientOptions {
  /** ws:// URL; defaults to /ws on the current origin. */
  url?: string;
  makeSocket?: (url: string) => WsLike;
  /** Every graph-stream message, in arrival order. */
  onGraph: (msg: GraphMessage) => void;
  /**
   * Server-sent error (invalid_message, …) that names no live subscription.
   * An error naming one goes to that subscription's sink instead.
   */
  onServerError?: (err: { id?: string; code: string; message: string }) => void;
  onStatus?: (status: WsStatus) => void;
  /**
   * A command the server asks this tab to carry out; the answer goes back
   * with {@link KbWsClient.answerScreenCommand} under the same id.
   */
  onScreenCommand?: (id: string, command: ScreenCommand) => void;
  /** The server refused a screen published as `tab`: another live connection owns that id. */
  onScreenRefused?: (tab: string) => void;
  /** Backoff bounds in ms (initial doubles up to max). */
  backoffInitialMs?: number;
  backoffMaxMs?: number;
}

/**
 * Where one live query's answers go: its rows, or the error the server
 * answers it with (a query that does not parse or run). Both belong to the
 * subscriber, which is the only one that can show them in place.
 */
export interface SubscriptionSink {
  rows: (rows: unknown[][], rev: number) => void;
  error: (err: { code: string; message: string }) => void;
}

interface Subscription {
  query: string;
  sink: SubscriptionSink;
}

/**
 * Where one plugin channel's frames go (`@kb/contracts` → `channel.ts`): the
 * data the plugin sends this connection, or the error the server answers the
 * channel with (no loaded plugin owns it).
 */
export interface ChannelSink {
  data: (data: unknown) => void;
  error: (err: { code: string; message: string }) => void;
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
  private opts: KbWsClientOptions;
  private socket: WsLike | null = null;
  /** Detaches the listeners attached to {@link socket}; null when there are none. */
  private detachSocket: (() => void) | null = null;
  private subs = new Map<string, Subscription>();
  private channels = new Map<string, ChannelSink>();
  /** The screen this tab last published; sent again whenever the socket opens. */
  private screen: { tab: string; state: ScreenState } | null = null;
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
    const socket = this.socket;
    // Detach before closing: the close this asks for is ours, not a drop to
    // reconnect from, and a detached socket cannot report it back to us.
    this.dropSocket();
    socket?.close();
    this.setStatus("closed");
  }

  /** Live query: rows pushed now and on every change. Survives reconnect. */
  subscribe(id: string, query: string, sink: SubscriptionSink): void {
    this.subs.set(id, { query, sink });
    this.send({ op: "subscribe", id, query });
  }

  unsubscribe(id: string): void {
    this.subs.delete(id);
    this.send({ op: "unsubscribe", id });
  }

  /** Ask for every transaction after `rev`. */
  since(rev: number): void {
    this.send({ op: "since", rev });
  }

  /** This tab's whole screen now, as the tab `tab`. Survives reconnect: the latest is sent on every open. */
  publishScreen(tab: string, state: ScreenState): void {
    this.screen = { tab, state };
    this.send({ op: "screen", tab, state });
  }

  /** Answer the server's screen command `id`. */
  answerScreenCommand(id: string, result: ScreenAck): void {
    this.send({ op: "screen-ack", id, result });
  }

  /**
   * Hear the plugin channel `channel`: what its plugin sends this connection
   * goes to `sink`, one sink per channel. Returns the unlisten.
   */
  listen(channel: string, sink: ChannelSink): () => void {
    this.channels.set(channel, sink);
    return () => {
      if (this.channels.get(channel) === sink) this.channels.delete(channel);
    };
  }

  /**
   * Send `data` on the plugin channel `channel`. Unlike a subscription it is
   * not replayed on reconnect: a channel's plugin forgets a connection that
   * closes, so a frame sent while the socket is down is dropped.
   */
  sendChannel(channel: string, data: unknown): void {
    this.send({ op: "channel", channel, data });
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
      this.setStatus("open");
      this.send({ op: "watch-tx", enabled: true });
      for (const [id, sub] of this.subs) {
        this.send({ op: "subscribe", id, query: sub.query });
      }
      if (this.screen !== null) this.send({ op: "screen", ...this.screen });
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

  /** An error naming a live subscription or a channel is that sink's to show; any other is the toast's. */
  private routeError(err: { id?: string | undefined; code: string; message: string }): void {
    const sink =
      err.id === undefined ? undefined : (this.subs.get(err.id)?.sink ?? this.channels.get(err.id));
    if (sink) sink.error(err);
    else this.opts.onServerError?.(err);
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
      case "hello":
      case "tx":
      case "snapshot-required":
        this.opts.onGraph(msg);
        break;
      case "rows": {
        this.subs.get(msg.id)?.sink.rows(msg.rows, msg.rev);
        break;
      }
      case "error":
        this.routeError(msg);
        break;
      case "channel":
        this.channels.get(msg.channel)?.data(msg.data);
        break;
      case "screen-command":
        this.opts.onScreenCommand?.(msg.id, msg.command);
        break;
      case "screen-refused":
        this.opts.onScreenRefused?.(msg.tab);
        break;
      case "pong":
        break;
      // Exhaustive over ServerMessage['op']; switch-exhaustiveness-check guards it
      // no default
    }
  }
}
