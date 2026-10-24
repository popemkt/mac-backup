// bbim's backend: it declares the settings (adapter/settings.ts) and serves
// the hint bridge a framed page loads (core/README.md → Iframes), at
// /api/v1/plugins/bbim/http/bridge.js. Every other behavior runs in the
// frontend (app.tsx).
//
// The bridge is served from here, not copied into the pages that load it, so
// the frame half of the protocol always ships with the parent half: a page
// that loads it on each start never runs a bridge older than the bb it is
// framed by. A page names its parent origins on the script tag
// (`data-parent-origins`); without them the bridge stays off.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BBIM_BRIDGE_SCRIPT } from "@popemkt/bbim-core/bridge-script";
import { SETTINGS } from "./adapter/settings.ts";

/** Where the bridge is served, under the plugin's HTTP namespace. */
export const BRIDGE_ROUTE = "/bridge.js";

/** The bridge script as served: fixed public bytes, revalidated on every load so a page gets the current one. */
export function bridgeResponse(): Response {
  return new Response(BBIM_BRIDGE_SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      // Another origin's page loads it as a classic script.
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

export default function plugin(bb: BbPluginApi): void {
  bb.settings.define(SETTINGS);
  // `none`: a page on another origin loads it with a plain <script src>, which
  // carries neither bb's origin nor a token. It reads nothing and changes
  // nothing; it is the same bytes for everyone.
  bb.http.route("GET", BRIDGE_ROUTE, () => bridgeResponse(), { auth: "none" });
}
