import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import type { ActionDefinition } from "@kb/contracts";
import { KbCtx } from "@kb/contracts";
import { freshId } from "@kb/model";
import { ResolveError } from "@kb/model";
import {
  domainError,
  domainFromResolve,
  type DomainError,
} from "@kb/model";

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
  // relative() is separator-agnostic; escapes show up as ".." or absolute.
  const relFromRoot = relative(rootResolved, candidate);
  if (
    relFromRoot === "" || // the directory itself is not a file we serve
    relFromRoot.startsWith("..") ||
    isAbsolute(relFromRoot)
  ) {
    return null;
  }
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

/** Upload whitelist: renderable media + pdf. No html/js/… — those would be
 * served same-origin by kb ui and could carry scripts. */
const UPLOAD_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, "pdf"]);

function sanitizeExt(raw: string | undefined, filename: string | undefined): string {
  let ext = (raw ?? "").replace(/^\./, "").trim();
  if (!ext && filename) {
    const fromName = extname(filename).replace(/^\./, "");
    ext = fromName;
  }
  ext = ext.toLowerCase();
  if (!ext || !SAFE_EXT.test(ext) || !UPLOAD_EXT.has(ext)) {
    throw new ResolveError(
      "forbidden",
      `unsupported asset extension: ${ext || "(none)"} — allowed: media types + pdf`,
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

export const assetUploadEffect = Effect.fn("asset.upload")(
  function* (
    input: z.infer<typeof assetUploadDef.inputSchema>,
  ): Effect.fn.Return<
    z.infer<typeof assetUploadDef.outputSchema>,
    DomainError,
    KbCtx | FileSystem
  > {
    const ctx = yield* KbCtx;
    const fs = yield* FileSystem;
    const id = yield* freshId;

    const prepared = yield* Effect.try({
      try: () => {
        const ext = sanitizeExt(input.ext, input.filename);
        const data = decodeBytes(input.bytes, input.encoding ?? "base64");
        if (data.byteLength === 0) {
          throw new ResolveError("forbidden", "empty asset payload", {});
        }
        const filename = `${id}.${ext}`;
        const abs = resolveAssetFile(ctx.root, `assets/${filename}`);
        if (!abs) {
          throw new ResolveError(
            "forbidden",
            "refusing to write outside assets dir",
            { filename },
          );
        }
        return { ext, data, id, filename, abs };
      },
      catch: (err) => {
        if (err instanceof ResolveError) return domainFromResolve(err);
        return domainError(
          "internal",
          err instanceof Error ? err.message : String(err),
        );
      },
    });

    yield* fs.makeDirectory(assetsDir(ctx.root), { recursive: true }).pipe(
      Effect.mapError((err) =>
        domainError("internal", err.message ?? String(err)),
      ),
    );
    yield* fs.writeFile(prepared.abs, prepared.data).pipe(
      Effect.mapError((err) =>
        domainError("internal", err.message ?? String(err)),
      ),
    );

    return {
      path: `${ASSETS_URL_PREFIX}${prepared.filename}`,
      id: prepared.id,
      ext: prepared.ext,
      bytes: prepared.data.byteLength,
    };
  },
);
