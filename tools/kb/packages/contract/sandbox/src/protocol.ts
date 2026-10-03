/**
 * The capability API's messages (DESIGN.md → Sandbox → The capability API).
 * One JSON-RPC dialect, the MCP Apps bridge's, runs on both hops: between
 * the guest's code and the frame that runs it, and between the frame and the
 * kb page that hosts it. A graph read or an action is the bridge's
 * `tools/call` of a registry action, so the guest's call passes from hop to
 * hop unchanged; drawing, events and the run's status are kb's own methods.
 * Everything a guest or a frame sends is decoded here before anything reads
 * it.
 */
import { Schema } from "effect";
import { JSON_RPC_VERSION, MCP_APPS_METHODS } from "@kb/contracts";
import { ENGINE_KINDS, SandboxLimits } from "./limits.ts";

/** kb's methods beside the MCP Apps ones. */
export const KB_METHODS = {
  /** guest → frame, notification: replace what the run draws. */
  draw: "kb/draw",
  /** guest → frame, notification: the guest's code threw; the run ends. */
  fail: "kb/fail",
  /** page → frame → guest, notification: something happened the guest may answer. */
  event: "kb/event",
  /** frame → page, notification: the run started, or ended and why. */
  status: "kb/status",
} as const;

const JsonRpc = Schema.Literal(JSON_RPC_VERSION);
const RequestId = Schema.Union([Schema.Finite, Schema.String]);

/** A tool call: a registry action by id, and its input. */
export const ToolCall = Schema.Struct({
  name: Schema.NonEmptyString,
  arguments: Schema.optionalKey(Schema.Unknown),
});
export type ToolCall = typeof ToolCall.Type;

/** An MCP `CallToolResult`, as far as kb fills one (`mcpToolResult`). */
export const ToolResult = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
});
export type ToolResult = typeof ToolResult.Type;

export const ToolCallRequest = Schema.Struct({
  jsonrpc: JsonRpc,
  id: RequestId,
  method: Schema.Literal(MCP_APPS_METHODS.toolsCall),
  params: ToolCall,
});
export type ToolCallRequest = typeof ToolCallRequest.Type;

export const LOG_LEVELS = ["debug", "info", "warning", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LogNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(MCP_APPS_METHODS.log),
  params: Schema.Struct({ level: Schema.Literals(LOG_LEVELS), data: Schema.String }),
});

const DrawNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(KB_METHODS.draw),
  params: Schema.Struct({ drawing: Schema.Unknown }),
});

const FailNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(KB_METHODS.fail),
  params: Schema.Struct({ message: Schema.String }),
});

/** Everything a guest may send. */
export const GuestMessage = Schema.Union([
  ToolCallRequest,
  DrawNotification,
  LogNotification,
  FailNotification,
]);
export type GuestMessage = typeof GuestMessage.Type;

/**
 * Something the guest may answer: a gesture on what it drew (`click`,
 * `input`, `change`, with the id of the nearest drawn element that has one
 * and the control's value), or `data` when the graph changed.
 */
export const KbEvent = Schema.Struct({
  type: Schema.Literals(["click", "input", "change", "data"]),
  target: Schema.NullOr(Schema.String),
  value: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])),
});
export type KbEvent = typeof KbEvent.Type;

export const EventNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(KB_METHODS.event),
  params: KbEvent,
});

/** What the page hands a frame to run: the MCP Apps tool input of a sandbox run. */
export const RunInput = Schema.Struct({
  code: Schema.String,
  subject: Schema.NullOr(Schema.String),
  engine: Schema.Literals(ENGINE_KINDS),
  limits: SandboxLimits,
});
export type RunInput = typeof RunInput.Type;

const ToolInputNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(MCP_APPS_METHODS.toolInput),
  params: Schema.Struct({ arguments: RunInput }),
});

/** A response to a request, either side. */
export const Response = Schema.Union([
  Schema.Struct({ jsonrpc: JsonRpc, id: RequestId, result: Schema.Unknown }),
  Schema.Struct({
    jsonrpc: JsonRpc,
    id: RequestId,
    error: Schema.Struct({ code: Schema.Finite, message: Schema.String }),
  }),
]);
export type Response = typeof Response.Type;

/** Why a run ended (`GuestEnd.reason`). */
export const END_REASONS = [
  "stopped",
  "interrupted",
  "out-of-memory",
  "error",
  "flood",
  "oversized",
] as const;
export type EndReason = (typeof END_REASONS)[number];

export const GuestEnd = Schema.Struct({
  reason: Schema.Literals(END_REASONS),
  message: Schema.String,
});
export type GuestEnd = typeof GuestEnd.Type;

export const RunStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("running"), engine: Schema.Literals(ENGINE_KINDS) }),
  Schema.Struct({
    state: Schema.Literal("ended"),
    engine: Schema.Literals(ENGINE_KINDS),
    end: GuestEnd,
  }),
]);
export type RunStatus = typeof RunStatus.Type;

const StatusNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(KB_METHODS.status),
  params: RunStatus,
});

const SizeNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(MCP_APPS_METHODS.sizeChanged),
  params: Schema.Struct({ width: Schema.Finite, height: Schema.Finite }),
});

const InitializeRequest = Schema.Struct({
  jsonrpc: JsonRpc,
  id: RequestId,
  method: Schema.Literal(MCP_APPS_METHODS.initialize),
  params: Schema.Unknown,
});

const InitializedNotification = Schema.Struct({
  jsonrpc: JsonRpc,
  method: Schema.Literal(MCP_APPS_METHODS.initialized),
});

/** Everything a frame may send its page. */
export const FrameMessage = Schema.Union([
  InitializeRequest,
  InitializedNotification,
  ToolCallRequest,
  LogNotification,
  StatusNotification,
  SizeNotification,
]);
export type FrameMessage = typeof FrameMessage.Type;

/** Everything a page may send its frame. */
export const PageMessage = Schema.Union([Response, ToolInputNotification, EventNotification]);
export type PageMessage = typeof PageMessage.Type;

/** A request's answer as the wire carries it. */
export function resultMessage(id: string | number, result: unknown): Response {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

export function errorMessage(id: string | number, message: string): Response {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code: -32603, message } };
}

/** A notification as the wire carries it. */
export function notification<M extends string, P>(
  method: M,
  params: P,
): { readonly jsonrpc: typeof JSON_RPC_VERSION; readonly method: M; readonly params: P } {
  return { jsonrpc: JSON_RPC_VERSION, method, params };
}
