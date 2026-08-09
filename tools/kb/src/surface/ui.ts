/**
 * Stable facade for the `kb ui` surface.
 *
 * Implementation lives under `./ui/`:
 * - `assets` — static SPA + `.kb/assets` serving
 * - `http` — REST/API request routing
 * - `session` — WebSocket clients + SubscriptionHub
 * - `server` — Bun.serve bootstrap, fs-watch, CLI entry
 * - `saved-queries` — virtual saved-query nodes
 */
export type { UiServerHandle, UiServerOptions } from "./ui/server.ts";
export { runUiCli, startUi } from "./ui/server.ts";
export { savedQueryNodes } from "./ui/saved-queries.ts";
export { UI_DIST } from "./ui/paths.ts";
export { UI_DEFAULT_PORT } from "./protocol.ts";
