/**
 * A UI tab for tests: a `/ws` connection that publishes a screen and answers
 * the server's screen commands as it is told to, speaking only the protocol
 * (`@kb/contracts` → `protocol.ts`). It stands in for the browser wherever a
 * test needs a live tab and has no page.
 */
import { Effect } from "effect";
import { present } from "@kb/model";
import {
  SCREEN_APPLIED,
  ServerMessageSchema,
  type ClientMessage,
  type ScreenAck,
  type ScreenCommand,
  type ScreenState,
  type ServerMessage,
} from "@kb/contracts";

/** What a plugin channel says to this connection: its data, or the server's error naming it. */
export type ChannelFrame =
  | { readonly kind: "data"; readonly data: unknown }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

function channelFrameOf(channel: string, msg: ServerMessage): ChannelFrame | null {
  if (msg.op === "channel" && msg.channel === channel) return { kind: "data", data: msg.data };
  if (msg.op === "error" && msg.id === channel) {
    return { kind: "error", code: msg.code, message: msg.message };
  }
  return null;
}

/** How the tab answers a command: with this ack, or not at all. */
export type FakeTabAnswer = ScreenAck | "silent";

/** A screen with one pane, on the outline, showing nothing in particular. */
export const FAKE_TAB_SCREEN: ScreenState = {
  route: "/",
  active: true,
  activePane: "main",
  panes: [
    {
      id: "main",
      view: { key: "outline.main", subject: "n.fake-tab-root" },
      focused: null,
      selection: [],
    },
  ],
};

export class FakeTab {
  readonly id: string;
  /** The commands this tab has received, in order. */
  readonly commands: ScreenCommand[] = [];
  /** How it answers the next command. */
  answer: FakeTabAnswer = SCREEN_APPLIED;
  /** The tab ids the server refused this connection, in order. */
  readonly refused: string[] = [];
  readonly #socket: WebSocket;
  readonly #waiters = new Set<(msg: ServerMessage) => void>();

  private constructor(id: string, socket: WebSocket) {
    this.id = id;
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const msg = ServerMessageSchema.parse(JSON.parse(String(event.data)));
      if (msg.op === "screen-command") this.#carryOut(msg.id, msg.command);
      if (msg.op === "screen-refused") this.refused.push(msg.tab);
      for (const waiter of this.#waiters) waiter(msg);
    });
  }

  /** Connect to the `kb ui` at `url` as the tab `id`, and publish `screen`. */
  static open(url: string, id: string, screen = FAKE_TAB_SCREEN): Effect.Effect<FakeTab> {
    return Effect.gen(function* () {
      const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
      const tab = new FakeTab(id, socket);
      yield* tab.#exchange(null, (msg) => msg.op === "hello");
      yield* tab.publish(screen);
      return tab;
    });
  }

  /** Publish `state` as this tab, and return once the server has taken it or refused it. */
  publish(state: ScreenState): Effect.Effect<void> {
    this.#send({ op: "screen", tab: this.id, state });
    // The server handles one connection's frames in order, so its pong comes
    // after it has taken (or refused) the screen.
    return this.#exchange({ op: "ping" }, (msg) => msg.op === "pong").pipe(Effect.asVoid);
  }

  /**
   * Send `data` on the plugin channel `channel` and wait for the first frame
   * on it that `until` accepts: the channel's own data, or the server's error
   * naming it. The wait starts before the send.
   */
  channel(
    channel: string,
    data: unknown,
    until: (frame: ChannelFrame) => boolean,
  ): Effect.Effect<ChannelFrame> {
    return this.#exchange({ op: "channel", channel, data }, (msg) => {
      const frame = channelFrameOf(channel, msg);
      return frame !== null && until(frame);
    }).pipe(Effect.map((msg) => present(channelFrameOf(channel, msg), "a frame on the channel")));
  }

  /** Wait for the first frame on the plugin channel `channel` that `until` accepts, sending nothing. */
  hear(channel: string, until: (frame: ChannelFrame) => boolean): Effect.Effect<ChannelFrame> {
    return this.#exchange(null, (msg) => {
      const frame = channelFrameOf(channel, msg);
      return frame !== null && until(frame);
    }).pipe(Effect.map((msg) => present(channelFrameOf(channel, msg), "a frame on the channel")));
  }

  /** Close the socket, and return once it is closed. */
  get close(): Effect.Effect<void> {
    const socket = this.#socket;
    return Effect.callback<void>((resume) => {
      if (socket.readyState === WebSocket.CLOSED) return resume(Effect.void);
      socket.addEventListener("close", () => resume(Effect.void), { once: true });
      socket.close();
    });
  }

  #carryOut(id: string, command: ScreenCommand): void {
    this.commands.push(command);
    if (this.answer !== "silent") this.#send({ op: "screen-ack", id, result: this.answer });
  }

  #send(msg: ClientMessage): void {
    this.#socket.send(JSON.stringify(msg));
  }

  /**
   * Send `msg` (when there is one, and once the socket is open) and wait for
   * the first frame `pred` accepts. The wait starts before the send, so a
   * quick answer is never missed.
   */
  #exchange(
    msg: ClientMessage | null,
    pred: (reply: ServerMessage) => boolean,
  ): Effect.Effect<ServerMessage> {
    return Effect.callback<ServerMessage>((resume) => {
      const waiter = (reply: ServerMessage): void => {
        if (!pred(reply)) return;
        this.#waiters.delete(waiter);
        resume(Effect.succeed(reply));
      };
      this.#waiters.add(waiter);
      if (msg !== null) this.#send(msg);
      return Effect.sync(() => this.#waiters.delete(waiter));
    });
  }
}
