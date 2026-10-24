// The backend: the settings it declares and the hint bridge it serves to framed pages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin, { BRIDGE_ROUTE } from "../server.ts";

test("the bridge a framed page loads is served at /bridge.js, the committed classic script byte for byte", async () => {
  const routes: Array<{ method: string; path: string; handler: () => Response; auth: string | undefined }> = [];
  const bb = {
    settings: { define: () => undefined },
    http: {
      route: (method: string, path: string, handler: () => Response, opts?: { auth?: string }) =>
        routes.push({ method, path, handler, auth: opts?.auth }),
    },
  } as unknown as BbPluginApi;
  plugin(bb);
  const route = routes.find((each) => each.path === BRIDGE_ROUTE);
  assert.equal(route?.method, "GET");
  assert.equal(route.auth, "none", "a <script src> from another origin carries no bb credentials");
  const response = route.handler();
  assert.match(response.headers.get("content-type") ?? "", /^text\/javascript/u);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
  const committed = await readFile(new URL("../core/bridge/bbim-bridge.js", import.meta.url), "utf8");
  assert.equal(await response.text(), committed);
});
