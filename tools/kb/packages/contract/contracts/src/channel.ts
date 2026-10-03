import type { Effect } from "effect";
import { Point, Service } from "@kb/plugin";
import type { ActionInvocation, ActionReceipt } from "./actions.ts";

/**
 * Plugin channels: a plugin's own conversation with the connections of the
 * `kb ui` server, over the one `/ws` socket (`DESIGN.md` → Plugin channels).
 * The server carries `{op: "channel", channel, data}` frames both ways and
 * owns nothing else. What `data` holds is the channel's own contract, stated
 * by the plugin that owns it. Every frame rides a socket the request guard
 * has already admitted, so a channel adds no endpoint.
 */

/** One connection, as a channel sees it. */
export interface ChannelPeer {
  /** The connection: one per socket, never reused. */
  readonly connection: string;
  /** The UI tab this connection publishes its screen as, or null while it publishes none. */
  readonly tab: () => string | null;
  /** Send `data` on this channel to this connection. A connection that has gone drops it. */
  readonly send: (data: unknown) => Effect.Effect<void>;
}

/** What a plugin contributes to {@link ChannelPoint} to own a channel. */
export interface Channel {
  /**
   * `peer` sent `data` on this channel. It never fails: a frame the channel
   * cannot take is answered on the channel itself, in its own terms.
   */
  readonly receive: (peer: ChannelPeer, data: unknown) => Effect.Effect<void>;
  /** The connection closed. Whatever the channel held for it is gone. */
  readonly drop: (connection: string) => Effect.Effect<void>;
}

/** The channels the `kb ui` server's plugins own, by contribution id (`<namespace>.<id>`). */
export const ChannelPoint = Point<Channel>()("kb.ui.channels");

/**
 * What the `kb ui` server offers the plugins it hosts: the registry, run as it
 * runs every call. A plugin lists the registry the way every surface does, by
 * calling `kb.manifest` on its own wire.
 */
export interface UiHostService {
  /** The root the server serves. */
  readonly root: string;
  /**
   * Run an invocation as `POST /api/action` runs it, approval included: the
   * session brought up to date, then the invoke core. Always a receipt.
   */
  readonly invoke: (invocation: ActionInvocation) => Effect.Effect<ActionReceipt>;
}

/** The `kb ui` server, as a service its plugins inject. Only that server provides it. */
export const UiHost = Service<UiHostService>()("kb.ui.host");
