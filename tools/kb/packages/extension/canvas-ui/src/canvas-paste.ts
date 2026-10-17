/**
 * What text pasted onto a canvas becomes (DESIGN-UI.md → Canvas → Paste): a
 * canvas document (what a copy writes) becomes its items again; SVG markup
 * becomes a picture, an `.svg` file the asset path stores sanitised and the
 * canvas shows as an image, never as markup in the page; and any other
 * words become a text card. Pictures on the clipboard are the pictures
 * path's (`use-canvas-pictures`), before any text.
 */
import { parseCanvasDoc, type CanvasDoc } from "@kb/canvas";

export type PastedText =
  | { readonly kind: "canvas"; readonly doc: CanvasDoc }
  | { readonly kind: "svg"; readonly file: File }
  | { readonly kind: "text"; readonly text: string };

/** Markup whose root is an `<svg>` element, past a declaration, comments and a DOCTYPE. */
const SVG_MARKUP =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>/]/i;

/** A canvas document with something in it: a JSON object that merely parses is words. */
function canvasDocOf(text: string): CanvasDoc | null {
  try {
    const doc = parseCanvasDoc(text);
    return doc.nodes.length + doc.edges.length > 0 ? doc : null;
  } catch {
    return null;
  }
}

/** What pasting `text` makes, or null for nothing to paste. */
export function readPastedText(text: string): PastedText | null {
  if (text.trim() === "") return null;
  const doc = canvasDocOf(text);
  if (doc !== null) return { kind: "canvas", doc };
  if (SVG_MARKUP.test(text))
    return { kind: "svg", file: new File([text], "pasted.svg", { type: "image/svg+xml" }) };
  return { kind: "text", text: text.trim() };
}
