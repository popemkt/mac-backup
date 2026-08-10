/**
 * Stable facade for the `kb ui` surface.
 *
 * Implementation lives under `./ui/`:
 * - `assets` — Effect FileSystem static SPA + `.kb/assets` serving
 * - `http` — Effect REST/API request routing + failure mapping
 * - `session` — Effect SubscriptionHub (message/broadcast/cleanup)
 * - `server` — Bun.serve / Effect runtime boundary, fs-watch, CLI entry
 * - `saved-queries` — Effect listing of `.kb/queries/*.edn` + virtual nodes
 */
export type { UiServerHandle, UiServerOptions } from "./ui/server.ts";
export { runUiCli, startUi } from "./ui/server.ts";
export { savedQueryNodes } from "./ui/saved-queries.ts";
export { UI_DIST } from "./ui/paths.ts";
export { UI_DEFAULT_PORT } from "./protocol.ts";
