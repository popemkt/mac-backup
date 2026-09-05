import { Effect } from "effect";
import { z } from "zod";
import type { ActionDefinition } from "@kb/contracts";
import { Assets } from "@kb/contracts";
import { freshId, ResolveError, domainError, domainFromResolve, type DomainError } from "@kb/model";

const SAFE_EXT = /^[a-z0-9]{1,12}$/i;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "ogv", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"]);

export type AssetMediaKind = "image" | "video" | "audio";

/** Extension (no dot) → media kind for render / MIME hints. */
export function mediaKindFromExt(ext: string): AssetMediaKind | null {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  return null;
}

/**
 * True when node text embeds an asset via markdown image syntax
 * `![alt](assets/...)` (W6a media bullet).
 */
export function textHasAssetRef(text: string): boolean {
  return /!\[[^\]]*\]\(assets\/[^)\s]+\)/i.test(text);
}

/** Upload whitelist: renderable media + pdf. No html/js/… — those would be
 * served same-origin by kb ui and could carry scripts. */
const UPLOAD_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, "pdf"]);

/**
 * The extension of a filename, without the dot. `node:path`'s `extname` with
 * the platform taken out: a dot that starts the basename is not an extension,
 * and a name with no dot has none.
 */
function extOf(filename: string): string {
  const lastSep = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const dot = filename.lastIndexOf(".");
  return dot > lastSep + 1 ? filename.slice(dot + 1) : "";
}

function sanitizeExt(raw: string | undefined, filename: string | undefined): string {
  let ext = (raw ?? "").replace(/^\./, "").trim();
  if (ext === "" && filename !== undefined && filename !== "") {
    ext = extOf(filename);
  }
  ext = ext.toLowerCase();
  if (ext === "" || !SAFE_EXT.test(ext) || !UPLOAD_EXT.has(ext)) {
    throw new ResolveError(
      "forbidden",
      `unsupported asset extension: ${ext === "" ? "(none)" : ext} — allowed: media types + pdf`,
      { ext },
    );
  }
  return ext;
}

function decodeBytes(input: string, encoding: "base64" | "utf8"): Uint8Array {
  if (encoding === "utf8") {
    return new TextEncoder().encode(input);
  }
  // Strip data-URL prefix if the client pasted one.
  const b64 = input.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  try {
    return Uint8Array.fromBase64(b64);
  } catch {
    throw new ResolveError("forbidden", "bytes must be valid base64", {});
  }
}

export const assetUploadDef = {
  id: "asset.upload",
  title: "Upload asset",
  description: "Write opaque bytes to .kb/assets/<ulid>.<ext>; returns assets/… path for markdown",
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

export const assetUploadEffect = Effect.fn("asset.upload")(function* (
  input: z.infer<typeof assetUploadDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof assetUploadDef.outputSchema>, DomainError, Assets> {
  const assets = yield* Assets;
  const id = yield* freshId;

  const prepared = yield* Effect.try({
    try: () => {
      const ext = sanitizeExt(input.ext, input.filename);
      const data = decodeBytes(input.bytes, input.encoding);
      if (data.byteLength === 0) {
        throw new ResolveError("forbidden", "empty asset payload", {});
      }
      return { ext, data };
    },
    catch: (err) => {
      if (err instanceof ResolveError) return domainFromResolve(err);
      return domainError("internal", err instanceof Error ? err.message : String(err));
    },
  });

  const path = yield* assets.write(id, prepared.ext, prepared.data);

  return {
    path,
    id,
    ext: prepared.ext,
    bytes: prepared.data.byteLength,
  };
});
