// Entry of the classic-script build (../../bridge/bbim-bridge.js): installs the
// bridge on load. `<script data-parent-origins="https://a.example https://b.example">`
// limits which parent origins it answers. `window.bbimBridge.uninstall()` removes it.
import { installBbimBridge } from "./bbim-bridge.ts";

const script = document.currentScript;
const origins = script?.getAttribute("data-parent-origins")?.split(/\s+/u).filter((origin) => origin !== "");
const uninstall = installBbimBridge(origins === undefined || origins.length === 0 ? {} : { parentOrigins: origins });

Object.defineProperty(window, "bbimBridge", { value: Object.freeze({ uninstall }), configurable: true });
