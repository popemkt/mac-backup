import { useRef, useState } from "react";
import type { CanvasDoc, CanvasEdge, CanvasNode } from "@kb/canvas";
import { isShapeNode } from "@kb/canvas";
import {
  type CanvasSelection,
  EMPTY_SELECTION,
  selectEdge,
  selectNode,
  toggleEdge,
  toggleNode,
} from "@/lib/canvas-selection";

/** The modifiers a card press carries; a DOM pointer event is one. */
type CardPress = Pick<PointerEvent, "shiftKey" | "metaKey" | "ctrlKey">;

export function useCanvasSelection(doc: CanvasDoc, byId: Map<string, CanvasNode>) {
  const [selection, setSelection] = useState<CanvasSelection>(EMPTY_SELECTION);
  const [inspectorAnchor, setInspectorAnchor] = useState<{ x: number; y: number } | null>(null);
  const [shapeInspectorAnchor, setShapeInspectorAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const selectedEdgeId = selection.edgeIds.size === 1 ? [...selection.edgeIds][0] : null;
  const selectedEdge =
    selectedEdgeId !== undefined
      ? (doc.edges.find((edge) => edge.id === selectedEdgeId) ?? null)
      : null;
  const selectedShapeId = selection.nodeIds.size === 1 ? ([...selection.nodeIds][0] ?? null) : null;
  const selectedShape =
    selectedShapeId === null
      ? null
      : (() => {
          const node = byId.get(selectedShapeId);
          return node && isShapeNode(node) ? node : null;
        })();

  /**
   * A press on a card, in whichever projection drew it: a modifier toggles
   * it in the selection, a plain press selects it and starts moving it.
   */
  const onCardPointerDown = (
    card: CanvasNode,
    press: CardPress,
    anchor: { x: number; y: number } | undefined,
    startMove: () => void,
  ) => {
    const isSelected = selection.nodeIds.has(card.id);
    if (press.shiftKey || press.metaKey || press.ctrlKey) {
      setSelection(toggleNode(selection, card.id));
      setInspectorAnchor(null);
      setShapeInspectorAnchor(null);
      return;
    }
    if (!isSelected) {
      setSelection(selectNode(card.id));
      setInspectorAnchor(null);
      setShapeInspectorAnchor(anchor ?? null);
    }
    startMove();
  };

  const onEdgeClick = (edge: CanvasEdge, event: React.MouseEvent) => {
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setSelection(toggleEdge(selection, edge.id));
    } else {
      setSelection(selectEdge(edge.id));
    }
    setInspectorAnchor({ x: event.clientX, y: event.clientY });
    setShapeInspectorAnchor(null);
  };

  return {
    inspectorAnchor,
    onCardPointerDown,
    onEdgeClick,
    selectedEdge,
    selectedShape,
    selection,
    selectionRef,
    setInspectorAnchor,
    setSelection,
    setShapeInspectorAnchor,
    shapeInspectorAnchor,
  };
}
