import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasNode, CanvasProjectionKind } from "@kb/canvas";
import {
  carriedBy,
  carriedPart,
  groupItems,
  moveBy,
  parseCanvasDoc,
  pasteItems,
  selectionPivot,
  settleMembership,
  transformCarried,
  ungroupItems,
} from "@kb/canvas";
import {
  type CanvasScope,
  type CanvasSelection,
  EMPTY_SELECTION,
  deleteSelected,
  selectAll,
  selectNode,
  selectionEmpty,
} from "./canvas-selection";
import {
  mapCanvasKey,
  type CanvasIntent,
  type PresentAct,
  type TransformAct,
} from "./canvas-keymap";
import { GRID_STEP } from "./canvas-snap";
import { reduceCanvasTool, type CanvasToolPick, type ToolState } from "./canvas-tool";
import type { CanvasViewportControls } from "./canvas-camera";
import type { CanvasPointerEvent } from "./canvas-pointer";
import { isTextEntry } from "@/sdk";

/**
 * The canvas keyboard surface: `components/canvas/canvas-keymap` decides *what* a chord
 * means, this file decides *how* that intent reaches the document, the
 * selection and the viewport. The listener itself is plumbing between the two,
 * and the view menu sends its commands through the same applier.
 */
interface CanvasKeyboardContext {
  cancelPointer: () => void;
  /** The pointer reducer, which owns a modal transform as it owns any other transform drag. */
  dispatchPointer: (event: CanvasPointerEvent) => void;
  /** Where the pointer last was over the canvas, as a viewport point: where a modal transform begins. */
  pointerAt: () => { x: number; y: number };
  /** A modal transform is under way. */
  transforming: () => boolean;
  /** Frames are being presented. */
  presenting: () => boolean;
  /** Step present mode: start it, move through the frames, or stop. */
  present: (act: PresentAct) => void;
  /** A tool other than select is armed. */
  toolArmed: boolean;
  /** The group entered, where a selection is made. */
  scope: CanvasScope;
  /** Esc out of the group entered; false when there is none. */
  leaveScope: () => boolean;
  byId: Map<string, CanvasNode>;
  docRef: RefObject<CanvasDoc>;
  selRef: RefObject<CanvasSelection>;
  schedulePersist: (doc: CanvasDoc) => void;
  undoCanvasDoc: () => void;
  redoCanvasDoc: () => void;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setItemInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setSpaceDown: Dispatch<SetStateAction<boolean>>;
  setToolState: Dispatch<SetStateAction<ToolState>>;
  /** The camera of the projection that is showing. */
  viewport: CanvasViewportControls;
  chooseProjection: (kind: CanvasProjectionKind) => void;
  openViewMenu: () => void;
}

/** Pasted and duplicated content lands this far from its origin. */
const CLONE_OFFSET = 24;

function deleteSelection(context: CanvasKeyboardContext) {
  context.schedulePersist(deleteSelected(context.docRef.current, context.selRef.current));
  context.setSelection(EMPTY_SELECTION);
  context.setInspectorAnchor(null);
  context.setItemInspectorAnchor(null);
}

/** A copy takes the selected items with their members, the edges among them and the edges selected. */
function copySelection(context: CanvasKeyboardContext) {
  const { nodeIds, edgeIds } = context.selRef.current;
  const copied = carriedPart(context.docRef.current, nodeIds, edgeIds);
  void navigator.clipboard.writeText(JSON.stringify(copied));
}

/**
 * Write `source` in as new items, offset from where they were (`pasteItems`),
 * and select them: what a paste and a duplicate both are.
 */
function pasteDoc(source: CanvasDoc, context: CanvasKeyboardContext, selectEdges: boolean) {
  const offset = { x: CLONE_OFFSET, y: CLONE_OFFSET };
  const pasted = pasteItems(context.docRef.current, source, offset, ulid);
  context.schedulePersist(pasted.doc);
  context.setSelection({
    nodeIds: new Set(pasted.nodeIds),
    edgeIds: new Set(selectEdges ? pasted.edgeIds : []),
  });
}

function pasteCanvas(text: string, context: CanvasKeyboardContext) {
  try {
    pasteDoc(parseCanvasDoc(text), context, true);
  } catch {
    // Clipboard content is not a canvas document.
  }
}

function duplicateSelection(context: CanvasKeyboardContext) {
  pasteDoc(carriedPart(context.docRef.current, context.selRef.current.nodeIds), context, false);
}

/** ⌘G: the selection gathered into a new group, a frame a grid step round it, which is selected. */
function groupSelection(context: CanvasKeyboardContext) {
  const id = ulid();
  const grouped = groupItems(context.docRef.current, context.selRef.current.nodeIds, id, GRID_STEP);
  if (grouped === context.docRef.current) return;
  context.schedulePersist(grouped);
  context.setSelection(selectNode(id));
}

/** ⌘⇧G: the selected groups taken apart; what they held is selected. */
function ungroupSelection(context: CanvasKeyboardContext) {
  const { doc, released } = ungroupItems(context.docRef.current, context.selRef.current.nodeIds);
  if (doc === context.docRef.current) return;
  context.schedulePersist(doc);
  context.setSelection({ nodeIds: new Set(released), edgeIds: new Set() });
}

/**
 * Esc steps out one thing at a time (plan decision 14): a modal transform
 * (its own map), present mode (its own map), an armed tool, the group
 * entered, then the selection.
 */
function escapeCanvas(context: CanvasKeyboardContext) {
  context.cancelPointer();
  if (context.toolArmed) {
    context.setToolState((state) => reduceCanvasTool(state, { type: "escape" }));
    return;
  }
  if (context.leaveScope()) return;
  context.setToolState((state) => reduceCanvasTool(state, { type: "escape" }));
  context.setSelection(EMPTY_SELECTION);
  context.setInspectorAnchor(null);
  context.setItemInspectorAnchor(null);
}

/**
 * A nudge is a move of the selection, the one transform every other move
 * is: its groups' members come too, and what it lets go of belongs to the
 * frame that holds it there.
 */
function nudgeSelection(context: CanvasKeyboardContext, dx: number, dy: number) {
  const doc = context.docRef.current;
  const carried = carriedBy(doc.nodes, context.selRef.current.nodeIds);
  const t = moveBy(selectionPivot(carried.items), { x: dx, y: dy, z: 0 });
  const moved = transformCarried(doc, carried, t);
  context.schedulePersist(
    settleMembership(
      moved,
      carried.items.map((item) => item.id),
    ),
  );
}

function chooseTool(context: CanvasKeyboardContext, tool: CanvasToolPick) {
  if (tool === "kb-node") {
    context.setToolState({ tool: "select" });
    context.setPickerOpen(true);
    return;
  }
  context.setToolState((state) => reduceCanvasTool(state, { type: "set-tool", tool }));
}

/** Frame every item, or the selected ones. */
function frameItems(context: CanvasKeyboardContext, scope: "all" | "selection"): void {
  const { nodes } = context.docRef.current;
  const chosen = context.selRef.current.nodeIds;
  context.viewport.frame(scope === "all" ? nodes : nodes.filter((node) => chosen.has(node.id)));
}

/**
 * A key's act on a modal transform: the pointer reducer owns the transform,
 * so each act is one of its events; it begins where the pointer last was.
 */
function applyTransformAct(context: CanvasKeyboardContext, act: TransformAct): void {
  switch (act.kind) {
    case "begin":
      context.setInspectorAnchor(null);
      context.setItemInspectorAnchor(null);
      context.dispatchPointer({
        type: "transform/begin",
        mode: act.mode,
        screen: context.pointerAt(),
      });
      break;
    case "key":
      context.dispatchPointer({ type: "transform/key", key: act.key });
      break;
    case "free":
      context.dispatchPointer({ type: "transform/free", free: true });
      break;
    case "confirm":
      context.dispatchPointer({ type: "transform/confirm" });
      break;
    case "cancel":
      context.cancelPointer();
      break;
    default:
      break;
  }
}

/** What one kind of intent does, given the intent of that kind. */
type IntentApplier<K extends CanvasIntent["type"]> = (
  context: CanvasKeyboardContext,
  intent: Extract<CanvasIntent, { type: K }>,
) => void;

/**
 * One intent, one effect: a table typed over every kind of {@link CanvasIntent},
 * so a new intent with no effect, or an effect for none, is a type error.
 */
const INTENT_APPLIERS: { readonly [K in CanvasIntent["type"]]: IntentApplier<K> } = {
  undo: (context) => {
    context.cancelPointer();
    context.undoCanvasDoc();
  },
  redo: (context) => {
    context.cancelPointer();
    context.redoCanvasDoc();
  },
  delete: deleteSelection,
  selectAll: (context) => context.setSelection(selectAll(context.docRef.current, context.scope)),
  copy: copySelection,
  paste: (context) =>
    void navigator.clipboard.readText().then((text) => pasteCanvas(text, context)),
  duplicate: duplicateSelection,
  escape: escapeCanvas,
  panModifier: (context) => context.setSpaceDown(true),
  nudge: (context, intent) => nudgeSelection(context, intent.dx, intent.dy),
  tool: (context, intent) => chooseTool(context, intent.tool),
  zoomBy: (context, intent) => context.viewport.zoomBy(intent.factor),
  zoomTo: (context, intent) => context.viewport.zoomTo(intent.zoom),
  frame: (context, intent) => frameItems(context, intent.scope),
  look: (context, intent) => context.viewport.look(intent.preset),
  toggleLens: (context) => context.viewport.toggleLens(),
  projection: (context, intent) => context.chooseProjection(intent.kind),
  viewMenu: (context) => context.openViewMenu(),
  transform: (context, intent) => applyTransformAct(context, intent.act),
  group: groupSelection,
  ungroup: ungroupSelection,
  viewpoint: (context, intent) => {
    const frame = context.byId.get(intent.id);
    if (frame !== undefined) context.viewport.faceOn(frame);
  },
  present: (context, intent) => context.present(intent.act),
};

/** Apply `intent` through the applier its kind names. */
function applyCanvasIntent<K extends CanvasIntent["type"]>(
  context: CanvasKeyboardContext,
  intent: Extract<CanvasIntent, { type: K }>,
): void {
  const apply: IntentApplier<K> = INTENT_APPLIERS[intent.type];
  apply(context, intent);
}

/** Listen for the canvas's chords; the applier comes back for the view menu's commands. */
export function useCanvasKeyboard(context: CanvasKeyboardContext): (intent: CanvasIntent) => void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      const binding = mapCanvasKey(event, {
        selectionEmpty: selectionEmpty(context.selRef.current),
        transforming: context.transforming(),
        presenting: context.presenting(),
      });
      if (binding === null) return;
      if (binding.intent !== null) applyCanvasIntent(context, binding.intent);
      if (binding.preventDefault) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") context.setSpaceDown(false);
      // ⌘ or Ctrl let go mid-transform: snapping is back (its keydown is the keymap's).
      if ((event.key === "Meta" || event.key === "Control") && context.transforming()) {
        context.dispatchPointer({ type: "transform/free", free: false });
      }
    };
    const onBlur = () => {
      context.setSpaceDown(false);
      context.cancelPointer();
    };
    // A modal transform is the canvas's keyboard: once focus goes anywhere — a
    // palette, a field, a button — its keys no longer reach it, so it cancels,
    // as leaving the window does.
    const onFocusIn = () => {
      if (context.transforming()) context.cancelPointer();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [context]);
  return (intent) => applyCanvasIntent(context, intent);
}
