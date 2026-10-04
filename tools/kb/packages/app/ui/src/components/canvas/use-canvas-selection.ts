import { useRef, useState } from "react";
import {
  isShapeNode,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasMembership,
  type CanvasNode,
} from "@kb/canvas";
import {
  type CanvasScope,
  type CanvasSelection,
  EMPTY_SELECTION,
  enterToward,
  pickIn,
  scopeIn,
  selectEdge,
  selectNode,
  toggleEdge,
  toggleNode,
} from "./canvas-selection";

/** The modifiers a card press carries; a DOM pointer event is one. */
type CardPress = Pick<PointerEvent, "shiftKey" | "metaKey" | "ctrlKey">;

/**
 * The moves in and out of groups, read against the scope: `select` sets a
 * selection with the inspectors closed.
 */
function scopeMoves(
  membership: CanvasMembership,
  scope: CanvasScope,
  setScope: (scope: CanvasScope) => void,
  select: (selection: CanvasSelection) => void,
) {
  return {
    /**
     * A press on `card` that its own editor may take: whether it reaches the
     * card itself in the scope, not a group it belongs to. When it does,
     * the scope steps out as the press does (`pickIn`).
     */
    pressReaches: (card: CanvasNode): boolean => {
      const picked = pickIn(membership, card.id, scope);
      if (picked.id !== card.id) return false;
      setScope(picked.scope);
      return true;
    },
    /**
     * A double-click on `card`: into the group on the way to it, one level
     * deeper (`enterToward`). False when it is the card's own (its editor's).
     */
    enter: (card: CanvasNode): boolean => {
      const into = enterToward(membership, card.id, scope);
      if (into === null) return false;
      setScope(into.scope);
      select(into.id === null ? EMPTY_SELECTION : selectNode(into.id));
      return true;
    },
    /** Esc out of the group entered, which is selected; false at the canvas. */
    leave: (): boolean => {
      if (scope === null) return false;
      setScope(membership.parentOf(scope));
      select(selectNode(scope));
      return true;
    },
  };
}

export function useCanvasSelection(
  doc: CanvasDoc,
  byId: Map<string, CanvasNode>,
  membership: CanvasMembership,
) {
  const [selection, setSelection] = useState<CanvasSelection>(EMPTY_SELECTION);
  /** The group entered, as last set; one that has since gone is the canvas (`scopeIn`). */
  const [enteredScope, setScope] = useState<CanvasScope>(null);
  const scope = scopeIn(membership, enteredScope);
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
   * A press on a card, in whichever projection drew it. It reaches the item
   * a press there selects in the scope (`pickIn`): a member of a group not
   * entered stands for its group, and a press outside the scope steps out
   * of it. A modifier toggles that item in the selection; a plain press
   * selects it and starts moving it (`startMove`, with the item's id). A
   * shape newly selected opens its inspector at `anchor`, where it was
   * pressed; any item's inspector opens from the selection toolbar.
   */
  const onCardPointerDown = (
    card: CanvasNode,
    press: CardPress,
    anchor: { x: number; y: number } | undefined,
    startMove: (id: string) => void,
  ) => {
    const picked = pickIn(membership, card.id, scope);
    setScope(picked.scope);
    const item = byId.get(picked.id) ?? card;
    const isSelected = selection.nodeIds.has(item.id);
    if (press.shiftKey || press.metaKey || press.ctrlKey) {
      setSelection(toggleNode(selection, item.id));
      setInspectorAnchor(null);
      setItemInspectorAnchor(null);
      return;
    }
    if (!isSelected) {
      setSelection(selectNode(item.id));
      setInspectorAnchor(null);
      setItemInspectorAnchor(isShapeNode(item) && item === card ? (anchor ?? null) : null);
    }
    startMove(item.id);
  };

  const { pressReaches, enter, leave } = scopeMoves(membership, scope, setScope, (next) => {
    setSelection(next);
    setInspectorAnchor(null);
    setItemInspectorAnchor(null);
  });

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
    enter,
    inspectorAnchor,
    leave,
    onCardPointerDown,
    onEdgeClick,
    pressReaches,
    scope,
    selectedEdge,
    selectedItem,
    selection,
    selectionRef,
    setInspectorAnchor,
    setScope,
    setSelection,
    setItemInspectorAnchor,
    itemInspectorAnchor,
  };
}
