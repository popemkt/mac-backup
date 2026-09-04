import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
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
const BUILD_MARKER = ".kb-build-hash";

/** A build the runner could not complete. */
export class UiBuildError extends Schema.TaggedError<UiBuildError>()("Kb/UiBuildError", {
  message: Schema.String,
}) {}

function uiRootBase(uiRoot: string): string {
  return resolve(uiRoot, "..");
}

/**
 * Top-level inputs that determine the built SPA: UI config/entry files plus
 * the shared backend sources the app aliases (`@kb/protocol`, `@kb/canvas`).
 * Missing inputs are simply skipped — a config file that does not exist yet
 * does not pin the fingerprint.
 */
function uiSourceInputs(uiRoot: string): string[] {
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

const pathExists = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem;
  return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
});

/**
 * Deterministic hash over every source input that can change the built
 * bundle. Paths are relative to the kb package root and contents are sorted
 * before hashing, so the fingerprint is stable across runs and machines.
 * Anything that does not read as text — a directory, a file this checkout
 * does not have — is not an input.
 */
export const uiSourceFingerprint = Effect.fn("kb.uiSourceFingerprint")(function* (
  uiRoot: string,
): Effect.fn.Return<string, PlatformError, FileSystem> {
  const fs = yield* FileSystem;
  const inputs = [...uiSourceInputs(uiRoot)];
  const srcDir = join(uiRoot, "src");
  if (yield* pathExists(srcDir)) {
    const entries = yield* fs.readDirectory(srcDir, { recursive: true });
    inputs.push(...entries.map((entry) => join(srcDir, entry)));
  }

  const base = uiRootBase(uiRoot);
  const parts = yield* Effect.forEach(inputs, (path) =>
    fs.readFileString(path).pipe(
      Effect.map((text) => `${relative(base, path)}\u0000${text}`),
      Effect.orElseSucceed(() => null),
    ),
  );
  const present = parts.filter((part) => part !== null);
  return String(Bun.hash(present.toSorted().join("\u0001")));
});

function buildMarkerPath(distDir: string): string {
  return join(distDir, BUILD_MARKER);
}

export const readBuildMarker = Effect.fn("kb.readBuildMarker")(function* (
  distDir: string,
): Effect.fn.Return<string | null, never, FileSystem> {
  const fs = yield* FileSystem;
  return yield* fs.readFileString(buildMarkerPath(distDir)).pipe(Effect.orElseSucceed(() => null));
});

export const writeBuildMarker = Effect.fn("kb.writeBuildMarker")(function* (
  distDir: string,
  fingerprint: string,
): Effect.fn.Return<void, PlatformError, FileSystem> {
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(distDir, { recursive: true });
  yield* fs.writeFileString(buildMarkerPath(distDir), fingerprint);
});

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
export const needsUiBuild = Effect.fn("kb.needsUiBuild")(function* (
  uiRoot: string,
  distDir: string,
): Effect.fn.Return<UiBuildState, PlatformError, FileSystem> {
  if (!(yield* pathExists(join(uiRoot, "package.json")))) return "fresh";
  if (!(yield* pathExists(join(distDir, "index.html")))) return "missing";
  const fp = yield* uiSourceFingerprint(uiRoot);
  const marker = yield* readBuildMarker(distDir);
  if (marker === null || marker !== fp) return "stale";
  return "fresh";
});

/**
 * Build execution seam. The default runs the UI package's own build
 * (`bun install && bun run build` — `vp build`); tests inject a fake that
 * produces `dist/index.html` without touching the live checkout.
 */
export type UiBuildRunner = (
  uiRoot: string,
  distDir: string,
) => Effect.Effect<void, UiBuildError, FileSystem>;

const runChild = Effect.fnUntraced(function* (cwd: string, args: string[]) {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = yield* Effect.promise(() => proc.exited);
  if (code !== 0) {
    return yield* new UiBuildError({ message: `${args[0]} exited ${code} (cwd ${cwd})` });
  }
  return code;
});

/** Real production build: install deps, run the UI's `build` script. */
const runProductionBuild: UiBuildRunner = Effect.fn("kb.runProductionBuild")(function* (
  uiRoot: string,
): Effect.fn.Return<void, UiBuildError> {
  yield* runChild(uiRoot, ["bun", "install"]);
  yield* runChild(uiRoot, ["bun", "run", "build"]);
});

export interface UiEnsureResult {
  built: boolean;
  state: UiBuildState;
}

/**
 * Ensure `ui/dist` is buildable: no-op when fresh, otherwise run the build
 * and record the post-build fingerprint as the cache marker.
 */
export const ensureUiBuilt = Effect.fn("kb.ensureUiBuilt")(function* (
  uiRoot: string,
  distDir: string,
  runner: UiBuildRunner = runProductionBuild,
): Effect.fn.Return<UiEnsureResult, PlatformError | UiBuildError, FileSystem> {
  const state = yield* needsUiBuild(uiRoot, distDir);
  if (state === "fresh") return { built: false, state };
  yield* runner(uiRoot, distDir);
  // Marker reflects post-build sources: an install that touched lockfiles is
  // part of the state that produced this dist, so it must not invalidate it.
  yield* writeBuildMarker(distDir, yield* uiSourceFingerprint(uiRoot));
  return { built: true, state };
});
