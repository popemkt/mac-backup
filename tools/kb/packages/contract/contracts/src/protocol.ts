import { z } from "zod";
import { FailedReceiptSchema, SucceededReceiptSchema } from "./actions.ts";
import { ScreenAckSchema, ScreenCommandSchema, ScreenStateSchema } from "./screen.ts";

/**
 * Shared wire contract for the `kb ui` server (HTTP + WS) and its clients
 * (browser UI, thin subscriber apps). U1/U2/U3/U4 all code against this
 * file; changing a message shape means changing it here first.
 *
 * HTTP surface (all JSON, served on 127.0.0.1:<port>):
 *   GET  /api/graph     -> GraphSnapshot        (full node set + rev)
 *   GET  /api/manifest  -> ManifestEntry[]      (from registry.manifest())
 *   GET  /api/queries   -> SavedQuery[]         (.kb/queries/*.edn)
 *   POST /api/action    <- ActionInvocation     -> ActionResponse (registry.invoke)
 *   GET  /api/identity  -> ServerIdentity       (which root this server serves)
 *   GET  /ws            -> upgrade to WebSocket (messages below)
 * Static UI bundle is served from / (ui/dist). Opaque kb media files are
 * served read-only from GET /assets/* → .kb/assets/ (W6a).
 */

const PropValueSchema = z.union([
  z.object({ t: z.literal("str"), v: z.string() }),
  z.object({ t: z.literal("num"), v: z.number() }),
  z.object({ t: z.literal("bool"), v: z.boolean() }),
  z.object({ t: z.literal("date"), v: z.string() }),
  z.object({ t: z.literal("ref"), v: z.string() }),
]);

export const WireNodeSchema = z.object({
  id: z.string(),
  text: z.string(),
  props: z.record(z.string(), z.array(PropValueSchema)),
  children: z.array(z.string()),
  order: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WireNode = z.infer<typeof WireNodeSchema>;

/** `rev` is a monotonically increasing counter over the **store's** durable
 * transaction tail, bumped on every observed change of the store (and on a
 * change to the saved-query set, which is a logged transaction too). It
 * survives a server restart, so a client that reconnects with the rev it had
 * is usually caught up with frames rather than a snapshot. Clients use it to
 * detect missed updates: a gap is answered with `since`, and only a rev the
 * tail cannot cover — compacted past, from another store, or at or below a
 * head the tail cannot vouch for — falls back to refetching /api/graph. */
export const GraphSnapshotSchema = z.object({
  rev: z.number().int().nonnegative(),
  nodes: z.array(WireNodeSchema),
});
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

/**
 * What `POST /api/action` answers: the invocation's receipt, and on success
 * `rev`, the log's head once the invocation had committed. Every frame the
 * invocation caused is at or below it, so a client that has applied `rev`
 * has seen the write, whether or not it caused a frame at all.
 */
export const ActionResponseSchema = z.discriminatedUnion("status", [
  SucceededReceiptSchema.extend({ rev: z.number().int().nonnegative() }),
  FailedReceiptSchema,
]);
export type ActionResponse = z.infer<typeof ActionResponseSchema>;

/**
 * Which root this server serves (absolute, symlinks resolved). A process
 * that found the server through `.kb/ui.json` asks this before it forwards
 * anything, so a stale file whose port another root's server now holds is
 * never mistaken for its own.
 */
export const ServerIdentitySchema = z.object({ root: z.string() });
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>;

export const SavedQuerySchema = z.object({
  name: z.string(),
  edn: z.string(),
});
export type SavedQuery = z.infer<typeof SavedQuerySchema>;

// ── WS: client -> server ────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion("op", [
  /** Subscribe to a live datalog query; server pushes `rows` on change. */
  z.object({
    op: z.literal("subscribe"),
    id: z.string().min(1),
    query: z.string().min(1), // EDN datalog, same dialect as graph.query
  }),
  z.object({ op: z.literal("unsubscribe"), id: z.string().min(1) }),
  /**
   * Catch me up from `rev`: the server replies with the `tx` frames after it,
   * in order, or with `snapshot-required` when its log cannot cover them.
   */
  z.object({ op: z.literal("since"), rev: z.number().int().nonnegative() }),
  /** Opt in/out of node-level tx broadcasts (browser UI wants these). */
  z.object({ op: z.literal("watch-tx"), enabled: z.boolean() }),
  z.object({ op: z.literal("ping") }),
  /**
   * This connection is the UI tab `tab`, and this is its whole screen now
   * (`screen.ts`). Sent on connect and whenever the screen changes. The tab
   * id belongs to the first live connection that publishes it; another
   * connection naming it gets `screen-refused`. The server keeps the latest
   * screen per tab and forgets it when the owning connection closes.
   */
  z.object({ op: z.literal("screen"), tab: z.string().min(1), state: ScreenStateSchema }),
  /** The tab's answer to the `screen-command` with this `id`. */
  z.object({ op: z.literal("screen-ack"), id: z.string().min(1), result: ScreenAckSchema }),
  /**
   * A frame for the plugin channel `channel` (`channel.ts`): `data` is that
   * channel's own message, which the server hands over untouched. A channel
   * no loaded plugin owns is answered with an `error` of code
   * `unknown_channel` whose `id` names it.
   */
  z.object({ op: z.literal("channel"), channel: z.string().min(1), data: z.unknown() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ── WS: server -> client ────────────────────────────────────────────────

export const ServerMessageSchema = z.discriminatedUnion("op", [
  /** First message after connect. */
  z.object({ op: z.literal("hello"), rev: z.number().int() }),
  /** Node-level delta after a store change (from any surface: UI, CLI,
   * MCP, agents). Clients transact this into their local DataScript. */
  z.object({
    op: z.literal("tx"),
    rev: z.number().int(),
    upserts: z.array(WireNodeSchema),
    deletes: z.array(z.string()),
  }),
  /** Live query result push (full rows, v1; delta shape reserved). */
  z.object({
    op: z.literal("rows"),
    id: z.string(),
    rev: z.number().int(),
    rows: z.array(z.array(z.unknown())),
  }),
  z.object({
    op: z.literal("error"),
    /** The subscription or channel the error is about, when it is about one. */
    id: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
  /**
   * Answer to `since` when the gap cannot be expressed as frames: the tail
   * has been compacted past it, the client's rev belongs to another store's
   * counter, or the tail is behind the store it describes and so cannot vouch
   * for any rev at or below its head. `head` is the rev a fresh /api/graph
   * will carry.
   */
  z.object({ op: z.literal("snapshot-required"), head: z.number().int() }),
  z.object({ op: z.literal("pong") }),
  /**
   * Carry out this command (`ui.navigate`, `ui.select`) and answer with a
   * `screen-ack` of the same `id`. Sent only to a connection that has
   * published a screen.
   */
  z.object({
    op: z.literal("screen-command"),
    id: z.string().min(1),
    command: ScreenCommandSchema,
  }),
  /**
   * The screen published as `tab` was not taken: another live connection
   * owns that tab id. The client picks a fresh id and publishes again.
   */
  z.object({ op: z.literal("screen-refused"), tab: z.string(), code: z.literal("tab_in_use") }),
  /** A frame from the plugin that owns the channel `channel`, to this connection alone. */
  z.object({ op: z.literal("channel"), channel: z.string(), data: z.unknown() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const UI_DEFAULT_PORT = 4321;
