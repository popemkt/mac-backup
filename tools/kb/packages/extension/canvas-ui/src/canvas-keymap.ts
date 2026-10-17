/**
 * The canvas keymap: chord -> canvas intent, as one table of shortcuts
 * (`CANVAS_SHORTCUTS`), the single statement of the canvas's keys: the
 * keymap matches chords against it, and the view menu, the toolbar's hints
 * and the shortcut sheet list from it, so none of them can disagree.
 *
 * Pure, like the outline's `selection-keymap.ts`: nothing here reads a store, a ref or
 * the DOM, so the whole table is reachable from a unit test. The appliers live
 * beside the hook that owns the effects (`use-canvas-keyboard`). The table's
 * order is load-bearing; `CANVAS_SHORTCUTS` says how.
 */
import type {
  CanvasAlignEdge,
  CanvasFlipAxis,
  CanvasOrder,
  CanvasProjectionKind,
} from "@kb/canvas";
import type { CanvasToolPick } from "./canvas-tool";
import type { CanvasViewPresetName } from "@kb/contracts";
import { CANVAS_VIEW_PRESETS, ZOOM_STEP } from "./canvas-camera";
import type { CanvasAxis, TransformKey, TransformMode } from "./canvas-transform-input";

export interface CanvasKeyEvent {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** Held down: the browser repeating the key. */
  repeat?: boolean;
}

export type CanvasIntent =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "selectAll" }
  | { type: "copy" }
  | { type: "duplicate" }
  | { type: "escape" }
  | { type: "panModifier" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "tool"; tool: CanvasToolPick }
  | { type: "zoomBy"; factor: number }
  | { type: "zoomTo"; zoom: number }
  | { type: "frame"; scope: "all" | "selection" }
  | { type: "look"; preset: CanvasViewPresetName }
  | { type: "toggleLens" }
  | { type: "projection"; kind: CanvasProjectionKind }
  | { type: "viewMenu" }
  /** The sheet that lists every shortcut. */
  | { type: "shortcuts" }
  | { type: "transform"; act: TransformAct }
  /** ⌘G: gather the selection into a group, a frame round it. */
  | { type: "group" }
  /** ⌘⇧G: take the selected groups apart. */
  | { type: "ungroup" }
  /** Look at a frame face-on: a frame is a viewpoint (plan decision 7). */
  | { type: "viewpoint"; id: string }
  /** Present mode: step through the canvas's frames, one viewpoint each. */
  | { type: "present"; act: PresentAct }
  /** The selection locked where it is, or unlocked when all of it is locked. */
  | { type: "lock" }
  /** The selection moved in the paint order (`orderItems`). */
  | { type: "order"; order: CanvasOrder }
  /** The selection mirrored (`flipItems`). */
  | { type: "flip"; axis: CanvasFlipAxis }
  /** The selection lined up on an edge of the box round it. */
  | { type: "align"; edge: CanvasAlignEdge }
  /** The selection spread evenly along an axis. */
  | { type: "distribute"; axis: CanvasFlipAxis }
  /** Where the one item selected leads (its `link`), followed. */
  | { type: "followLink" }
  /** The board's next page (1) or the one before it (-1). */
  | { type: "page"; step: 1 | -1 };

/** What a key does to present mode. */
export type PresentAct = "start" | "next" | "previous" | "stop";

/** What a key does to a modal transform. */
export type TransformAct =
  /** Begin one on the selection: G grab, S scale, E extrude. */
  | { kind: "begin"; mode: Exclude<TransformMode, "rotate"> }
  /** During one: an axis, a typed value, or another mode. */
  | { kind: "key"; key: TransformKey }
  /** During one: ⌘ or Ctrl went down, which suspends snapping. */
  | { kind: "free" }
  | { kind: "confirm" }
  | { kind: "cancel" };

/** What the camera can be asked to do: the view commands. */
type CanvasViewIntent = Extract<
  CanvasIntent,
  { type: "frame" | "look" | "toggleLens" | "projection" | "present" }
>;

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
  /** A modal transform is under way. */
  transforming: boolean;
  /** Frames are being presented. */
  presenting?: boolean;
}

/**
 * A key a shortcut is pressed by: matched by `code` where the key's place
 * is what counts (numpad keys, whatever NumLock and the layout say) or by
 * `key` (letters in either case, unless `cased`), with the modifiers it
 * names. ⌘ and Ctrl are one modifier (`mod`), absent meaning neither;
 * `ctrl` is Ctrl alone. Shift and ⌥ absent take either — but Shift absent
 * under ⌘ is not held, since ⌘⇧ makes a shortcut of its own (the
 * browser's, or another of the canvas's).
 */
interface CanvasChord {
  readonly code?: string;
  readonly key?: string;
  readonly cased?: boolean;
  readonly mod?: boolean | "any";
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** Which state a shortcut acts in: the canvas at rest, a modal transform, present mode. */
type ShortcutMode = "rest" | "transforming" | "presenting";

/** Where a shortcut is listed. */
export type CanvasShortcutSection =
  | "Tools"
  | "Edit"
  | "Arrange"
  | "Navigate"
  | "View"
  | "Transform"
  | "Present";

/**
 * One canvas shortcut: what it is called, where it is listed, the chords
 * that press it, and what it asks for — an intent, one read off the key
 * pressed, or null, a claim with nothing to do. Every chord the canvas
 * claims is one of these, so the keymap, the view menu, the toolbar's
 * hints and the shortcut sheet read one statement.
 */
export interface CanvasShortcut {
  readonly label: string;
  readonly section: CanvasShortcutSection;
  readonly chords: readonly CanvasChord[];
  readonly intent: CanvasIntent | null | ((event: CanvasKeyEvent) => CanvasIntent);
  /** The first chord in words, as a menu or a tooltip shows it; "" for none. */
  readonly hint: string;
  readonly mode: ShortcutMode;
  /** Pressed with nothing selected it does nothing: swallowed, or passed to the browser. */
  readonly needsSelection?: "swallow" | "pass";
  /** Whether the browser's default is prevented; Escape, for one, is left to it. */
  readonly prevent: boolean;
  /** In a modal transform, whether a held key acts again (Backspace); others act once. */
  readonly repeats?: boolean;
}

/** A view command: a shortcut whose intent the camera carries out, listed in the view menu. */
export type CanvasViewCommand = CanvasShortcut & { readonly intent: CanvasViewIntent };

/** What each key is called in a hint. */
const KEY_NAMES: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  " ": "Space",
  Space: "Space",
  Backquote: "`",
  NumpadDecimal: "Num.",
  Delete: "Del",
  Backspace: "⌫",
  Escape: "Esc",
  Enter: "↵",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** A chord in words: its modifiers, then its key as the keyboard shows it. */
export function chordHint(chord: CanvasChord): string {
  const named = chord.code ?? chord.key ?? "";
  const key =
    KEY_NAMES[named] ??
    (/^Numpad\d$/.test(named)
      ? `Num${named.slice(6)}`
      : /^Digit\d$/.test(named)
        ? named.slice(5)
        : /^Key[A-Z]$/.test(named)
          ? named.slice(3)
          : named.length === 1
            ? named.toUpperCase()
            : named);
  const ctrl = chord.ctrl === true ? "⌃" : "";
  const mod = chord.mod === true ? "⌘" : "";
  const alt = chord.alt === true ? "⌥" : "";
  const shift = chord.shift === true ? "⇧" : "";
  return `${ctrl}${mod}${alt}${shift}${key}`;
}

/** A shortcut's row, its hint from its first chord unless it names one. */
function shortcut(
  section: CanvasShortcutSection,
  label: string,
  intent: CanvasShortcut["intent"],
  chords: readonly CanvasChord[],
  more: Partial<Omit<CanvasShortcut, "section" | "label" | "intent" | "chords">> = {},
): CanvasShortcut {
  const first = chords[0];
  return {
    section,
    label,
    intent,
    chords,
    hint: first === undefined ? "" : chordHint(first),
    mode: "rest",
    prevent: true,
    ...more,
  };
}

const view = (
  label: string,
  intent: CanvasViewIntent,
  chords: readonly CanvasChord[],
  more: Partial<CanvasShortcut> = {},
): CanvasViewCommand => ({ ...shortcut("View", label, intent, chords, more), intent });

const look = (preset: CanvasViewPresetName, chords: readonly CanvasChord[]) =>
  view(CANVAS_VIEW_PRESETS[preset].label, { type: "look", preset }, chords);

/**
 * The view commands, in the view menu's order: Blender's numpad views (⌃ for
 * the opposite side; there is no view from under the floor), the lens, the
 * projections, and framing (⇧1 and ⇧2 are tldraw's, numpad `.` Blender's).
 */
export const CANVAS_VIEW_COMMANDS: readonly CanvasViewCommand[] = [
  look("top", [{ code: "Numpad7" }]),
  look("front", [{ code: "Numpad1" }]),
  look("right", [{ code: "Numpad3" }]),
  look("back", [{ code: "Numpad1", ctrl: true }]),
  look("left", [{ code: "Numpad3", ctrl: true }]),
  look("oblique", []),
  view("Orthographic", { type: "toggleLens" }, [{ code: "Numpad5" }]),
  view("2D", { type: "projection", kind: "2d" }, []),
  view("3D", { type: "projection", kind: "3d" }, []),
  view("Frame all", { type: "frame", scope: "all" }, [
    { code: "Digit1", shift: true },
    { key: "!", shift: true },
  ]),
  view(
    "Frame selection",
    { type: "frame", scope: "selection" },
    [{ code: "Digit2", shift: true }, { key: "@", shift: true }, { code: "NumpadDecimal" }],
    { needsSelection: "swallow" },
  ),
  view("Present frames", { type: "present", act: "start" }, []),
];

/** A tool's shortcut. G is not one: it grabs (plan decision 9). */
const tool = (label: string, pick: CanvasToolPick, keys: readonly string[]) =>
  shortcut(
    "Tools",
    label,
    { type: "tool", tool: pick },
    keys.map((key) => ({ key })),
  );

/** An arrangement of the selection, pressed with ⌥ and a letter where the keyboard has it. */
const arrange = (label: string, intent: CanvasIntent, chords: readonly CanvasChord[]) =>
  shortcut("Arrange", label, intent, chords, { needsSelection: "swallow" });

/** ⌥ and a letter, by its place: ⌥ makes another character of it on a Mac. */
const altKey = (letter: string, shift = false): CanvasChord => ({
  code: `Key${letter}`,
  alt: true,
  shift,
});

/** One canvas unit per arrow, ten with Shift held. */
const NUDGE_UNITS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

const nudge =
  (step: number) =>
  (event: CanvasKeyEvent): CanvasIntent => {
    const unit = NUDGE_UNITS[event.key] ?? { dx: 0, dy: 0 };
    return { type: "nudge", dx: unit.dx * step, dy: unit.dy * step };
  };

const ARROWS = Object.keys(NUDGE_UNITS);

/** A modal transform's key act, as an intent. */
const act = (key: TransformKey): CanvasIntent => ({
  type: "transform",
  act: { kind: "key", key },
});

const axis = (name: CanvasAxis, plane: boolean) =>
  shortcut(
    "Transform",
    plane ? `Across the plane off ${name.toUpperCase()}` : `Along ${name.toUpperCase()}`,
    act({ kind: "axis", axis: name, plane }),
    [{ key: name, shift: plane }],
    { mode: "transforming" },
  );

const switchTo = (mode: Exclude<TransformMode, "extrude">, key: string) =>
  shortcut("Transform", `Switch to ${mode}`, act({ kind: "mode", mode }), [{ key }], {
    mode: "transforming",
  });

/** What a key types into a modal transform's value. */
const typed = (event: CanvasKeyEvent) => act({ kind: "type", key: event.key });

const present = (label: string, presentAct: PresentAct, chords: readonly CanvasChord[]) =>
  shortcut("Present", label, { type: "present", act: presentAct }, chords, {
    mode: "presenting",
    prevent: presentAct !== "stop",
  });

/**
 * Every canvas shortcut, in the order a chord is matched, which is
 * load-bearing: in a modal transform its own keys claim every chord (a
 * digit types a value rather than picking a tool, Escape cancels it); while
 * frames are presented their keys come next (the arrows step rather than
 * nudge); then ⌘ chords before plain ones (`⌘c` copies rather than picking
 * the ellipse), the view keys before Delete (numpad `.` frames the
 * selection) and before the tools (a numpad digit with a view looks from
 * it).
 */
export const CANVAS_SHORTCUTS: readonly CanvasShortcut[] = [
  shortcut(
    "Transform",
    "Cancel",
    { type: "transform", act: { kind: "cancel" } },
    [{ key: "Escape", mod: "any" }],
    { mode: "transforming", prevent: false },
  ),
  shortcut(
    "Transform",
    "Confirm",
    { type: "transform", act: { kind: "confirm" } },
    [{ key: "Enter", mod: "any" }],
    { mode: "transforming" },
  ),
  shortcut(
    "Transform",
    "Free of snapping (hold)",
    { type: "transform", act: { kind: "free" } },
    [
      { key: "Meta", mod: "any" },
      { key: "Control", mod: "any" },
    ],
    { mode: "transforming", prevent: false },
  ),
  axis("x", false),
  axis("y", false),
  axis("z", false),
  axis("x", true),
  axis("y", true),
  axis("z", true),
  switchTo("grab", "g"),
  switchTo("rotate", "r"),
  switchTo("scale", "s"),
  shortcut(
    "Transform",
    "Type a value",
    typed,
    "0123456789.-".split("").map((key) => ({ key })),
    { mode: "transforming" },
  ),
  shortcut("Transform", "Erase a typed digit", typed, [{ key: "Backspace" }], {
    mode: "transforming",
    repeats: true,
  }),
  present("Next frame", "next", [
    { key: "ArrowRight" },
    { key: "ArrowDown" },
    { key: "PageDown" },
    { key: " ", shift: false },
  ]),
  present("Previous frame", "previous", [
    { key: "ArrowLeft" },
    { key: "ArrowUp" },
    { key: "PageUp" },
    { key: " ", shift: true },
  ]),
  present("Stop presenting", "stop", [{ key: "Escape" }]),
  shortcut("Edit", "Redo", { type: "redo" }, [
    { key: "z", mod: true, shift: true },
    { key: "Z", mod: true, cased: true },
    { key: "y", mod: true },
  ]),
  shortcut("Edit", "Undo", { type: "undo" }, [{ key: "z", mod: true }]),
  ...CANVAS_VIEW_COMMANDS,
  // ⌃numpad 7 would look from under the floor: there is no such view, so it does nothing.
  shortcut("View", "", null, [{ code: "Numpad7", ctrl: true }]),
  shortcut("View", "View menu", { type: "viewMenu" }, [{ code: "Backquote" }]),
  shortcut("View", "Keyboard shortcuts", { type: "shortcuts" }, [{ key: "?" }]),
  shortcut(
    "Edit",
    "Delete",
    { type: "delete" },
    [
      { key: "Delete", mod: "any" },
      { key: "Backspace", mod: "any" },
    ],
    { needsSelection: "swallow" },
  ),
  shortcut("Edit", "Select all", { type: "selectAll" }, [{ key: "a", mod: true }]),
  // ⌘V is not the canvas's: the browser's paste event carries what the clipboard holds.
  shortcut("Edit", "Copy", { type: "copy" }, [{ key: "c", mod: true }], {
    needsSelection: "swallow",
  }),
  shortcut("Edit", "Group into a frame", { type: "group" }, [{ key: "g", mod: true }], {
    needsSelection: "swallow",
  }),
  shortcut("Edit", "Ungroup", { type: "ungroup" }, [{ key: "g", mod: true, shift: true }], {
    needsSelection: "swallow",
  }),
  shortcut("Edit", "Duplicate", { type: "duplicate" }, [{ key: "d", mod: true }], {
    needsSelection: "swallow",
  }),
  shortcut("Edit", "Lock or unlock", { type: "lock" }, [{ key: "l", shift: true }], {
    needsSelection: "swallow",
  }),
  shortcut("Navigate", "Follow link", { type: "followLink" }, [{ key: "Enter", mod: true }], {
    needsSelection: "swallow",
  }),
  // tldraw's: ⌥ and an arrow turns the page, so it does not nudge.
  shortcut("Navigate", "Next page", { type: "page", step: 1 }, [{ key: "ArrowRight", alt: true }]),
  shortcut("Navigate", "Previous page", { type: "page", step: -1 }, [
    { key: "ArrowLeft", alt: true },
  ]),
  arrange("Forward one step", { type: "order", order: "forward" }, [
    { code: "BracketRight", alt: true },
  ]),
  arrange("Backward one step", { type: "order", order: "backward" }, [
    { code: "BracketLeft", alt: true },
  ]),
  arrange("Bring to front", { type: "order", order: "front" }, [{ code: "BracketRight" }]),
  arrange("Send to back", { type: "order", order: "back" }, [{ code: "BracketLeft" }]),
  arrange("Spread across evenly", { type: "distribute", axis: "x" }, [altKey("H", true)]),
  arrange("Spread down evenly", { type: "distribute", axis: "y" }, [altKey("V", true)]),
  arrange("Align left", { type: "align", edge: "left" }, [altKey("A")]),
  arrange("Align centres across", { type: "align", edge: "centre" }, [altKey("H")]),
  arrange("Align right", { type: "align", edge: "right" }, [altKey("D")]),
  arrange("Align top", { type: "align", edge: "top" }, [altKey("W")]),
  arrange("Align middles down", { type: "align", edge: "middle" }, [altKey("V")]),
  arrange("Align bottom", { type: "align", edge: "bottom" }, [altKey("S")]),
  arrange("Flip left for right", { type: "flip", axis: "x" }, [
    { key: "h", shift: true, alt: false },
  ]),
  arrange("Flip top for bottom", { type: "flip", axis: "y" }, [
    { key: "v", shift: true, alt: false },
  ]),
  shortcut("Edit", "Step out", { type: "escape" }, [{ key: "Escape", mod: "any" }], {
    prevent: false,
  }),
  shortcut("View", "Pan (hold)", { type: "panModifier" }, [{ code: "Space", mod: "any" }]),
  shortcut(
    "Edit",
    "Nudge",
    nudge(1),
    ARROWS.map((key) => ({ key, mod: "any", shift: false })),
    { needsSelection: "pass", hint: "←↑→↓" },
  ),
  shortcut(
    "Edit",
    "Nudge ten",
    nudge(10),
    ARROWS.map((key) => ({ key, mod: "any", shift: true })),
    { needsSelection: "pass", hint: "⇧←↑→↓" },
  ),
  shortcut(
    "Transform",
    "Grab",
    { type: "transform", act: { kind: "begin", mode: "grab" } },
    [{ key: "g", shift: false }],
    { needsSelection: "swallow" },
  ),
  shortcut(
    "Transform",
    "Scale",
    { type: "transform", act: { kind: "begin", mode: "scale" } },
    [{ key: "s", shift: false }],
    { needsSelection: "swallow" },
  ),
  shortcut(
    "Transform",
    "Extrude",
    { type: "transform", act: { kind: "begin", mode: "extrude" } },
    [{ key: "e", shift: false }],
    { needsSelection: "swallow" },
  ),
  tool("Select", "select", ["v", "1"]),
  tool("Hand", "hand", ["h"]),
  tool("Text", "text", ["t", "2"]),
  tool("Rectangle", "rect", ["r", "3"]),
  tool("Ellipse", "ellipse", ["o", "c", "4"]),
  tool("Diamond", "diamond", ["d", "5"]),
  tool("Line", "line", ["l"]),
  tool("Arrow", "arrow", ["a"]),
  tool("Card for a node", "kb-node", ["n", "6"]),
  tool("Frame", "group", ["f", "7"]),
  tool("Solid (the last one made)", "solid", ["b", "8"]),
  shortcut("View", "Zoom in", { type: "zoomBy", factor: ZOOM_STEP }, [
    { key: "=", mod: true },
    { key: "+", mod: true },
  ]),
  shortcut("View", "Zoom out", { type: "zoomBy", factor: 1 / ZOOM_STEP }, [
    { key: "-", mod: true },
  ]),
  shortcut("View", "Zoom to 100%", { type: "zoomTo", zoom: 1 }, [{ key: "0", mod: true }]),
];

const mod = (event: CanvasKeyEvent) => event.metaKey === true || event.ctrlKey === true;

/** Whether `event` presses `chord`. */
function presses(chord: CanvasChord, event: CanvasKeyEvent): boolean {
  if (chord.code !== undefined ? event.code !== chord.code : !sameKey(chord, event.key)) {
    return false;
  }
  const shift = chord.shift ?? (chord.mod === true ? false : undefined);
  if (shift !== undefined && shift !== (event.shiftKey === true)) return false;
  if (chord.alt !== undefined && chord.alt !== (event.altKey === true)) return false;
  if (chord.ctrl === true) return event.ctrlKey === true && event.metaKey !== true;
  return chord.mod === "any" || (chord.mod === true) === mod(event);
}

function sameKey(chord: CanvasChord, key: string): boolean {
  if (chord.key === undefined) return false;
  return chord.cased === true ? chord.key === key : chord.key.toLowerCase() === key.toLowerCase();
}

const claim = (intent: CanvasIntent | null, preventDefault = true): CanvasKeyBinding => ({
  intent,
  preventDefault,
});

/** The mode a state puts the canvas in, for its shortcuts. */
const modesOf = (state: CanvasKeyState): readonly ShortcutMode[] =>
  state.transforming
    ? ["transforming"]
    : state.presenting === true
      ? ["presenting", "rest"]
      : ["rest"];

/** What pressing `found` in `state` claims. */
function bindingOf(found: CanvasShortcut, event: CanvasKeyEvent, state: CanvasKeyState) {
  // A held key acts once in a modal transform: holding X would cycle the axes, a digit type dozens.
  if (found.mode === "transforming" && event.repeat === true && found.repeats !== true) {
    return claim(null);
  }
  if (found.needsSelection !== undefined && state.selectionEmpty) {
    return claim(null, found.needsSelection === "swallow");
  }
  const intent = typeof found.intent === "function" ? found.intent(event) : found.intent;
  return claim(intent, found.prevent);
}

/**
 * The chord's binding, or null when the canvas does not claim the chord. A
 * modal transform claims every chord: any it has no shortcut for does
 * nothing, its browser default kept (a held one is swallowed).
 */
export function mapCanvasKey(
  event: CanvasKeyEvent,
  state: CanvasKeyState,
): CanvasKeyBinding | null {
  for (const mode of modesOf(state)) {
    const found = CANVAS_SHORTCUTS.find(
      (s) => s.mode === mode && s.chords.some((chord) => presses(chord, event)),
    );
    if (found !== undefined) return bindingOf(found, event, state);
  }
  if (state.transforming) return claim(null, event.repeat === true);
  return null;
}

/** The hint of the shortcut that asks for `intent`, as a tooltip shows it; "" for none. */
export function shortcutHint(intent: CanvasIntent): string {
  const wanted = JSON.stringify(intent);
  return CANVAS_SHORTCUTS.find((s) => JSON.stringify(s.intent) === wanted)?.hint ?? "";
}
