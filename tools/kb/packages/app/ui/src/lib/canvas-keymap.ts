/**
 * The canvas keymap: chord -> canvas intent.
 *
 * Pure, like `lib/selection-keymap.ts`: nothing here reads a store, a ref or
 * the DOM, so the whole table is reachable from a unit test. The appliers live
 * beside the hook that owns the effects (`components/canvas/use-canvas-keyboard`).
 *
 * The chord maps are consulted in {@link CHORD_MAPS} order, and that order is
 * load-bearing: `⌘c` copies rather than picking the ellipse tool, `⌘d`
 * duplicates rather than picking the diamond, `Delete` deletes rather than
 * nudging, and a numpad view key looks from its view rather than picking the
 * tool of the same digit (or deleting, for numpad `.` with NumLock off).
 */
import type { CanvasProjectionKind } from "@kb/canvas";
import type { CanvasTool, CanvasToolPick } from "@/lib/canvas-tool";
import { CANVAS_VIEW_PRESETS, ZOOM_STEP, type CanvasViewPreset } from "@/lib/canvas-camera";

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
  | { type: "tool"; tool: CanvasToolPick }
  | { type: "zoomBy"; factor: number }
  | { type: "zoomTo"; zoom: number }
  | { type: "frame"; scope: "all" | "selection" }
  | { type: "look"; preset: CanvasViewPreset }
  | { type: "toggleLens" }
  | { type: "projection"; kind: CanvasProjectionKind }
  | { type: "viewMenu" };

/** What the camera can be asked to do: the view commands. */
type CanvasViewIntent = Extract<
  CanvasIntent,
  { type: "frame" | "look" | "toggleLens" | "projection" }
>;

/**
 * A physical chord: matched by `code` where the key's place is what counts
 * (numpad keys, whatever NumLock and the layout say) or by `key`, with
 * exactly the modifiers it names.
 */
interface ViewChord {
  readonly code?: string;
  readonly key?: string;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
}

/**
 * A view command: what it asks of the camera, what the view menu calls it,
 * the chord as the menu shows it, and the chords that ask for it. One table
 * serves the keymap and the menu, so the two cannot disagree.
 */
export interface CanvasViewCommand {
  readonly intent: CanvasViewIntent;
  readonly label: string;
  readonly hint: string;
  readonly chords: readonly ViewChord[];
}

const look = (
  preset: CanvasViewPreset,
  hint: string,
  chords: readonly ViewChord[],
): CanvasViewCommand => ({
  intent: { type: "look", preset },
  label: CANVAS_VIEW_PRESETS[preset].label,
  hint,
  chords,
});

/**
 * The view commands, in the view menu's order: Blender's numpad views (⌃ for
 * the opposite side; there is no view from under the floor), the lens, the
 * projections, and framing (⇧1 and ⇧2 are tldraw's, numpad `.` Blender's).
 */
export const CANVAS_VIEW_COMMANDS: readonly CanvasViewCommand[] = [
  look("top", "Num7", [{ code: "Numpad7" }]),
  look("front", "Num1", [{ code: "Numpad1" }]),
  look("right", "Num3", [{ code: "Numpad3" }]),
  look("back", "⌃Num1", [{ code: "Numpad1", ctrl: true }]),
  look("left", "⌃Num3", [{ code: "Numpad3", ctrl: true }]),
  look("oblique", "", []),
  {
    intent: { type: "toggleLens" },
    label: "Orthographic",
    hint: "Num5",
    chords: [{ code: "Numpad5" }],
  },
  { intent: { type: "projection", kind: "2d" }, label: "2D", hint: "", chords: [] },
  { intent: { type: "projection", kind: "3d" }, label: "3D", hint: "", chords: [] },
  {
    intent: { type: "frame", scope: "all" },
    label: "Frame all",
    hint: "⇧1",
    chords: [
      { code: "Digit1", shift: true },
      { key: "!", shift: true },
    ],
  },
  {
    intent: { type: "frame", scope: "selection" },
    label: "Frame selection",
    hint: "⇧2",
    chords: [{ code: "Digit2", shift: true }, { key: "@", shift: true }, { code: "NumpadDecimal" }],
  },
];

/** The chord that opens the view menu, for keyboards without a numpad. */
const VIEW_MENU_CHORD: ViewChord = { code: "Backquote" };

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

/** The solid tool's keys (plan 2026-10-02 decision 9): which solid it is is the tool state's. */
const SOLID_TOOL_KEYS = new Set(["b", "8"]);

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

const matches = (chord: ViewChord, event: CanvasKeyEvent): boolean =>
  (chord.code === undefined ? event.key === chord.key : event.code === chord.code) &&
  (chord.shift === true) === (event.shiftKey === true) &&
  (chord.ctrl === true) === (event.ctrlKey === true) &&
  event.metaKey !== true;

const mapView: ChordMap = (event, state) => {
  if (matches(VIEW_MENU_CHORD, event)) return claim({ type: "viewMenu" });
  const command = CANVAS_VIEW_COMMANDS.find((c) => c.chords.some((ch) => matches(ch, event)));
  if (command === undefined) {
    // A numpad digit with no view keeps its tool; ⌃numpad 7 (from under the floor) is no view.
    return event.code === "Numpad7" ? claim(null) : null;
  }
  const { intent } = command;
  return intent.type === "frame" && intent.scope === "selection"
    ? claimWithSelection(intent, state)
    : claim(intent);
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
  const key = event.key.toLowerCase();
  if (SOLID_TOOL_KEYS.has(key)) return claim({ type: "tool", tool: "solid" });
  const tool = TOOL_KEYS[key];
  return tool === undefined ? null : claim({ type: "tool", tool });
};

const mapZoom: ChordMap = (event) => {
  if (mod(event) && (event.key === "=" || event.key === "+"))
    return claim({ type: "zoomBy", factor: ZOOM_STEP });
  if (mod(event) && event.key === "-") return claim({ type: "zoomBy", factor: 1 / ZOOM_STEP });
  if (mod(event) && event.key === "0") return claim({ type: "zoomTo", zoom: 1 });
  return null;
};

const CHORD_MAPS: readonly ChordMap[] = [
  mapHistory,
  mapView,
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
