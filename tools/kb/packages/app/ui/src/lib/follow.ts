/**
 * Following: going where something points. One function for every pointer
 * in kb — a `[[ref]]` pill or a markdown link in node text, a bullet, a field
 * value — so a link reads and acts the same wherever it appears.
 *
 * Two halves live here, both pure of the stores:
 *
 * - **What a click landed on.** A *pointer segment* is an element that says
 *   where it points: a reference (`data-kb-ref-id`), a link (`a.kb-md-link`,
 *   a real anchor, so the browser's own open, middle-click and context menu
 *   work), or a media embed, which keeps its click to play. `pointerAt` reads
 *   that off the DOM, and `routePointerClick` hands it to the surface's
 *   `follow`. Surfaces never test those markers themselves.
 * - **What a bullet click means.** `bulletClickIntent` is the one rule for
 *   every bullet: ⌘/Ctrl-click follows; a plain click toggles where the
 *   bullet can toggle, and follows where it cannot.
 *
 * Carrying a follow out — zooming, jumping, opening a tab — needs the store,
 * so it is `useFollow` (stores/follow.ts), and a primitive takes it as a prop.
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import { asElement } from "@/lib/dom";
import { INLINE_TEXT_CLASSES, KB_REF_ID_ATTR } from "@/lib/md-edit";

/** Where a pointer goes: a node in this graph, or a location outside it. */
export type FollowTarget = { kind: "node"; id: string } | { kind: "href"; href: string };

/**
 * How far a node follow goes. `open` makes the node the page (zoom);
 * `reveal` jumps to it in place. A location outside the graph only opens.
 */
export type FollowHow = "open" | "reveal";

/** Carry out a follow. The one handler every surface is handed. */
export type Follow = (target: FollowTarget, how: FollowHow) => void;

export const nodeTarget = (id: string): FollowTarget => ({ kind: "node", id });

/** What an element in rendered content points at, if it is a pointer segment. */
type PointerHit =
  /** A reference: the surface follows it. */
  | { kind: "follow"; target: FollowTarget }
  /** A real anchor or a player: the element acts on the click itself. */
  | { kind: "native" };

function pointerAt(el: Element | null): PointerHit | null {
  if (el === null) return null;
  const id = el.closest(`[${KB_REF_ID_ATTR}]`)?.getAttribute(KB_REF_ID_ATTR);
  if (id !== null && id !== undefined && id !== "") {
    return { kind: "follow", target: nodeTarget(id) };
  }
  if (el.closest(`a.${INLINE_TEXT_CLASSES.link}, .kb-md-media`)) return { kind: "native" };
  return null;
}

/** A modifier-click reveals where a plain click opens. */
function followHowOf(e: { metaKey: boolean; ctrlKey: boolean }): FollowHow {
  return e.metaKey || e.ctrlKey ? "reveal" : "open";
}

/**
 * Route a click inside rendered content: a pointer segment is followed (or,
 * for a real anchor or a player, left to act on the click itself), and
 * anything else is not the pointer's business. True when it was handled.
 *
 * Every surface that renders pointers routes clicks through this, so a
 * reference is clicked the same way in a read-only list, an outline row and a
 * field value.
 */
export function routePointerClick(e: ReactMouseEvent, follow: Follow): boolean {
  const hit = pointerAt(asElement(e.target) ?? null);
  if (hit === null) return false;
  e.stopPropagation();
  if (hit.kind === "follow") {
    e.preventDefault();
    follow(hit.target, followHowOf(e));
  }
  return true;
}

/** What a bullet click does: follow the node the bullet stands for, or toggle it. */
export function bulletClickIntent(
  e: { metaKey: boolean; ctrlKey: boolean },
  canToggle: boolean,
): "follow" | "toggle" {
  return e.metaKey || e.ctrlKey || !canToggle ? "follow" : "toggle";
}
