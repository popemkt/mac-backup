import { z } from "zod";

/**
 * Shared wire contract for the `kb ui` server (HTTP + WS) and its clients
 * (browser UI, thin subscriber apps). U1/U2/U3/U4 all code against this
 * file; changing a message shape means changing it here first.
 *
 * HTTP surface (all JSON, served on 127.0.0.1:<port>):
 *   GET  /api/graph     -> GraphSnapshot        (full node set + rev)
 *   GET  /api/manifest  -> ActionDefinition[]   (from registry.manifest())
 *   GET  /api/queries   -> SavedQuery[]         (.kb/queries/*.edn)
 *   POST /api/action    <- ActionInvocation     -> ActionReceipt (registry.invoke)
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WireNode = z.infer<typeof WireNodeSchema>;

/** `rev` is a monotonically increasing server counter, bumped on every
 * observed change of .kb/nodes.jsonl. Clients use it to detect missed
 * updates (gap => refetch /api/graph). */
export const GraphSnapshotSchema = z.object({
  rev: z.number().int().nonnegative(),
  nodes: z.array(WireNodeSchema),
});
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

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
  /** Opt in/out of node-level tx broadcasts (browser UI wants these). */
  z.object({ op: z.literal("watch-tx"), enabled: z.boolean() }),
  z.object({ op: z.literal("ping") }),
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
    id: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
  z.object({ op: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const UI_DEFAULT_PORT = 4321;
