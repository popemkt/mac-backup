/**
 * The MCP Apps extension (`io.modelcontextprotocol/ui`, spec 2026-01-26), as
 * far as kb speaks it: the resource type an app is served as, the protocol
 * version, and the JSON-RPC methods an app and its host exchange over
 * `postMessage`. Stated once, because kb is on both sides of the bridge: a
 * `ui://kb/view/*` snapshot is an app inside an MCP host, and the kb page is
 * the host of every sandbox frame (DESIGN.md → Sandbox).
 */

/** The MIME type an MCP Apps UI resource is served as. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/** The MCP Apps protocol version kb speaks. */
export const MCP_APPS_VERSION = "2026-01-26";

/** The JSON-RPC version every message names. */
export const JSON_RPC_VERSION = "2.0";

/**
 * The methods kb uses, by who sends them. An app asks its host to
 * initialize, then says it has; it calls the host's tools and reads its
 * resources, logs through it, and tells it its size. A host hands the app
 * the tool input it renders.
 */
export const MCP_APPS_METHODS = {
  /** app → host, request: the handshake; the result names the host's capabilities. */
  initialize: "ui/initialize",
  /** app → host, notification: the handshake is done. */
  initialized: "ui/notifications/initialized",
  /** host → app, notification: the arguments of the tool call the app renders. */
  toolInput: "ui/notifications/tool-input",
  /** app → host, notification: the app's content size changed. */
  sizeChanged: "ui/notifications/size-changed",
  /** app → host, request: call one of the host's (the server's) tools. */
  toolsCall: "tools/call",
  /** app → host, request: read a resource through the host. */
  resourcesRead: "resources/read",
  /** app → host, notification: a log line. */
  log: "notifications/message",
} as const;
