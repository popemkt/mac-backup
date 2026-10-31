// Copies of the host's DOM that lively shows or draws in its own layers (a
// send's ghost, the canvas layer's stage): sanitized, so neither the host nor
// lively can find them by their hooks, and with their scroll kept. Also the
// two ways a copy becomes pixels without HTML-in-Canvas: its glyphs, laid out
// where the browser laid them out, and a CSS color as RGB.

/** Elements a copy never keeps (frames and media), and attributes it drops. */
const DROP_ELEMENTS = "iframe, frame, object, embed, video, audio, canvas, script, [autofocus]";

/**
 * The scrolled descendants of `original` paired with the same nodes in `clone`, taken before
 * the clone is sanitized (which removes nodes and so breaks a walk in tree order).
 */
function scrolled(original: Element, clone: Element): ReadonlyArray<readonly [Element, number, number]> {
  const from = [original, ...original.querySelectorAll("*")];
  const to = [clone, ...clone.querySelectorAll("*")];
  const pairs: Array<readonly [Element, number, number]> = [];
  for (const [index, element] of from.entries()) {
    const target = to[index];
    if (target !== undefined && (element.scrollTop !== 0 || element.scrollLeft !== 0)) pairs.push([target, element.scrollTop, element.scrollLeft]);
  }
  return pairs;
}

function sanitize(clone: Element): void {
  for (const element of clone.querySelectorAll(DROP_ELEMENTS)) {
    if (element.matches("[autofocus]")) element.removeAttribute("autofocus");
    else element.remove();
  }
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) {
      if (name === "id" || name === "name" || name === "for" || name.startsWith("data-") || name === "contenteditable") element.removeAttribute(name);
    }
  }
}

/**
 * A sanitized deep copy of `original`; `settle` gives its scrolled parts the original's scroll
 * once the copy is in the document (laid out).
 */
export function sanitizedCopy(original: Element): { readonly clone: HTMLElement; readonly settle: () => void } {
  const clone = original.cloneNode(true) as HTMLElement;
  const scroll = scrolled(original, clone);
  sanitize(clone);
  const settle = () => {
    for (const [element, top, left] of scroll) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  };
  return { clone, settle };
}

/** One laid-out character: where the browser put it (window CSS px) and how it is set. */
export interface Glyph {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly font: string;
  readonly color: string;
}

/** The most glyphs one copy keeps: a long message beyond it sheds only its first part. */
export const MAX_GLYPHS = 900;

/**
 * The visible characters inside `root`, each where it is laid out, clipped to `clip`. Reads
 * layout once per character (a Range), so it is kept for a send, never per frame.
 */
export function glyphsOf(win: Window, root: Element, clip: DOMRect): ReadonlyArray<Glyph> {
  const doc = win.document;
  const glyphs: Array<Glyph> = [];
  const styles = new Map<Element, { font: string; color: string }>();
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  if (typeof range.getClientRects !== "function") return [];
  for (let node = walker.nextNode(); node !== null && glyphs.length < MAX_GLYPHS; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (parent === null) continue;
    let style = styles.get(parent);
    if (style === undefined) {
      const computed = win.getComputedStyle(parent);
      style = { font: computed.font || `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`, color: computed.color };
      styles.set(parent, style);
    }
    for (let index = 0; index < text.length && glyphs.length < MAX_GLYPHS; index += 1) {
      const character = text[index] ?? "";
      if (character.trim() === "") continue;
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const box = range.getClientRects()[0];
      if (box === undefined || box.width === 0 || box.bottom < clip.top || box.top > clip.bottom || box.right < clip.left || box.left > clip.right) continue;
      glyphs.push({ text: character, x: box.left, y: box.top, width: box.width, height: box.height, ...style });
    }
  }
  return glyphs;
}

/** A box in window CSS px. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The text's own bounds inside `root` (the union of its line boxes), clipped to `clip`; `clip` when it has none. */
export function textBounds(win: Window, root: Element, clip: DOMRect): Box {
  const range = win.document.createRange();
  range.selectNodeContents(root);
  // A DOM without layout (a test's) may not measure ranges at all.
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;
  if (box === undefined || box.width === 0 || box.height === 0) return clip;
  const left = Math.max(box.left, clip.left);
  const top = Math.max(box.top, clip.top);
  const right = Math.min(box.right, clip.right);
  const bottom = Math.min(box.bottom, clip.bottom);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : clip;
}

/**
 * A CSS color (any syntax the page resolves, custom properties too) as 0–1 RGB, read through a
 * probe element and a 1×1 canvas so modern color spaces come out as sRGB; `fallback` if neither works.
 */
export function cssRgb(win: Window, value: string, fallback: readonly [number, number, number]): readonly [number, number, number] {
  const doc = win.document;
  const probe = doc.createElement("i");
  probe.style.cssText = `position:fixed;width:0;height:0;visibility:hidden;color:${value}`;
  doc.body.append(probe);
  const resolved = win.getComputedStyle(probe).color;
  probe.remove();
  const context = doc.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (context === null || resolved === "") return fallback;
  context.fillStyle = "#010203";
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return a === 0 ? fallback : [r / 255, g / 255, b / 255];
}
