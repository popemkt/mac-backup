import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasEdge, CanvasNode, CanvasProjectionKind } from "@kb/canvas";
import { parseCanvasDoc, upsertCanvasEdge, upsertCanvasNode } from "@kb/canvas";
import {
  type CanvasSelection,
  EMPTY_SELECTION,
  deleteSelected,
  selectAll,
  selectionEmpty,
} from "@/lib/canvas-selection";
import { mapCanvasKey, type CanvasIntent } from "@/lib/canvas-keymap";
import { reduceCanvasTool, type CanvasTool, type ToolState } from "@/lib/canvas-tool";
import type { CanvasViewportControls } from "@/lib/canvas-camera";
import { isTextEntry } from "@/lib/dom";

/**
 * The canvas keyboard surface: `lib/canvas-keymap` decides *what* a chord
 * means, this file decides *how* that intent reaches the document, the
 * selection and the viewport. The listener itself is plumbing between the two,
 * and the view menu sends its commands through the same applier.
 */
interface CanvasKeyboardContext {
  cancelPointer: () => void;
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

function copySelection(context: CanvasKeyboardContext) {
  const selection = context.selRef.current;
  const copied: CanvasDoc = {
    nodes: context.docRef.current.nodes.filter((node) => selection.nodeIds.has(node.id)),
    edges: context.docRef.current.edges.filter(
      (edge) =>
        selection.edgeIds.has(edge.id) ||
        (selection.nodeIds.has(edge.fromNode) && selection.nodeIds.has(edge.toNode)),
    ),
  };
  void navigator.clipboard.writeText(JSON.stringify(copied));
}

function pasteCanvas(text: string, context: CanvasKeyboardContext) {
  try {
    const parsed = parseCanvasDoc(text);
    const idMap = new Map<string, string>();
    const newNodes: CanvasNode[] = parsed.nodes.map((node) => {
      const id = ulid();
      idMap.set(node.id, id);
      return { ...node, id, x: node.x + CLONE_OFFSET, y: node.y + CLONE_OFFSET };
    });
    const newEdges: CanvasEdge[] = parsed.edges.flatMap((edge) => {
      const fromNode = idMap.get(edge.fromNode);
      const toNode = idMap.get(edge.toNode);
      return fromNode === undefined || toNode === undefined
        ? []
        : [{ ...edge, id: ulid(), fromNode, toNode }];
    });
    let nextDoc = context.docRef.current;
    for (const node of newNodes) nextDoc = upsertCanvasNode(nextDoc, node);
    for (const edge of newEdges) nextDoc = upsertCanvasEdge(nextDoc, edge);
    context.schedulePersist(nextDoc);
    context.setSelection({
      nodeIds: new Set(newNodes.map((node) => node.id)),
      edgeIds: new Set(newEdges.map((edge) => edge.id)),
    });
  } catch {
    // Clipboard content is not a canvas document.
  }
}

function duplicateSelection(context: CanvasKeyboardContext) {
  const selection = context.selRef.current;
  const idMap = new Map<string, string>();
  let nextDoc = context.docRef.current;
  for (const nodeId of selection.nodeIds) {
    const node = context.byId.get(nodeId);
    if (!node) continue;
    const id = ulid();
    idMap.set(nodeId, id);
    nextDoc = upsertCanvasNode(nextDoc, {
      ...node,
      id,
      x: node.x + CLONE_OFFSET,
      y: node.y + CLONE_OFFSET,
    });
  }
  for (const edge of context.docRef.current.edges) {
    if (selection.nodeIds.has(edge.fromNode) && selection.nodeIds.has(edge.toNode)) {
      nextDoc = upsertCanvasEdge(nextDoc, {
        ...edge,
        id: ulid(),
        fromNode: idMap.get(edge.fromNode) ?? edge.fromNode,
        toNode: idMap.get(edge.toNode) ?? edge.toNode,
      });
    }
  }
  context.schedulePersist(nextDoc);
  context.setSelection({ nodeIds: new Set(idMap.values()), edgeIds: new Set() });
}

function escapeCanvas(context: CanvasKeyboardContext) {
  context.cancelPointer();
  context.setToolState((state) => reduceCanvasTool(state, { type: "escape" }));
  context.setSelection(EMPTY_SELECTION);
  context.setInspectorAnchor(null);
  context.setItemInspectorAnchor(null);
}

function nudgeSelection(context: CanvasKeyboardContext, dx: number, dy: number) {
  let nextDoc = context.docRef.current;
  for (const nodeId of context.selRef.current.nodeIds) {
    const node = context.byId.get(nodeId);
    if (node) {
      nextDoc = upsertCanvasNode(nextDoc, { ...node, x: node.x + dx, y: node.y + dy });
    }
  }
  context.schedulePersist(nextDoc);
}

function chooseTool(context: CanvasKeyboardContext, tool: CanvasTool) {
  if (tool === "kb-node") {
    context.setToolState({ tool: "select" });
    context.setPickerOpen(true);
    return;
  }
  context.setToolState((state) => reduceCanvasTool(state, { type: "set-tool", tool }));
}

/** One intent, one effect. Exhaustive over {@link CanvasIntent}. */
function applyCanvasIntent(context: CanvasKeyboardContext, intent: CanvasIntent): void {
  switch (intent.type) {
    case "undo":
      context.cancelPointer();
      context.undoCanvasDoc();
      break;
    case "redo":
      context.cancelPointer();
      context.redoCanvasDoc();
      break;
    case "delete":
      deleteSelection(context);
      break;
    case "selectAll":
      context.setSelection(selectAll(context.docRef.current));
      break;
    case "copy":
      copySelection(context);
      break;
    case "paste":
      void navigator.clipboard.readText().then((text) => pasteCanvas(text, context));
      break;
    case "duplicate":
      duplicateSelection(context);
      break;
    case "escape":
      escapeCanvas(context);
      break;
    case "panModifier":
      context.setSpaceDown(true);
      break;
    case "nudge":
      nudgeSelection(context, intent.dx, intent.dy);
      break;
    case "tool":
      chooseTool(context, intent.tool);
      break;
    case "zoomBy":
      context.viewport.zoomBy(intent.factor);
      break;
    case "zoomTo":
      context.viewport.zoomTo(intent.zoom);
      break;
    case "frame": {
      const { nodes } = context.docRef.current;
      const chosen = context.selRef.current.nodeIds;
      context.viewport.frame(
        intent.scope === "all" ? nodes : nodes.filter((node) => chosen.has(node.id)),
      );
      break;
    }
    case "look":
      context.viewport.look(intent.preset);
      break;
    case "toggleLens":
      context.viewport.toggleLens();
      break;
    case "projection":
      context.chooseProjection(intent.kind);
      break;
    case "viewMenu":
      context.openViewMenu();
      break;
    default:
      // `switch-exhaustiveness-check` turns a new intent without a case red.
      break;
  }
}

/** Listen for the canvas's chords; the applier comes back for the view menu's commands. */
export function useCanvasKeyboard(context: CanvasKeyboardContext): (intent: CanvasIntent) => void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      const binding = mapCanvasKey(event, {
        selectionEmpty: selectionEmpty(context.selRef.current),
      });
      if (binding === null) return;
      if (binding.intent !== null) applyCanvasIntent(context, binding.intent);
      if (binding.preventDefault) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") context.setSpaceDown(false);
    };
    const onBlur = () => {
      context.setSpaceDown(false);
      context.cancelPointer();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [context]);
  return (intent) => applyCanvasIntent(context, intent);
}
