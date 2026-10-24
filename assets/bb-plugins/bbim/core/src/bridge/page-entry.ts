// Entry of the native-page build (../../bridge/bbim-page.ts, a string a host
// evaluates in the page's isolated world): installs the page bridge once per
// document, replying through the world's `bb.postMessage`. Evaluating it
// again is a no-op, so a host may prepend it to every request and survive the
// page navigating away (which drops everything installed).
import { installPageBridge, PAGE_BRIDGE } from "./page-bridge.ts";

/** bb binds it in the isolated world it evaluates plugin scripts in. */
declare const bb: { readonly postMessage: (data: unknown) => void } | null | undefined;

const scope = globalThis as unknown as Record<symbol, unknown>;
const channel = typeof bb === "object" ? bb : null;
if (!(PAGE_BRIDGE in scope) && channel !== null) {
  Object.defineProperty(scope, PAGE_BRIDGE, {
    // `bb.postMessage` is bb's isolated-world channel to the plugin, not window.postMessage: it takes no origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    value: installPageBridge({ window, post: (message) => channel.postMessage(message) }),
    configurable: true,
  });
}
