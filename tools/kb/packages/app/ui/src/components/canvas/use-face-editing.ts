import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode } from "@kb/canvas";
import { faceOnView, type ViewSize } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { hasEditor } from "./canvas-face-overlay";

interface FaceEditingContext {
  readonly byId: ReadonlyMap<string, CanvasNode>;
  /** The 3D projection is showing. */
  readonly in3d: boolean;
  /** The 3D camera, which flies to a face being edited and back. */
  readonly rig: CanvasCameraRig;
  /** The 3D canvas's size. */
  readonly size: () => ViewSize;
  /** The camera came to rest back where it was. */
  readonly settled: () => void;
  /** Select one item. */
  readonly select: (id: string) => void;
  /** A double-click's step into the group on the way to an item; whether it went. */
  readonly enter: (item: CanvasNode) => boolean;
}

/**
 * Which item's editor is open: one page state for both projections, which
 * the projection that is showing edits — the 2D canvas in place, the 3D one
 * through a face editor laid on the face (`CanvasFaceEditor`), after looking
 * at it face-on, and looking back again when the editor closes.
 */
export function useFaceEditing(context: FaceEditingContext) {
  const { byId, in3d, rig, size, settled, select, enter } = context;
  const [editing, setEditing] = useState<string | null>(null);
  /** An item's editor opened, or closed (and any other item's stays as it is). */
  const onEdit = useCallback((id: string, on: boolean) => {
    setEditing((current) => (on ? id : current === id ? null : current));
  }, []);
  const item = editing === null ? undefined : byId.get(editing);
  /** How to come back from looking at the face being edited. */
  const comeBack = useRef<(() => void) | null>(null);
  // The editor closed (or its item went): the camera comes back from the face.
  useEffect(() => {
    if (item !== undefined) return;
    const back = comeBack.current;
    comeBack.current = null;
    back?.();
  }, [item]);
  return {
    onEdit,
    /** What the 2D canvas edits: nothing while 3D is showing. */
    flat: in3d ? null : editing,
    /** What the 3D canvas edits, laid on its face: an item with an editor, while 3D is showing. */
    deep: in3d && item !== undefined && hasEditor(item) ? item : null,
    /**
     * A double-click on an item in 3D: into the group on the way to it, or
     * else, for an item with an editor, select it, open its editor and look
     * at its face face-on. Whether it did either.
     */
    doubleClick: (card: CanvasNode): boolean => {
      if (enter(card)) return true;
      if (!hasEditor(card)) return false;
      select(card.id);
      onEdit(card.id, true);
      comeBack.current?.();
      // Face-on, through the camera model: a face that stands is only framed (`faceOnView`).
      const goal = faceOnView(card, size(), rig.view);
      comeBack.current = goal === null ? null : rig.visit(goal, settled);
      return true;
    },
  };
}
