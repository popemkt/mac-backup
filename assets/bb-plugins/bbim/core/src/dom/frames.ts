// Frames: the documents bbim can reach into (same-origin, recursively) and
// the ones it can only talk to through the hint bridge (cross-origin, or
// sandboxed without allow-same-origin). Only iframes: a frameset document
// has no body, so it cannot host an app bbim runs in.
import { intersect, type Rect } from "../domain/targets.ts";
import { type DocumentPlacement, viewportOf, visibleBox } from "./collect.ts";

/** A frame bbim cannot script; it may answer the bridge protocol. */
export interface OpaqueFrame {
  readonly element: HTMLIFrameElement;
  /** The window the frame's bridge posts to (the frame element's own window). */
  readonly host: Window;
  /** Its content box in top-level coordinates, clipped to what is on screen. */
  readonly box: Rect;
  /** Offset of the frame's viewport origin in top-level coordinates. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface FrameTree {
  /** Every reachable document, the top one first. */
  readonly documents: ReadonlyArray<DocumentPlacement>;
  readonly opaque: ReadonlyArray<OpaqueFrame>;
}

const MAX_DEPTH = 8;

const pad = (value: string | undefined): number => Number.parseFloat(value ?? "0") || 0;

function contentBox(frame: Element, offsetX: number, offsetY: number): { box: Rect; x: number; y: number } {
  const rect = frame.getBoundingClientRect();
  const style = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  const [padLeft, padRight, padTop, padBottom] = [
    pad(style?.paddingLeft),
    pad(style?.paddingRight),
    pad(style?.paddingTop),
    pad(style?.paddingBottom),
  ];
  const x = rect.left + frame.clientLeft + padLeft + offsetX;
  const y = rect.top + frame.clientTop + padTop + offsetY;
  const width = frame.clientWidth - padLeft - padRight;
  const height = frame.clientHeight - padTop - padBottom;
  return { box: { left: x, top: y, width, height }, x, y };
}

function reachableDocument(frame: HTMLIFrameElement): Document | null {
  try {
    const doc = frame.contentDocument;
    // A frame still on about:blank while its real document loads has nothing to hint.
    return doc?.documentElement == null ? null : doc;
  } catch {
    return null;
  }
}

/** Whether the frame element itself is visible at its center in its own document. */
function frameShows(frame: Element): boolean {
  const rect = frame.getBoundingClientRect();
  if (rect.width < 3 || rect.height < 3) return false;
  const hit = frame.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return hit === frame;
}

/**
 * Walk the frame tree from the top document. Same-origin frames become
 * documents to collect from, placed and clipped; opaque frames are listed for
 * the bridge.
 */
export function frameTree(top: Document): FrameTree {
  const view = top.defaultView;
  const topClip: Rect = {
    left: 0,
    top: 0,
    width: view?.innerWidth ?? top.documentElement.clientWidth,
    height: view?.innerHeight ?? top.documentElement.clientHeight,
  };
  const documents: Array<DocumentPlacement> = [];
  const opaque: Array<OpaqueFrame> = [];
  const visit = (placement: DocumentPlacement, depth: number) => {
    documents.push(placement);
    if (depth >= MAX_DEPTH) return;
    for (const frame of placement.doc.querySelectorAll<HTMLIFrameElement>("iframe")) {
      if (!frameShows(frame)) continue;
      const { box, x, y } = contentBox(frame, placement.offsetX, placement.offsetY);
      const clip = intersect(box, placement.clip);
      if (clip === undefined) continue;
      const inner = reachableDocument(frame);
      if (inner !== null) {
        visit({ doc: inner, offsetX: x, offsetY: y, clip }, depth + 1);
      } else if (placement.doc.defaultView !== null) {
        opaque.push({ element: frame, host: placement.doc.defaultView, box: clip, offsetX: x, offsetY: y });
      }
    }
  };
  visit({ doc: top, offsetX: 0, offsetY: 0, clip: topClip }, 0);
  return { documents, opaque };
}

/**
 * Where `doc` sits in `root`'s viewport right now, found by walking up its
 * frame elements; undefined when it is not under `root` or is scrolled away.
 */
export function placementOf(root: Document, doc: Document): DocumentPlacement | undefined {
  const chain: Array<Element> = [];
  let current = doc;
  for (let depth = 0; current !== root; depth += 1) {
    const frame = depth < MAX_DEPTH ? (current.defaultView?.frameElement ?? null) : null;
    if (frame === null) return undefined;
    chain.push(frame);
    current = frame.ownerDocument;
  }
  let placement: DocumentPlacement = {
    doc: root,
    offsetX: 0,
    offsetY: 0,
    clip: { left: 0, top: 0, width: root.defaultView?.innerWidth ?? 0, height: root.defaultView?.innerHeight ?? 0 },
  };
  for (const frame of chain.toReversed()) {
    const { box, x, y } = contentBox(frame, placement.offsetX, placement.offsetY);
    const clip = intersect(box, placement.clip);
    if (clip === undefined || !("contentDocument" in frame)) return undefined;
    const inner = reachableDocument(frame as HTMLIFrameElement);
    if (inner === null) return undefined;
    placement = { doc: inner, offsetX: x, offsetY: y, clip };
  }
  return placement;
}

/** An element's visible box now, in `root`'s viewport; undefined when off screen. */
export function liveRect(root: Document, element: Element): Rect | undefined {
  const placement = placementOf(root, element.ownerDocument);
  if (placement === undefined) return undefined;
  const shown = visibleBox(element, viewportOf(element.ownerDocument));
  if (shown === undefined) return undefined;
  return intersect(
    { left: shown.left + placement.offsetX, top: shown.top + placement.offsetY, width: shown.width, height: shown.height },
    placement.clip,
  );
}

/** An opaque frame's placement now (its page may have scrolled since collection). */
export function liveFrame(root: Document, frame: OpaqueFrame): OpaqueFrame | undefined {
  const placement = placementOf(root, frame.element.ownerDocument);
  if (placement === undefined) return undefined;
  const { box, x, y } = contentBox(frame.element, placement.offsetX, placement.offsetY);
  const clip = intersect(box, placement.clip);
  return clip === undefined ? undefined : { ...frame, box: clip, offsetX: x, offsetY: y };
}
