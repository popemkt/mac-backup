import { useRef, useState } from "react";
import { isShapeNode, type CanvasDoc, type CanvasEdge, type CanvasNode } from "@kb/canvas";
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
  const [itemInspectorAnchor, setItemInspectorAnchor] = useState<{
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
  const selectedItemId = selection.nodeIds.size === 1 ? ([...selection.nodeIds][0] ?? null) : null;
  const selectedItem = selectedItemId === null ? null : (byId.get(selectedItemId) ?? null);

  /**
   * A press on a card, in whichever projection drew it: a modifier toggles
   * it in the selection, a plain press selects it and starts moving it. A
   * shape newly selected opens its inspector at `anchor`, where it was
   * pressed; any item's inspector opens from the selection toolbar.
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
      setItemInspectorAnchor(null);
      return;
    }
    if (!isSelected) {
      setSelection(selectNode(card.id));
      setInspectorAnchor(null);
      setItemInspectorAnchor(isShapeNode(card) ? (anchor ?? null) : null);
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
    setItemInspectorAnchor(null);
  };

  return {
    inspectorAnchor,
    onCardPointerDown,
    onEdgeClick,
    selectedEdge,
    selectedItem,
    selection,
    selectionRef,
    setInspectorAnchor,
    setSelection,
    setItemInspectorAnchor,
    itemInspectorAnchor,
  };
}
