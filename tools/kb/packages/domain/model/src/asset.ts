/**
 * kb's own media (DESIGN.md → Assets): files stored under `.kb/assets/` and
 * named by the path `asset.upload` answers with, `assets/<id>.<ext>`. What
 * kind of media a file is, by its extension, and whether a reference names
 * one of kb's assets, said once here for every place that stores, renders
 * or draws one: the upload's whitelist, markdown media, a canvas's
 * pictures.
 */

/** The kinds of media kb renders, in the order an extension is asked about. */
const MEDIA_KINDS = ["image", "video", "audio"] as const;
export type AssetMediaKind = (typeof MEDIA_KINDS)[number];

/** The extensions of each kind of media kb renders. */
export const MEDIA_EXTENSIONS: { readonly [K in AssetMediaKind]: ReadonlySet<string> } = {
  image: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]),
  video: new Set(["mp4", "webm", "mov", "ogv", "m4v"]),
  audio: new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"]),
};

/** The kind of media an extension (with or without its dot) is; null for one kb does not render. */
export function mediaKindFromExt(ext: string): AssetMediaKind | null {
  const e = ext.replace(/^\./, "").toLowerCase();
  return MEDIA_KINDS.find((kind) => MEDIA_EXTENSIONS[kind].has(e)) ?? null;
}

/** The kind of media a path or URL names, by the extension it ends with (before any query or fragment). */
export function mediaKindFromHref(href: string): AssetMediaKind | null {
  const ext = /\.([a-z0-9]{1,12})(?:$|[?#])/i.exec(href.trim())?.[1];
  return ext === undefined ? null : mediaKindFromExt(ext);
}

/**
 * Whether `href` names one of kb's own assets (`assets/…`): the only media
 * kb draws, so a document cannot make a viewer fetch from elsewhere.
 */
export function isAssetPath(href: string): boolean {
  return /^assets\/\S/i.test(href.trim());
}

/** Whether text embeds one of kb's assets as markdown media, `![…](assets/…)`. */
export function textHasAssetRef(text: string): boolean {
  return /!\[[^\]]*\]\(assets\/[^)\s]+\)/i.test(text);
}
