/**
 * A view as an MCP App (the MCP Apps extension, `io.modelcontextprotocol/ui`,
 * spec 2026-01-26): the rendered page as of the read, with a refresh that
 * asks the host to read the same resource again and swaps the fresh render
 * in. Live push is out of scope: a remote host has no path back to a local kb
 * server (roadmap decision 9).
 *
 * The page is kb's own render, not model-written HTML. It needs no network
 * (the spec's default CSP allows inline script and style and no connection):
 * the refresh goes through the host over the MCP Apps postMessage bridge,
 * `ui/initialize` first, then `resources/read` where the host proxies it
 * (`hostCapabilities.serverResources`), so the fresh snapshot is
 * stamped by the server that rendered it. Outside a host, or in one that
 * does not answer, the refresh stays hidden, so it never looks live and does
 * nothing.
 */
import { JSON_RPC_VERSION, MCP_APPS_METHODS, MCP_APPS_VERSION } from "@kb/contracts";
import { RENDERED_VIEW_ID } from "@kb/operations";

/** The element holding when the snapshot was rendered. */
const AS_OF_ID = "kb-as-of";

/** JSON safe to inline in a `<script>`: no `<` can close it. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

/**
 * The script that refreshes the snapshot: hand-written against the spec's
 * JSON-RPC messages, so the page carries no SDK.
 */
function refreshScript(uri: string): string {
  return `<script>
(() => {
  const ids = { view: ${scriptJson(RENDERED_VIEW_ID)}, asOf: ${scriptJson(AS_OF_ID)} };
  const read = { uri: ${scriptJson(uri)} };
  const jsonrpc = ${scriptJson(JSON_RPC_VERSION)};
  const methods = ${scriptJson(MCP_APPS_METHODS)};
  const button = document.getElementById("kb-refresh");
  if (window.parent === window || !button) return;
  let next = 0;
  const pending = new Map();
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc, id, method, params }, "*");
    });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.jsonrpc !== jsonrpc || !pending.has(message.id)) return;
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  const swap = (fresh, id) => {
    const from = fresh.getElementById(id);
    const to = document.getElementById(id);
    if (from && to) to.outerHTML = from.outerHTML;
  };
  const refresh = async () => {
    button.disabled = true;
    try {
      const result = await send(methods.resourcesRead, read);
      const text = result && result.contents && result.contents[0] && result.contents[0].text;
      if (typeof text !== "string") throw new Error("the host returned no page");
      const fresh = new DOMParser().parseFromString(text, "text/html");
      swap(fresh, ids.view);
      swap(fresh, ids.asOf);
    } catch (error) {
      const stamp = document.getElementById(ids.asOf);
      if (stamp) stamp.textContent += " (refresh failed: " + (error instanceof Error ? error.message : String(error)) + ")";
    } finally {
      button.disabled = false;
    }
  };
  send(methods.initialize, {
    protocolVersion: ${scriptJson(MCP_APPS_VERSION)},
    appInfo: { name: "kb-view", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  }).then(
    (result) => {
      window.parent.postMessage({ jsonrpc, method: methods.initialized }, "*");
      // A host proxies resources/read only when it says it does.
      if (!result || !result.hostCapabilities || !result.hostCapabilities.serverResources) return;
      button.hidden = false;
      button.addEventListener("click", () => void refresh());
    },
    () => {},
  );
})();
</script>`;
}

/**
 * `page` (a rendered html page, `render.view`'s html) as the MCP App
 * snapshot served at `uri`: stamped with when it was rendered (`asOf`), with
 * a refresh that reads `uri` again.
 */
export function viewSnapshotApp(page: string, uri: string, asOf: string): string {
  const stamp = [
    `<p style="color:#666;font-size:.85rem">Snapshot as of `,
    `<time id="${AS_OF_ID}" datetime="${escapeHtml(asOf)}">${escapeHtml(asOf)}</time> `,
    `<button id="kb-refresh" type="button" hidden>Refresh</button></p>`,
  ].join("");
  return page.replace("</body>", `${stamp}\n${refreshScript(uri)}\n</body>`);
}
