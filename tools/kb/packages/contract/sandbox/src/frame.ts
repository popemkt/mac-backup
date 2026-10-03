/**
 * The sandbox frame's document and its policy (DESIGN.md → Sandbox → The
 * frame), stated once: the kb server serves it, and the page embeds it at
 * the path named here. The frame is an iframe sandboxed with
 * `allow-scripts` alone, so it has an opaque origin: it shares no storage,
 * cookies or DOM with the page and reaches the page only by `postMessage`.
 * Its CSP lets it run kb's own frame script and compile the QuickJS
 * WebAssembly, start a Worker from a blob it made itself, and nothing else:
 * no connection, no image, font or media load, no form, no nested frame.
 */

/** Where the kb server serves the frame's document. */
export const SANDBOX_FRAME_PATH = "/sandbox";

/** Where it serves the frame's script, the one script the document runs. */
export const SANDBOX_SCRIPT_PATH = "/sandbox/frame.js";

/** The iframe's sandbox: scripts, and nothing else (no same origin, forms, popups or navigation). */
export const SANDBOX_IFRAME_FLAGS = "allow-scripts";

/** The element the guest's drawing is built in. */
export const SANDBOX_DRAW_ID = "kb-draw";

/** The element a run's end is told in. */
export const SANDBOX_STATUS_ID = "kb-status";

/**
 * The frame's policy. `sandbox allow-scripts` repeats the iframe's flags, so
 * the document is sandboxed even when something opens it directly.
 */
export const SANDBOX_FRAME_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src blob:",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** The headers the frame's document is served with. */
export const SANDBOX_FRAME_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": SANDBOX_FRAME_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** The frame's document: a box to draw in, a line for the run's end, and kb's frame script. */
export function sandboxFrameDocument(): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><title>kb sandbox</title>',
    "<style>",
    "html,body{margin:0;padding:0;background:transparent;color:var(--ink,#1f1f1f);",
    "font:14px/1.5 var(--font-ui,system-ui,sans-serif)}",
    `#${SANDBOX_DRAW_ID}{padding:12px}`,
    `#${SANDBOX_STATUS_ID}{margin:12px;padding:8px 12px;border-radius:6px;`,
    "background:var(--surface-sunken,#f4f4f4);color:var(--ink-muted,#555);font-size:13px}",
    "</style></head>",
    `<body><div id="${SANDBOX_DRAW_ID}"></div><div id="${SANDBOX_STATUS_ID}" role="status" hidden></div>`,
    `<script src="${SANDBOX_SCRIPT_PATH}"></script></body></html>`,
  ].join("");
}
