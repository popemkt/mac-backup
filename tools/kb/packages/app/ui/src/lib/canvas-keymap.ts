/**
 * The canvas keymap: chord -> canvas intent.
 *
 * Pure, like `lib/selection-keymap.ts`: nothing here reads a store, a ref or
 * the DOM, so the whole table is reachable from a unit test. The appliers live
 * beside the hook that owns the effects (`components/canvas/use-canvas-keyboard`).
 *
 * The chord maps are consulted in {@link CHORD_MAPS} order, and that order is
 * load-bearing: `⌘c` copies rather than picking the ellipse tool, `⌘d`
 * duplicates rather than picking the diamond, and `Delete` deletes rather than
 * nudging.
 */
import type { CanvasTool } from "@/lib/canvas-tool";
import { ZOOM_STEP } from "@/lib/canvas-viewport";

export interface CanvasKeyEvent {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export type CanvasIntent =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "selectAll" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "duplicate" }
  | { type: "escape" }
  | { type: "panModifier" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "tool"; tool: CanvasTool }
  | { type: "zoomBy"; factor: number }
  | { type: "zoomTo"; zoom: number }
  | { type: "zoomToFit" };

/**
 * A chord the canvas claims.
 *
 * `intent: null` is a claim with nothing to do — a selection-only command
 * pressed with nothing selected. That is not the same as claiming nothing:
 * the chord is still consumed, and `preventDefault` still decides whether the
 * browser gets it. Delete, copy and duplicate swallow the default that way;
 * an arrow key does not, and neither does Escape.
 */
export interface CanvasKeyBinding {
  intent: CanvasIntent | null;
  preventDefault: boolean;
}

export interface CanvasKeyState {
  selectionEmpty: boolean;
}

/** Tool shortcuts, by lowercased key. */
const TOOL_KEYS: Record<string, CanvasTool> = {
  v: "select",
  "1": "select",
  t: "text",
  "2": "text",
  r: "rect",
  "3": "rect",
  o: "ellipse",
  c: "ellipse",
  "4": "ellipse",
  d: "diamond",
  "5": "diamond",
  n: "kb-node",
  "6": "kb-node",
  g: "group",
  f: "group",
  "7": "group",
};

/** One canvas unit per arrow, ten with Shift held. */
const NUDGE_UNITS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

type ChordMap = (event: CanvasKeyEvent, state: CanvasKeyState) => CanvasKeyBinding | null;

const mod = (event: CanvasKeyEvent) => event.metaKey === true || event.ctrlKey === true;

const claim = (intent: CanvasIntent | null, preventDefault = true): CanvasKeyBinding => ({
  intent,
  preventDefault,
});

/** A command that needs something selected: claimed either way. */
const claimWithSelection = (intent: CanvasIntent, state: CanvasKeyState): CanvasKeyBinding =>
  claim(state.selectionEmpty ? null : intent);

const mapHistory: ChordMap = (event) => {
  if (!mod(event)) return null;
  if (event.key === "z" && event.shiftKey !== true) return claim({ type: "undo" });
  if (event.key === "Z" || (event.key === "z" && event.shiftKey === true))
    return claim({ type: "redo" });
  if (event.key === "y") return claim({ type: "redo" });
  return null;
};

const mapSelection: ChordMap = (event, state) => {
  if (event.key === "Delete" || event.key === "Backspace")
    return claimWithSelection({ type: "delete" }, state);
  if (mod(event) && event.key === "a") return claim({ type: "selectAll" });
  return null;
};

const mapClipboard: ChordMap = (event, state) => {
  if (!mod(event)) return null;
  if (event.key === "c") return claimWithSelection({ type: "copy" }, state);
  if (event.key === "v") return claim({ type: "paste" });
  return null;
};

const mapDuplicate: ChordMap = (event, state) => {
  if (!mod(event) || event.key !== "d") return null;
  return claimWithSelection({ type: "duplicate" }, state);
};

const mapCanvasState: ChordMap = (event) => {
  // Escape is the one chord left un-prevented: a native surface may want it.
  if (event.key === "Escape") return claim({ type: "escape" }, false);
  if (event.code === "Space") return claim({ type: "panModifier" });
  return null;
};

const mapNudge: ChordMap = (event, state) => {
  if (!event.key.startsWith("Arrow")) return null;
  // The one claim that leaves the default alone.
  if (state.selectionEmpty) return claim(null, false);
  const step = event.shiftKey === true ? 10 : 1;
  const unit = NUDGE_UNITS[event.key] ?? { dx: 0, dy: 0 };
  return claim({ type: "nudge", dx: unit.dx * step, dy: unit.dy * step });
};

const mapTool: ChordMap = (event) => {
  const tool = TOOL_KEYS[event.key.toLowerCase()];
  return tool === undefined ? null : claim({ type: "tool", tool });
};

const mapZoom: ChordMap = (event) => {
  if (mod(event) && (event.key === "=" || event.key === "+"))
    return claim({ type: "zoomBy", factor: ZOOM_STEP });
  if (mod(event) && event.key === "-") return claim({ type: "zoomBy", factor: 1 / ZOOM_STEP });
  if (mod(event) && event.key === "0") return claim({ type: "zoomTo", zoom: 1 });
  if (event.shiftKey === true && event.key === "!") return claim({ type: "zoomToFit" });
  return null;
};

const CHORD_MAPS: readonly ChordMap[] = [
  mapHistory,
  mapSelection,
  mapClipboard,
  mapDuplicate,
  mapCanvasState,
  mapNudge,
  mapTool,
  mapZoom,
];

/** The chord's binding, or null when the canvas does not claim the chord. */
export function mapCanvasKey(
  event: CanvasKeyEvent,
  state: CanvasKeyState,
): CanvasKeyBinding | null {
  for (const map of CHORD_MAPS) {
    const binding = map(event, state);
    if (binding !== null) return binding;
  }
  return null;
}
