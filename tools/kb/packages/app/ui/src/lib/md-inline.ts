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
  const [, ext] = m;
  if (ext === undefined) return null;
  const e = ext.toLowerCase();
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

function runLength(text: string, at: number): number {
  let end = at;
  while (text[end] === text[at]) end++;
  return end - at;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;

function isSpaceAt(text: string, at: number): boolean {
  const ch = text[at];
  return ch === undefined || SPACE.test(ch);
}

function isWordAt(text: string, at: number): boolean {
  const ch = text[at];
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * The CommonMark flanking rule, judged on a whole delimiter run (`length` is
 * the run's full length): a run opens only when a non-space follows its last
 * mark and closes only when a non-space precedes its first, and `_`
 * additionally never opens after, or closes before, a letter or digit — so
 * `snake_case_name` stays text while `*` may still emphasise inside a word
 * (`un*frigging*believable`). Only once a run passes is a one- or two-mark
 * delimiter taken from its inner edge (`emphasisAt`).
 */
function canOpen(text: string, at: number, length: number): boolean {
  if (isSpaceAt(text, at + length)) return false;
  return text[at] !== "_" || !isWordAt(text, at - 1);
}

function canClose(text: string, at: number, length: number): boolean {
  if (isSpaceAt(text, at - 1)) return false;
  return text[at] !== "_" || !isWordAt(text, at + length);
}

/**
 * The first run after `from` that can close a `length`-mark delimiter: a run
 * of exactly that length, or, for a strong (two-mark) delimiter, any longer
 * run too, which closes on its first two marks.
 */
function closerOf(text: string, from: number, mark: string, length: number): number {
  let j = from;
  while (j < text.length) {
    if (text[j] !== mark) {
      j++;
      continue;
    }
    const run = runLength(text, j);
    const fits = run === length || (length === 2 && run > 2);
    // Flanking reads the whole run's outer boundary, not the marks it closes on.
    if (fits && canClose(text, j, run)) return j;
    j += run;
  }
  return -1;
}

/**
 * Emphasis opened by the `run`-long delimiter run at `at`, or null when it is
 * literal. A run longer than two opens on its inner two marks, so
 * `***text***` and `****text****` are strong. kb's segments are flat, so the
 * outer marks CommonMark would nest (`***` is em around strong) are dropped
 * where both sides have them, and stay text where only one side does.
 */
function emphasisAt(
  text: string,
  at: number,
  run: number,
): { before: string; seg: InlineSeg; after: string; next: number } | null {
  // Flanking reads the whole run's outer boundary (the character before its
  // first mark and after its last); only then is the inner delimiter chosen.
  if (!canOpen(text, at, run)) return null;
  const inner = Math.min(run, 2);
  const open = at + run - inner;
  const mark = text.charAt(at);
  const end = closerOf(text, open + inner, mark, inner);
  if (end < 0) return null;
  const closing = runLength(text, end);
  const outer = run - inner;
  const trailing = closing - inner;
  const nested = Math.min(outer, trailing);
  const v = text.slice(open + inner, end);
  return {
    before: mark.repeat(outer - nested),
    seg: inner === 2 ? { t: "bold", v } : { t: "italic", v },
    after: mark.repeat(trailing - nested),
    next: end + closing,
  };
}

// oxlint-disable-next-line complexity -- GAP [[01M1MGCM9RWXE3CYANZK5K4KC0]]
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

    // **bold**, __bold__, *italic*, _italic_ — one delimiter run at a time
    const mark = text.charAt(i);
    if (mark === "*" || mark === "_") {
      const run = runLength(text, i);
      const emphasis = emphasisAt(text, i, run);
      if (emphasis) {
        buf += emphasis.before;
        flush();
        out.push(emphasis.seg);
        buf = emphasis.after;
        i = emphasis.next;
      } else {
        buf += text.slice(i, i + run);
        i += run;
      }
      continue;
    }

    buf += text[i];
    i += 1;
  }

  flush();
  return out.length ? out : [{ t: "text", v: "" }];
}
