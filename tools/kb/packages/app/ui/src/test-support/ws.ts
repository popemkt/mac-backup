/**
 * The one injected socket for @kb/ui tests.
 *
 * There is one {@link WsLike} port, so there is one double for it: three
 * hand-copied fakes drift, and each of them had to be edited again the moment
 * the port grew. Tests drive it with `accept` / `deliver` / `drop` — the three
 * moves a server has, named for what the server does rather than for the
 * socket event it lands on.
 */
import type { WsEventMap, WsLike, WsListener } from "@/api/ws";

export class FakeWsSocket implements WsLike {
  /** Raw frames the client sent, oldest first. */
  readonly sent: string[] = [];
  closed = false;

  private readonly listeners: { [K in keyof WsEventMap]: Set<WsListener<K>> } = {
    open: new Set(),
    close: new Set(),
    message: new Set(),
  };

  addEventListener<K extends keyof WsEventMap>(type: K, listener: WsListener<K>): void {
    this.listeners[type].add(listener);
  }

  removeEventListener<K extends keyof WsEventMap>(type: K, listener: WsListener<K>): void {
    this.listeners[type].delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.drop();
  }

  /** The server accepts the connection. */
  accept(): void {
    this.emit("open", undefined);
  }

  /** The socket drops without the client having asked for it. */
  drop(): void {
    this.emit("close", undefined);
  }

  /** Deliver one server frame, serialized the way the wire does. */
  deliver(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  private emit<K extends keyof WsEventMap>(type: K, event: WsEventMap[K]): void {
    // A listener may detach itself here — the client drops its close listener
    // from inside that very handler — and removing the element a `for…of` is
    // currently on is well defined for a Set.
    for (const listener of this.listeners[type]) listener(event);
  }
}
