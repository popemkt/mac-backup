// bbim's backend: it only declares the settings (adapter/settings.ts). All
// behavior runs in the frontend (app.tsx).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { SETTINGS } from "./adapter/settings.ts";

export default function plugin(bb: BbPluginApi): void {
  bb.settings.define(SETTINGS);
}
