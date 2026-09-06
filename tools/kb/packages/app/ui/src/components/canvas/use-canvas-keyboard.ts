import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasEdge, CanvasNode } from "@kb/canvas";
import { parseCanvasDoc, upsertCanvasEdge, upsertCanvasNode } from "@kb/canvas";
import {
  type CanvasSelection,
  EMPTY_SELECTION,
  deleteSelected,
  selectAll,
  selectionEmpty,
} from "@/lib/canvas-selection";
import { reduceCanvasTool, type CanvasTool, type ToolState } from "@/lib/canvas-tool";
import { isTextEntry } from "@/lib/dom";

interface CanvasKeyboardContext {
  byId: Map<string, CanvasNode>;
  docRef: RefObject<CanvasDoc>;
  selRef: RefObject<CanvasSelection>;
  schedulePersist: (doc: CanvasDoc) => void;
  schedulePersistSilent: (doc: CanvasDoc) => void;
  undoCanvasDoc: () => void;
  redoCanvasDoc: () => void;
  zoomToFit: () => void;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setShapeInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setSpaceDown: Dispatch<SetStateAction<boolean>>;
  setToolState: Dispatch<SetStateAction<ToolState>>;
  setZoom: Dispatch<SetStateAction<number>>;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
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

const commandKey = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;

function handleHistory(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (!commandKey(event)) return false;
  if (event.key === "z" && !event.shiftKey) {
    event.preventDefault();
    context.undoCanvasDoc();
    return true;
  }
  if (event.key === "Z" || (event.key === "z" && event.shiftKey)) {
    event.preventDefault();
    context.redoCanvasDoc();
    return true;
  }
  if (event.key === "y") {
    event.preventDefault();
    context.redoCanvasDoc();
    return true;
  }
  return false;
}

function handleSelection(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    const selection = context.selRef.current;
    if (selectionEmpty(selection)) return true;
    context.schedulePersist(deleteSelected(context.docRef.current, selection));
    context.setSelection(EMPTY_SELECTION);
    context.setInspectorAnchor(null);
    context.setShapeInspectorAnchor(null);
    return true;
  }
  if (commandKey(event) && event.key === "a") {
    event.preventDefault();
    context.setSelection(selectAll(context.docRef.current));
    return true;
  }
  return false;
}

function handleClipboard(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (!commandKey(event)) return false;
  if (event.key === "c") {
    event.preventDefault();
    const selection = context.selRef.current;
    if (selectionEmpty(selection)) return true;
    const copied: CanvasDoc = {
      nodes: context.docRef.current.nodes.filter((node) => selection.nodeIds.has(node.id)),
      edges: context.docRef.current.edges.filter(
        (edge) =>
          selection.edgeIds.has(edge.id) ||
          (selection.nodeIds.has(edge.fromNode) && selection.nodeIds.has(edge.toNode)),
      ),
    };
    void navigator.clipboard.writeText(JSON.stringify(copied));
    return true;
  }
  if (event.key !== "v") return false;
  event.preventDefault();
  void navigator.clipboard.readText().then((text) => pasteCanvas(text, context));
  return true;
}

function pasteCanvas(text: string, context: CanvasKeyboardContext) {
  try {
    const parsed = parseCanvasDoc(text);
    const idMap = new Map<string, string>();
    const newNodes: CanvasNode[] = parsed.nodes.map((node) => {
      const id = ulid();
      idMap.set(node.id, id);
      return { ...node, id, x: node.x + 24, y: node.y + 24 };
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

function handleDuplicate(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (!commandKey(event) || event.key !== "d") return false;
  event.preventDefault();
  const selection = context.selRef.current;
  if (selectionEmpty(selection)) return true;
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
      x: node.x + 24,
      y: node.y + 24,
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
  return true;
}

function handleCanvasState(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (event.key === "Escape") {
    context.setToolState((state) => reduceCanvasTool(state, { type: "escape" }));
    context.setSelection(EMPTY_SELECTION);
    context.setInspectorAnchor(null);
    context.setShapeInspectorAnchor(null);
    return true;
  }
  if (event.code === "Space") {
    context.setSpaceDown(true);
    event.preventDefault();
    return true;
  }
  return false;
}

function handleNudge(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (!event.key.startsWith("Arrow")) return false;
  const selection = context.selRef.current;
  if (selectionEmpty(selection)) return true;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
  let nextDoc = context.docRef.current;
  for (const nodeId of selection.nodeIds) {
    const node = context.byId.get(nodeId);
    if (node) {
      nextDoc = upsertCanvasNode(nextDoc, { ...node, x: node.x + dx, y: node.y + dy });
    }
  }
  context.schedulePersistSilent(nextDoc);
  return true;
}

function handleTool(event: KeyboardEvent, context: CanvasKeyboardContext) {
  const tool = TOOL_KEYS[event.key.toLowerCase()];
  if (!tool) return false;
  event.preventDefault();
  if (tool === "kb-node") {
    context.setToolState({ tool: "select" });
    context.setPickerOpen(true);
  } else {
    context.setToolState((state) => reduceCanvasTool(state, { type: "set-tool", tool }));
  }
  return true;
}

function handleZoom(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (commandKey(event) && (event.key === "=" || event.key === "+")) {
    event.preventDefault();
    context.setZoom((zoom) => Math.min(MAX_ZOOM, zoom * 1.15));
    return true;
  }
  if (commandKey(event) && event.key === "-") {
    event.preventDefault();
    context.setZoom((zoom) => Math.max(MIN_ZOOM, zoom / 1.15));
    return true;
  }
  if (commandKey(event) && event.key === "0") {
    event.preventDefault();
    context.setZoom(1);
    return true;
  }
  if (event.shiftKey && event.key === "!") {
    event.preventDefault();
    context.zoomToFit();
    return true;
  }
  return false;
}

function handleKeyDown(event: KeyboardEvent, context: CanvasKeyboardContext) {
  if (handleHistory(event, context)) return;
  if (isTextEntry(event.target)) return;
  if (handleSelection(event, context)) return;
  if (handleClipboard(event, context)) return;
  if (handleDuplicate(event, context)) return;
  if (handleCanvasState(event, context)) return;
  if (handleNudge(event, context)) return;
  if (handleTool(event, context)) return;
  handleZoom(event, context);
}

export function useCanvasKeyboard(context: CanvasKeyboardContext) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event, context);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") context.setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [context]);
}
