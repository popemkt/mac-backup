/**
 * The sandbox (roadmap step 9, decisions 4 and 5): one capability API over
 * the MCP Apps bridge, run by two engines under one contract. DESIGN.md →
 * Sandbox states the model and its threat model; this package is its
 * vocabulary and the parts every host shares.
 */
// GAP [[01M41DKTE1T51M031N231VGQJR]] Only code views run: a #script attached to a view, its
// overlays above that view and the view's own events wait on views declaring
// them (DESIGN.md → Sandbox → Gaps).
export {
  ENGINE_KINDS,
  ENGINE_LIMITS,
  SandboxLimits,
  engineKindFor,
  type EngineKind,
} from "./limits.ts";
export {
  CodeGrant,
  GRAPH_READ,
  NODE_READ,
  READ_SCOPES,
  grantRefusal,
  withinSubject,
  type GrantScope,
  type ReadScope,
} from "./grant.ts";
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
  UntrustedEngine,
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
  SANDBOX_THEME_VARIABLES,
  safeThemeValue,
  sandboxFrameDocument,
} from "./frame.ts";
export { SNAPSHOT_BUDGET_MS, snapshotRun, type CodeRun, type CodeSnapshot } from "./snapshot.ts";
