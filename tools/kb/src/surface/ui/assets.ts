import { lstat, stat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { resolveAssetFile } from "../../operations/assets.ts";
import { pathExists, UI_DIST } from "./paths.ts";

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

/**
 * Read-only GET for `.kb/assets/*`. Traversal / missing → 403 / 404.
 * Never lists the directory.
 */
export async function serveKbAsset(
  kbRoot: string,
  pathname: string,
): Promise<Response> {
  const abs = resolveAssetFile(kbRoot, pathname);
  if (!abs) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    // lstat: a symlink under .kb/assets must not escape the directory.
    const st = await lstat(abs);
    if (!st.isFile() || st.isSymbolicLink()) {
      return new Response("forbidden", { status: 403 });
    }
  } catch {
    return new Response("not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": assetContentType(abs),
    "X-Content-Type-Options": "nosniff",
  };
  // SVG can carry scripts when navigated directly; neuter them.
  if (abs.toLowerCase().endsWith(".svg")) {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'";
  }
  return new Response(Bun.file(abs), { headers });
}

/**
 * Serve a file from `ui/dist`, or SPA fallback to index.html.
 * Returns null when the UI has not been built.
 */
export async function serveStatic(pathname: string): Promise<Response | null> {
  if (!(await pathExists(join(UI_DIST, "index.html")))) {
    return null;
  }

  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const candidate = normalize(join(UI_DIST, rel));
  const distResolved = resolve(UI_DIST);
  if (
    candidate !== distResolved &&
    !candidate.startsWith(distResolved + "/")
  ) {
    return new Response("forbidden", { status: 403 });
  }

  if (await pathExists(candidate)) {
    const st = await stat(candidate);
    if (st.isFile()) {
      return new Response(Bun.file(candidate));
    }
  }

  // SPA fallback
  return new Response(Bun.file(join(UI_DIST, "index.html")));
}

export { UI_DIST };
