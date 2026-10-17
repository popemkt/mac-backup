/**
 * Drawings anchored to what a view shows (DESIGN.md → Sandbox → Scripts):
 * a script's frame lies over its view, and an element of what it draws that
 * names a thing of that view by `data-anchor` stands on that thing's
 * rectangle as the view draws it now. The view tells the frame where its
 * things are (`kb/anchors`); the frame, not the guest, keeps every anchored
 * element there, so a drawing follows the camera without being drawn again.
 */
import { Schema } from "effect";

/** The attribute that pins a drawn element to a thing of its view, by the thing's id. */
export const SANDBOX_ANCHOR_ATTR = "data-anchor";

/** A thing's rectangle in its view, CSS pixels from the view's top left: the frame's own. */
export const SandboxAnchor = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
});
export type SandboxAnchor = typeof SandboxAnchor.Type;

/** Where a view draws each of its things now, by id; a thing it does not draw is absent. */
export const SandboxAnchors = Schema.Record(Schema.String, SandboxAnchor);
export type SandboxAnchors = typeof SandboxAnchors.Type;

/** The part of a drawn element the frame moves: its anchor and its inline style. */
export interface AnchoredElement {
  getAttribute(name: string): string | null;
  readonly style: {
    display: string;
    position: string;
    boxSizing: string;
    left: string;
    top: string;
    width: string;
    height: string;
  };
}

/** Where the frame finds what was drawn: the box it drew into. */
export interface AnchoredBox {
  querySelectorAll(selector: string): Iterable<AnchoredElement>;
}

/**
 * Stand every anchored element under `box` on its thing's rectangle, and
 * hide one whose thing the view does not draw.
 */
export function placeAnchored(box: AnchoredBox, anchors: SandboxAnchors): void {
  for (const element of box.querySelectorAll(`[${SANDBOX_ANCHOR_ATTR}]`)) {
    const at = anchors[element.getAttribute(SANDBOX_ANCHOR_ATTR) ?? ""];
    element.style.display = at === undefined ? "none" : "";
    if (at === undefined) continue;
    element.style.position = "fixed";
    element.style.boxSizing = "border-box";
    element.style.left = `${at.left}px`;
    element.style.top = `${at.top}px`;
    element.style.width = `${at.right - at.left}px`;
    element.style.height = `${at.bottom - at.top}px`;
  }
}
