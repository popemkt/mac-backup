// Entry of the classic-script build (../../bridge/bbim-bridge.js): installs the
// bridge on load. `<script data-parent-origins="https://a.example https://b.example">`
// names the parent origins it answers; without it the bridge stays off (it
// fails closed). `window.bbimBridge.uninstall()` removes it.
import { installBbimBridge } from "./bbim-bridge.ts";

const script = document.currentScript;
const origins = script?.getAttribute("data-parent-origins")?.split(/\s+/u) ?? [];
const uninstall = installBbimBridge({ parentOrigins: origins });

if (!("bbimBridge" in window)) {
  Object.defineProperty(window, "bbimBridge", { value: Object.freeze({ uninstall }), configurable: true });
}
