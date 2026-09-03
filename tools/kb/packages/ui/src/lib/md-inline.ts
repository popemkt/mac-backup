/**
 * Inline markdown subset for inactive outline rows (DESIGN-REFINE §2 W2/W6a).
 * bold / italic / code / links / [[id|label]] refs / ![alt](assets/…) media.
 * Edit mode stays plain text; this module is never on the typing hot path.
 */

/** Shared type-scale class: edit + view must use this for equal line-height. */
export const KB_TEXT_CLASS = "kb-text";

export type AssetMediaKind = "image" | "video" | "audio";

export type InlineSeg =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "italic"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; href: string; label: string }
  | { t: "ref"; id: string; label: string }
  | {
      t: "media";
      href: string;
      alt: string;
      kind: AssetMediaKind;
    };

const CACHE_MAX = 256;
const parseCache = new Map<string, InlineSeg[]>();

/**
 * Only these link targets render as <a href>; anything else (javascript:,
 * data:, vbscript:, …) is left as plain text. Protocol-relative and
 * relative paths (assets/… for W6a media) are allowed.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/|\.\/|\.\.\/|assets\/)/i;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "ogv", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"]);

/** True when text embeds `![…](assets/…)`. */
export function textHasAssetRef(text: string): boolean {
  return /!\[[^\]]*\]\(assets\/[^)\s]+\)/i.test(text);
}

export function mediaKindFromHref(href: string): AssetMediaKind | null {
  const m = /\.([a-z0-9]{1,12})(?:$|[?#])/i.exec(href.trim());
  if (!m) return null;
  const e = m[1]!.toLowerCase();
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  return null;
}

/** Asset hrefs become /assets/… for the kb ui static route. */
export function assetSrcUrl(href: string): string {
  const h = href.trim();
  if (h.startsWith("/")) return h;
  if (/^assets\//i.test(h)) return `/${h}`;
  return h;
}

export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href.trim());
}

/** Memoized parse keyed by full text (stable while inactive). */
export function parseInlineMd(text: string): InlineSeg[] {
  const hit = parseCache.get(text);
  if (hit) return hit;
  const segs = parseOnce(text);
  if (parseCache.size >= CACHE_MAX) parseCache.clear();
  parseCache.set(text, segs);
  return segs;
}

/** Test / cache-control helper. */
export function clearInlineMdCache(): void {
  parseCache.clear();
}

function parseUrlAfterParen(text: string, openParenIdx: number): number {
  // openParenIdx points at "("; walk to matching ")" with nesting.
  let depth = 1;
  for (let j = openParenIdx + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return j;
  }
  return -1;
}

function parseOnce(text: string): InlineSeg[] {
  const out: InlineSeg[] = [];
  let i = 0;
  let buf = "";

  const flush = () => {
    if (buf) {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    // `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // [[id|label]] or [[id]]
    if (text[i] === "[" && text[i + 1] === "[") {
      const end = text.indexOf("]]", i + 2);
      if (end > i) {
        const inner = text.slice(i + 2, end);
        if (!inner.includes("[") && !inner.includes("]")) {
          flush();
          const pipe = inner.indexOf("|");
          const id = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
          const label = pipe >= 0 ? inner.slice(pipe + 1).trim() || id : id;
          if (id) {
            out.push({ t: "ref", id, label });
            i = end + 2;
            continue;
          }
        }
      }
    }

    // ![alt](assets/…) media (W6a) — before plain links
    if (text[i] === "!" && text[i + 1] === "[") {
      const close = text.indexOf("]", i + 2);
      if (close > i + 1 && text[close + 1] === "(" && !text.slice(i + 2, close).includes("[")) {
        const urlEnd = parseUrlAfterParen(text, close + 1);
        const href = urlEnd > close ? text.slice(close + 2, urlEnd) : "";
        const kind =
          urlEnd > close && /^assets\//i.test(href.trim()) && isSafeHref(href)
            ? mediaKindFromHref(href)
            : null;
        if (kind) {
          flush();
          out.push({
            t: "media",
            alt: text.slice(i + 2, close),
            href: href.trim(),
            kind,
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // [label](url)
    if (text[i] === "[") {
      const close = text.indexOf("]", i + 1);
      if (close > i && text[close + 1] === "(" && !text.slice(i + 1, close).includes("[")) {
        const urlEnd = parseUrlAfterParen(text, close + 1);
        const href = urlEnd > close ? text.slice(close + 2, urlEnd) : "";
        if (urlEnd > close && isSafeHref(href)) {
          flush();
          out.push({
            t: "link",
            label: text.slice(i + 1, close),
            href,
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // **bold** or __bold__
    if ((text[i] === "*" && text[i + 1] === "*") || (text[i] === "_" && text[i + 1] === "_")) {
      const mark = text[i]!;
      const end = text.indexOf(mark + mark, i + 2);
      if (end > i + 1) {
        flush();
        out.push({ t: "bold", v: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // *italic* or _italic_ (single; not part of **)
    if ((text[i] === "*" || text[i] === "_") && text[i + 1] !== text[i]) {
      const mark = text[i]!;
      const end = text.indexOf(mark, i + 1);
      if (end > i + 1 && text[end + 1] !== mark) {
        flush();
        out.push({ t: "italic", v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    buf += text[i];
    i += 1;
  }

  flush();
  return out.length ? out : [{ t: "text", v: "" }];
}
