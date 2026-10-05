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
 *   every bullet: ⌘/Ctrl-click follows; Shift-click follows into a new pane
 *   beside this one; a plain click toggles where the bullet can toggle, and
 *   follows where it cannot.
 *
 * Carrying a follow out — zooming, jumping, opening a tab — needs the page,
 * so a {@link CarryOutFollow} does it (the shell's `followFrom`, which
 * `BrowserHost.follow` is), `useFollowThrough` binds one to where the caller
 * is drawn, and a primitive takes the result as a prop.
 */
import { createContext, useCallback, useContext, type MouseEvent as ReactMouseEvent } from "react";
import { asElement } from "./dom";
import { INLINE_TEXT_CLASSES, KB_REF_ID_ATTR } from "./md-edit";
import { usePane } from "./pane";

/** Where a pointer goes: a node in this graph, or a location outside it. */
export type FollowTarget = { kind: "node"; id: string } | { kind: "href"; href: string };

/**
 * How far a node follow goes. `open` makes the node the pane's page (the
 * zoom, or the pane's location); `reveal` jumps to it in place; `beside`
 * opens it in a new pane to the right of this one (Tana's panels). A
 * location outside the graph only opens.
 */
export type FollowHow = "open" | "reveal" | "beside";

/** Carry out a follow. The one handler every surface is handed. */
export type Follow = (target: FollowTarget, how: FollowHow) => void;

export const nodeTarget = (id: string): FollowTarget => ({ kind: "node", id });

/**
 * How the page around a point opens a node as its page, where that is not
 * the outline's zoom: an outline rooted at a node in its pane moves its pane
 * to the node instead. None means the zoom.
 */
export const OpenNodeContext = createContext<((id: string) => void) | null>(null);

/** Where a follow is carried out from: the caller's pane, and how the page around it opens a node. */
export interface FollowFrom {
  readonly pane: string;
  /** Open a node as the page around the caller (`OpenNodeContext`); null means the outline's zoom. */
  readonly open: ((id: string) => void) | null;
}

/** Carry out a follow from where its caller is drawn. */
export type CarryOutFollow = (at: FollowFrom, target: FollowTarget, how: FollowHow) => void;

/** How a pointer is followed from where the caller is drawn, carried out by `carryOut`. */
export function useFollowThrough(carryOut: CarryOutFollow): Follow {
  const open = useContext(OpenNodeContext);
  const pane = usePane();
  return useCallback<Follow>(
    (target, how) => carryOut({ pane, open }, target, how),
    [carryOut, open, pane],
  );
}

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

/** A Shift-click opens beside; a ⌘/Ctrl-click reveals where a plain click opens. */
export function followHowOf(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): FollowHow {
  if (e.shiftKey) return "beside";
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

/**
 * What a bullet click does: toggle it, or follow the node it stands for —
 * opened as the pane's page, or beside the pane on Shift.
 */
export function bulletClickIntent(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  canToggle: boolean,
): "toggle" | "open" | "beside" {
  if (e.shiftKey) return "beside";
  return e.metaKey || e.ctrlKey || !canToggle ? "open" : "toggle";
}
