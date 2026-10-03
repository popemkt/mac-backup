/**
 * The sandbox (roadmap step 9, decisions 4 and 5): one capability API over
 * the MCP Apps bridge, run by two engines under one contract. DESIGN.md →
 * Sandbox states the model and its threat model; this package is its
 * vocabulary and the parts every host shares.
 */
export {
  ENGINE_KINDS,
  ENGINE_LIMITS,
  SandboxLimits,
  engineKindFor,
  type EngineKind,
} from "./limits.ts";
export { GRAPH_READ, NODE_READ, grantRefusal, withinSubject, type GrantScope } from "./grant.ts";
export {
  END_REASONS,
  EventNotification,
  FrameMessage,
  GuestEnd,
  GuestMessage,
  KB_METHODS,
  KbEvent,
  LOG_LEVELS,
  PageMessage,
  Response,
  RunInput,
  RunStatus,
  ToolCall,
  ToolCallRequest,
  ToolResult,
  errorMessage,
  notification,
  resultMessage,
  type EndReason,
  type LogLevel,
} from "./protocol.ts";
export {
  drawingToDom,
  drawingToHtml,
  sanitizeDrawing,
  type DrawingDocument,
  type DrawingElement,
  type DrawingReport,
  type SafeNode,
} from "./drawing.ts";
export { guestScript, type GuestInit } from "./prelude.ts";
export {
  endOf,
  endOfFailure,
  makeSessionCore,
  type GuestSession,
  type GuestSpec,
  type SandboxEngine,
  type SessionCore,
} from "./engine.ts";
export { runGuest, type GuestHost, type GuestRun } from "./guest.ts";
export { SCRIPT_WIRE, answerToolCall, type CapabilityHost, type RunScope } from "./capability.ts";
export { codeDigest, isCodeDigest } from "./digest.ts";
export {
  SANDBOX_DRAW_ID,
  SANDBOX_FRAME_CSP,
  SANDBOX_FRAME_HEADERS,
  SANDBOX_FRAME_PATH,
  SANDBOX_IFRAME_FLAGS,
  SANDBOX_SCRIPT_PATH,
  SANDBOX_STATUS_ID,
  sandboxFrameDocument,
} from "./frame.ts";
