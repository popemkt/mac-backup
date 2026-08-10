/**
 * Stable facade for the `kb ui` surface.
 *
 * Implementation lives under `./ui/`:
 * - `assets` — Effect FileSystem static SPA + `.kb/assets` serving
 * - `build` — fresh-checkout UI build decision + execution (fingerprint/marker)
 * - `dev` — `--dev` Vite child orchestration (spawn / exit / port)
 * - `http` — Effect REST/API request routing + failure mapping
 * - `session` — Effect SubscriptionHub (message/broadcast/cleanup)
 * - `server` — Bun.serve / Effect runtime boundary, fs-watch, CLI entry
 * - `saved-queries` — Effect listing of `.kb/queries/*.edn` + virtual nodes
 */
export type { UiServerHandle, UiServerOptions } from "./ui/server.ts";
export {
  runUiCli,
  startDevServer,
  startProductionUi,
  startUi,
  type RunUiCliOptions,
  type UiDevServer,
} from "./ui/server.ts";
export { savedQueryNodes } from "./ui/saved-queries.ts";
export {
  ensureUiBuilt,
  needsUiBuild,
  readBuildMarker,
  runProductionBuild,
  uiSourceFingerprint,
  writeBuildMarker,
  type UiBuildState,
  type UiEnsureResult,
} from "./ui/build.ts";
export {
  UI_DEV_DEFAULT_PORT,
  bunSpawnDev,
  runDevUntilExit,
  type UiDevChild,
  type UiDevSpawn,
} from "./ui/dev.ts";
export { UI_DIST } from "./ui/paths.ts";
export { UI_DEFAULT_PORT } from "./protocol.ts";
