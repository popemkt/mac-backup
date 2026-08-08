import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { ulid } from "ulid";
import type { ActionDefinition } from "../shared/contracts.ts";
import type { KbContext } from "../context.ts";
import { ResolveError } from "../foundation/resolve.ts";

/** On-disk directory under the kb root (Logseq-style opaque files). */
export const ASSETS_REL = ".kb/assets";

/** Markdown / HTTP path prefix returned by upload and used in node text. */
export const ASSETS_URL_PREFIX = "assets/";

const SAFE_EXT = /^[a-z0-9]{1,12}$/i;

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "ogv", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"]);

export type AssetMediaKind = "image" | "video" | "audio";

export function assetsDir(kbRoot: string): string {
  return join(kbRoot, ASSETS_REL);
}

/**
 * Resolve `GET /assets/<name>` (or bare `assets/<name>`) to an absolute
 * file path under `.kb/assets`. Returns null on traversal / empty name.
 */
export function resolveAssetFile(
  kbRoot: string,
  pathname: string,
): string | null {
  let rel = pathname.trim();
  if (rel.startsWith("/")) rel = rel.slice(1);
  if (rel.startsWith(ASSETS_URL_PREFIX)) {
    rel = rel.slice(ASSETS_URL_PREFIX.length);
  } else if (rel === "assets") {
    return null;
  } else {
    return null;
  }

  // Reject empty / NUL; decode %2e%2e / %2f style escapes before segmenting.
  if (!rel || rel.includes("\0")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const segments = decoded.split(/[/\\]+/).filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "." || s === "..")) return null;

  const rootResolved = resolve(assetsDir(kbRoot));
  const candidate = normalize(join(rootResolved, ...segments));
  if (
    candidate !== rootResolved &&
    !candidate.startsWith(rootResolved + "/")
  ) {
    return null;
  }
  // Directory itself is not a file we serve.
  if (candidate === rootResolved) return null;
  return candidate;
}

/** Extension (no dot) → media kind for render / MIME hints. */
export function mediaKindFromExt(ext: string): AssetMediaKind | null {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  return null;
}

export function mediaKindFromPath(pathOrHref: string): AssetMediaKind | null {
  return mediaKindFromExt(extname(pathOrHref));
}

/**
 * True when node text embeds an asset via markdown image syntax
 * `![alt](assets/...)` (W6a media bullet).
 */
export function textHasAssetRef(text: string): boolean {
  return /!\[[^\]]*\]\(assets\/[^)\s]+\)/i.test(text);
}

function sanitizeExt(raw: string | undefined, filename: string | undefined): string {
  let ext = (raw ?? "").replace(/^\./, "").trim();
  if (!ext && filename) {
    const fromName = extname(filename).replace(/^\./, "");
    ext = fromName;
  }
  if (!ext) ext = "bin";
  if (!SAFE_EXT.test(ext)) {
    throw new ResolveError(
      "forbidden",
      `unsafe asset extension: ${ext}`,
      { ext },
    );
  }
  return ext.toLowerCase();
}

function decodeBytes(input: string, encoding: "base64" | "utf8"): Uint8Array {
  if (encoding === "utf8") {
    return new TextEncoder().encode(input);
  }
  // Strip data-URL prefix if the client pasted one.
  const b64 = input.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0 && b64.length > 0) {
      throw new Error("empty decode");
    }
    return new Uint8Array(buf);
  } catch {
    throw new ResolveError("forbidden", "bytes must be valid base64", {});
  }
}

export const assetUploadDef = {
  id: "asset.upload",
  title: "Upload asset",
  description:
    "Write opaque bytes to .kb/assets/<ulid>.<ext>; returns assets/… path for markdown",
  mode: "apply" as const,
  inputSchema: z.object({
    /** File contents as base64 (default) or utf8. */
    bytes: z.string().min(1),
    encoding: z.enum(["base64", "utf8"]).default("base64"),
    /** Original filename — used only for extension / suggested alt text. */
    filename: z.string().optional(),
    /** Override extension (no dot). */
    ext: z.string().optional(),
  }),
  outputSchema: z.object({
    /** Relative markdown path, e.g. assets/01H….png */
    path: z.string(),
    id: z.string(),
    ext: z.string(),
    bytes: z.number().int().nonnegative(),
  }),
} satisfies ActionDefinition;

export async function assetUpload(
  ctx: KbContext,
  input: z.infer<typeof assetUploadDef.inputSchema>,
): Promise<z.infer<typeof assetUploadDef.outputSchema>> {
  const ext = sanitizeExt(input.ext, input.filename);
  const data = decodeBytes(input.bytes, input.encoding ?? "base64");
  if (data.byteLength === 0) {
    throw new ResolveError("forbidden", "empty asset payload", {});
  }

  const id = ulid();
  const filename = `${id}.${ext}`;
  const dir = assetsDir(ctx.root);
  await mkdir(dir, { recursive: true });
  const abs = resolveAssetFile(ctx.root, `assets/${filename}`);
  if (!abs) {
    throw new ResolveError("forbidden", "refusing to write outside assets dir", {
      filename,
    });
  }
  await writeFile(abs, data);

  return {
    path: `${ASSETS_URL_PREFIX}${filename}`,
    id,
    ext,
    bytes: data.byteLength,
  };
}
