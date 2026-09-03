import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/**
 * Fresh-checkout lifecycle for the built UI (`tools/kb/ui/dist`).
 *
 * Production `kb ui` must not depend on a human remembering to build the SPA.
 * On startup it checks whether `ui/dist` is present and meaningfully fresh
 * (source fingerprint vs a cached build marker); only then does it shell out
 * to `bun install && bun run build`. Deterministic and testable: the decision
 * and the build execution are separated, and the marker is written by
 * `ensureUiBuilt` (not the runner) so an install that touches lockfiles cannot
 * create a perpetual-stale loop.
 */

/** Marker file inside `ui/dist` recording the source fingerprint it was built from. */
export const BUILD_MARKER = ".kb-build-hash";

function uiRootBase(uiRoot: string): string {
  return resolve(uiRoot, "..");
}

/**
 * Top-level inputs that determine the built SPA: UI config/entry files plus
 * the shared backend sources the app aliases (`@kb/protocol`, `@kb/canvas`).
 * Missing inputs are simply skipped — a config file that does not exist yet
 * does not pin the fingerprint.
 */
export function uiSourceInputs(uiRoot: string): string[] {
  const base = uiRootBase(uiRoot);
  return [
    join(uiRoot, "index.html"),
    join(uiRoot, "package.json"),
    join(uiRoot, "vite.config.ts"),
    join(uiRoot, "tsconfig.json"),
    join(uiRoot, "bun.lock"),
    join(uiRoot, "package-lock.json"),
    join(base, "src", "surface", "protocol.ts"),
    join(base, "src", "canvas", "doc.ts"),
  ];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(p)));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * Deterministic hash over every source input that can change the built
 * bundle. Paths are relative to the kb package root and contents are sorted
 * before hashing, so the fingerprint is stable across runs and machines.
 */
export async function uiSourceFingerprint(uiRoot: string): Promise<string> {
  const inputs = [...uiSourceInputs(uiRoot)];
  const srcDir = join(uiRoot, "src");
  if (await pathExists(srcDir)) inputs.push(...(await walkFiles(srcDir)));

  const parts: string[] = [];
  const base = uiRootBase(uiRoot);
  for (const p of inputs) {
    let text: string;
    try {
      text = await readFile(p, "utf8");
    } catch {
      continue; // not an input in this checkout state
    }
    parts.push(`${relative(base, p)}\u0000${text}`);
  }
  parts.sort();
  return String(Bun.hash(parts.join("\u0001")));
}

export function buildMarkerPath(distDir: string): string {
  return join(distDir, BUILD_MARKER);
}

export async function readBuildMarker(distDir: string): Promise<string | null> {
  try {
    return await readFile(buildMarkerPath(distDir), "utf8");
  } catch {
    return null;
  }
}

export async function writeBuildMarker(distDir: string, fingerprint: string): Promise<void> {
  await mkdir(distDir, { recursive: true });
  await writeFile(buildMarkerPath(distDir), fingerprint, "utf8");
}

/** Why the cached build (if any) cannot be served as-is. */
export type UiBuildState = "missing" | "stale" | "fresh";

/**
 * Fresh-checkout build decision. `missing` = no `index.html` (never built);
 * `stale` = built but the source fingerprint moved on; `fresh` = safe to serve.
 *
 * A `uiRoot` without `package.json` is a packaged layout (e.g. the Nix store):
 * `ui/dist` is baked at build time and no sources exist to rebuild from — a
 * runtime `bun install` there can never succeed (read-only, dep-free). Serve
 * the baked assets as-is.
 */
export async function needsUiBuild(uiRoot: string, distDir: string): Promise<UiBuildState> {
  if (!(await pathExists(join(uiRoot, "package.json")))) return "fresh";
  if (!(await pathExists(join(distDir, "index.html")))) return "missing";
  const fp = await uiSourceFingerprint(uiRoot);
  const marker = await readBuildMarker(distDir);
  if (marker === null || marker !== fp) return "stale";
  return "fresh";
}

/**
 * Build execution seam. The default runs the UI package's own build
 * (`bun install && bun run build` — `vp build`); tests inject a fake that
 * produces `dist/index.html` without touching the live checkout.
 */
export type UiBuildRunner = (uiRoot: string, distDir: string) => Promise<void>;

async function runChild(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${args[0]} exited ${code} (cwd ${cwd})`);
  }
}

/** Real production build: install deps, run the UI's `build` script. */
export async function runProductionBuild(uiRoot: string, _distDir: string): Promise<void> {
  await runChild(uiRoot, ["bun", "install"]);
  await runChild(uiRoot, ["bun", "run", "build"]);
}

export interface UiEnsureResult {
  built: boolean;
  state: UiBuildState;
}

/**
 * Ensure `ui/dist` is buildable: no-op when fresh, otherwise run the build
 * and record the post-build fingerprint as the cache marker.
 */
export async function ensureUiBuilt(
  uiRoot: string,
  distDir: string,
  runner: UiBuildRunner = runProductionBuild,
): Promise<UiEnsureResult> {
  const state = await needsUiBuild(uiRoot, distDir);
  if (state === "fresh") return { built: false, state };
  await runner(uiRoot, distDir);
  // Marker reflects post-build sources: an install that touched lockfiles is
  // part of the state that produced this dist, so it must not invalidate it.
  await writeBuildMarker(distDir, await uiSourceFingerprint(uiRoot));
  return { built: true, state };
}
