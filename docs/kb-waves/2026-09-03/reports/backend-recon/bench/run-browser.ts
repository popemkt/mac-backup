/**
 * Browser driver: bundles the two browser candidates, serves them, and drives
 * headless Chromium through playwright-core.
 *
 * Bundle size is a first-class metric here, so the build output is measured
 * (minified, gzipped) alongside the wasm each candidate pulls.
 *
 * Usage: bun run-browser.ts --scale 100k [--candidate sqljs|wasqlite|both]
 */
import { chromium } from "playwright-core";
import { gzipSync } from "node:zlib";
import { scaleArg, writeResult, type Stat } from "./lib/bench.ts";

const { scale } = scaleArg();
const which = Bun.argv.includes("--candidate") ? Bun.argv[Bun.argv.indexOf("--candidate") + 1]! : "both";
const here = new URL(".", import.meta.url).pathname;

// ---- bundle -------------------------------------------------------------
const build = await Bun.build({
  entrypoints: [`${here}browser/bench-sqljs.ts`, `${here}browser/worker-wasqlite.ts`],
  outdir: `${here}browser/dist`,
  target: "browser",
  minify: true,
  sourcemap: "none",
  naming: "[name].js",
});
if (!build.success) {
  console.error("bundle failed:");
  for (const log of build.logs) console.error(log);
  process.exit(1);
}
const bundleBytes: Record<string, { raw: number; gzip: number }> = {};
for (const out of build.outputs) {
  const buf = Buffer.from(await out.arrayBuffer());
  bundleBytes[out.path.split("/").pop()!] = { raw: buf.length, gzip: gzipSync(buf).length };
}

const vendorFiles: Record<string, string> = {
  "sql-wasm.wasm": `${here}node_modules/sql.js/dist/sql-wasm.wasm`,
  "wa-sqlite.wasm": `${here}node_modules/wa-sqlite/dist/wa-sqlite.wasm`,
};
const wasmBytes: Record<string, { raw: number; gzip: number }> = {};
for (const [name, path] of Object.entries(vendorFiles)) {
  const buf = Buffer.from(await Bun.file(path).arrayBuffer());
  wasmBytes[name] = { raw: buf.length, gzip: gzipSync(buf).length };
}

// ---- serve --------------------------------------------------------------
const page = (script: string, extra = "") => `<!doctype html>
<meta charset="utf-8"><title>kb backend recon</title>${extra}
<script type="module" src="${script}"></script>`;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const headers: Record<string, string> = {
      // OPFS sync access handles need a cross-origin-isolated context.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    };
    if (url.pathname === "/sqljs") return new Response(page("/dist/bench-sqljs.js"), { headers: { ...headers, "content-type": "text/html" } });
    if (url.pathname === "/wasqlite")
      return new Response(
        page(
          "/dist/driver-wasqlite.js",
          `<script type="module" id="driver">
</script>`,
        ),
        { headers: { ...headers, "content-type": "text/html" } },
      );
    if (url.pathname.startsWith("/dist/")) {
      const f = Bun.file(`${here}browser${url.pathname}`);
      return new Response(f, { headers: { ...headers, "content-type": "text/javascript" } });
    }
    if (url.pathname.startsWith("/vendor/")) {
      const name = url.pathname.slice("/vendor/".length);
      const path =
        vendorFiles[name] ??
        (await (async () => {
          // Emscripten asks for whatever filename its glue was built with;
          // resolve anything else out of the two vendored dist dirs rather than
          // guessing the name up front.
          for (const dir of [`${here}node_modules/sql.js/dist/`, `${here}node_modules/wa-sqlite/dist/`]) {
            if (await Bun.file(dir + name).exists()) return dir + name;
          }
          return undefined;
        })());
      if (!path) {
        console.error(`vendor 404: ${name}`);
        return new Response("not found", { status: 404, headers });
      }
      return new Response(Bun.file(path), { headers: { ...headers, "content-type": "application/wasm" } });
    }
    if (url.pathname.startsWith("/data/")) {
      return new Response(Bun.file(`${here}${url.pathname}`), {
        headers: { ...headers, "content-type": "application/x-ndjson" },
      });
    }
    return new Response("not found", { status: 404, headers });
  },
});
const base = `http://127.0.0.1:${server.port}`;

// Tiny main-thread driver for the worker candidate, written at build time so
// the worker URL is known.
await Bun.write(
  `${here}browser/dist/driver-wasqlite.js`,
  `const scale = new URLSearchParams(location.search).get("scale") ?? "100k";
const w = new Worker("/dist/worker-wasqlite.js", { type: "module" });
w.onmessage = (e) => { if (e.data && e.data.error) window.__kbError = e.data.error; else window.__kbResult = e.data; };
w.onerror = (e) => { window.__kbError = String(e.message ?? e); };
w.postMessage({ scale });`,
);

/**
 * playwright-core 1.62.1 wants chromium_headless_shell-1234; this machine has
 * 1228 (and a full chromium-1223) already in the playwright cache. Rather than
 * download a fourth copy, point at whichever cached shell/binary exists — CDP
 * is stable enough across two revisions for a benchmark, and the exact build
 * lands in the result's `versions.chromium`.
 */
async function findChromium(): Promise<string | undefined> {
  const cache = `${process.env["HOME"]}/Library/Caches/ms-playwright`;
  const candidates = [
    `${cache}/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${cache}/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${cache}/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${cache}/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  ];
  for (const c of candidates) if (await Bun.file(c).exists()) return c;
  return undefined;
}

const executablePath = await findChromium();
if (executablePath) console.log(`chromium: ${executablePath}`);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--enable-features=FileSystemAccessAPI", "--allow-file-access-from-files"],
});

async function drive(path: string, label: string) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const consoleLines: string[] = [];
  p.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  p.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`));
  const t = performance.now();
  await p.goto(`${base}${path}?scale=${scale}`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction("window.__kbResult !== undefined || window.__kbError !== undefined", null, {
    timeout: 600_000,
  });
  const wall = +(performance.now() - t).toFixed(1);
  const err = await p.evaluate("window.__kbError");
  const res = await p.evaluate("window.__kbResult");
  const isolated = await p.evaluate("crossOriginIsolated");
  await ctx.close();
  return { label, wall, err, res, isolated, consoleLines };
}

const outputs: unknown[] = [];
for (const [key, path, label] of [
  ["sqljs", "/sqljs", "sql.js"],
  ["wasqlite", "/wasqlite", "wa-sqlite-opfs"],
] as const) {
  if (which !== "both" && which !== key) continue;
  const r = await drive(path, label);
  if (r.err || !r.res) {
    console.error(`\n${label}: FAILED`);
    console.error(r.err ?? "no result");
    for (const l of r.consoleLines.slice(0, 25)) console.error("  " + l);
    outputs.push({ candidate: label, scale, failed: true, error: r.err, console: r.consoleLines.slice(0, 40) });
    continue;
  }
  const res = r.res as {
    candidate: string;
    nodes: number;
    datoms: number;
    coldLoadMs: Record<string, number>;
    queries: Stat[];
    persistence?: Record<string, number | string>;
    jsHeapMB?: number | null;
  };
  const bundleKey = key === "sqljs" ? "bench-sqljs.js" : "worker-wasqlite.js";
  const wasmKey = key === "sqljs" ? "sql-wasm.wasm" : "wa-sqlite.wasm";
  await writeResult({
    candidate: res.candidate,
    scale,
    versions: {
      chromium: browser.version(),
      playwright: "1.62.1",
      "sql.js": "1.14.2",
      "wa-sqlite": "1.0.0",
    },
    nodes: res.nodes,
    datoms: res.datoms,
    coldLoadMs: res.coldLoadMs,
    rssDeltaMB: -1,
    heapDeltaMB: res.jsHeapMB ?? -1,
    queries: res.queries,
    persistence: {
      ...(res.persistence ?? {}),
      bundleRawBytes: bundleBytes[bundleKey]!.raw,
      bundleGzipBytes: bundleBytes[bundleKey]!.gzip,
      wasmRawBytes: wasmBytes[wasmKey]!.raw,
      wasmGzipBytes: wasmBytes[wasmKey]!.gzip,
      pageWallMs: r.wall,
      crossOriginIsolated: String(r.isolated),
    },
    notes: [
      "measured in headless Chromium via playwright-core; rssDeltaMB is -1 because the process boundary makes an in-page RSS figure meaningless — heapDeltaMB is performance.memory.usedJSHeapSize where the browser exposes it",
      "bundle bytes are Bun.build minified output for this candidate's entrypoint; wasm bytes are the vendored binary it fetches",
    ],
  });
  outputs.push(res);
}

await browser.close();
server.stop(true);
