/**
 * Public surface of the `kb ui` server.
 *
 * Implementation modules, none of which are public:
 * - `assets` — Effect FileSystem static SPA + `.kb/assets` serving
 * - `build` — fresh-checkout UI build decision + execution (fingerprint/marker)
 * - `dev` — `--dev` Vite child orchestration (spawn / exit / port)
 * - `http` — Effect REST/API request routing + failure mapping
 * - `session` — Effect SubscriptionHub (message/broadcast/cleanup)
 * - `server` — Bun.serve / Effect runtime boundary, fs-watch, CLI entry
 * - `saved-queries` — Effect listing of `.kb/queries/*.edn` + virtual nodes
 * - `paths` — the one place `process.env` is read for kb's install layout
 */
export { runUiCli, startUi } from "./server.ts";
export type { UiServerHandle, UiServerOptions } from "./server.ts";
