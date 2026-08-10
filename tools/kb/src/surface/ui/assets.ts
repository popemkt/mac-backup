import { lstat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { resolveAssetFile } from "../../operations/assets.ts";
import { bunFileSystemLayer } from "../../context.ts";
import { UI_DIST } from "./paths.ts";

const ASSET_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  pdf: "application/pdf",
};

/** Resolve Content-Type for a kb asset path; unknown → octet-stream. */
export function assetContentType(absPath: string): string {
  const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
  return ASSET_MIME[ext] ?? "application/octet-stream";
}

function assetHeaders(abs: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": assetContentType(abs),
    "X-Content-Type-Options": "nosniff",
  };
  // SVG can carry scripts when navigated directly; neuter them.
  if (abs.toLowerCase().endsWith(".svg")) {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'";
  }
  return headers;
}

/**
 * Read-only GET for `.kb/assets/*`. Traversal / missing → 403 / 404.
 * Never lists the directory.
 *
 * Effect program. `lstat` (which `effect/FileSystem` has no equivalent of)
 * is bridged at this boundary so a symlink under `.kb/assets` cannot escape
 * the directory; the file body is served via `Bun.file` at the Bun.serve
 * response boundary.
 */
export const serveKbAssetEffect = Effect.fn("kb.ui.serveKbAsset")(
  function* (
    kbRoot: string,
    pathname: string,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, never, never> {
    const abs = resolveAssetFile(kbRoot, pathname);
    if (!abs) {
      return HttpServerResponse.text("forbidden", { status: 403 });
    }
    // lstat: a symlink under .kb/assets must not escape the directory.
    const st = yield* Effect.tryPromise(() => lstat(abs)).pipe(Effect.option);
    if (Option.isNone(st)) {
      return HttpServerResponse.text("not found", { status: 404 });
    }
    if (!st.value.isFile() || st.value.isSymbolicLink()) {
      return HttpServerResponse.text("forbidden", { status: 403 });
    }
    return HttpServerResponse.raw(Bun.file(abs), {
      status: 200,
      headers: assetHeaders(abs),
    });
  },
);

/** Promise facade for the WS-free HTTP path / tests. */
export function serveKbAsset(
  kbRoot: string,
  pathname: string,
): Promise<Response> {
  return Effect.runPromise(
    serveKbAssetEffect(kbRoot, pathname).pipe(
      Effect.map(HttpServerResponse.toWeb),
    ),
  );
}

/**
 * Serve a file from `ui/dist`, or SPA fallback to index.html.
 * Returns null when the UI has not been built.
 */
export const serveStaticEffect = Effect.fn("kb.ui.serveStatic")(
  function* (pathname: string) {
    const fs = yield* FileSystem;
    const indexHtml = join(UI_DIST, "index.html");
    // Platform I/O errors become defects; HTTP catchCause maps them to 500.
    if (!(yield* fs.exists(indexHtml).pipe(Effect.orDie))) {
      return null as HttpServerResponse.HttpServerResponse | null;
    }

    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const candidate = normalize(join(UI_DIST, rel));
    const distResolved = resolve(UI_DIST);
    if (
      candidate !== distResolved &&
      !candidate.startsWith(distResolved + "/")
    ) {
      return HttpServerResponse.text("forbidden", { status: 403 });
    }

    if (yield* fs.exists(candidate).pipe(Effect.orDie)) {
      const info = yield* fs.stat(candidate).pipe(Effect.orDie);
      if (info.type === "File") {
        return HttpServerResponse.raw(Bun.file(candidate), { status: 200 });
      }
    }

    // SPA fallback
    return HttpServerResponse.raw(Bun.file(indexHtml), { status: 200 });
  },
);

/** Promise facade for the WS-free HTTP path / tests. */
export function serveStatic(pathname: string): Promise<Response | null> {
  return Effect.runPromise(
    serveStaticEffect(pathname).pipe(
      Effect.provide(bunFileSystemLayer),
      Effect.map((resp) =>
        resp === null ? null : HttpServerResponse.toWeb(resp),
      ),
    ),
  );
}

export { UI_DIST };
