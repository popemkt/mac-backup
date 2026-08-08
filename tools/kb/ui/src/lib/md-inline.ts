/**
 * Inline markdown subset for inactive outline rows (DESIGN-REFINE §2 W2).
 * bold / italic / code / links / [[id|label]] refs — no block elements.
 * Edit mode stays plain text; this module is never on the typing hot path.
 */

/** Shared type-scale class: edit + view must use this for equal line-height. */
export const KB_TEXT_CLASS = "kb-text";

export type InlineSeg =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "italic"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; href: string; label: string }
  | { t: "ref"; id: string; label: string };

const CACHE_MAX = 256;
const parseCache = new Map<string, InlineSeg[]>();

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
          const label =
            pipe >= 0 ? inner.slice(pipe + 1).trim() || id : id;
          if (id) {
            out.push({ t: "ref", id, label });
            i = end + 2;
            continue;
          }
        }
      }
    }

    // [label](url)
    if (text[i] === "[") {
      const close = text.indexOf("]", i + 1);
      if (
        close > i &&
        text[close + 1] === "(" &&
        !text.slice(i + 1, close).includes("[")
      ) {
        const urlEnd = text.indexOf(")", close + 2);
        if (urlEnd > close) {
          flush();
          out.push({
            t: "link",
            label: text.slice(i + 1, close),
            href: text.slice(close + 2, urlEnd),
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // **bold** or __bold__
    if (
      (text[i] === "*" && text[i + 1] === "*") ||
      (text[i] === "_" && text[i + 1] === "_")
    ) {
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
    if (
      (text[i] === "*" || text[i] === "_") &&
      text[i + 1] !== text[i]
    ) {
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
