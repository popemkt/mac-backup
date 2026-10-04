/**
 * Editing a face in 3D (plan 2026-10-02, decision 14): the item's own DOM
 * face — the text card's textarea, the shape's label field, the card's node
 * text — laid over the 3D canvas exactly on the plane its face is drawn on
 * (`faceFrameOf`, `faceTransform`), kept there through every move of the
 * camera, so a turned or tipped card is edited where it is. The page flies
 * the camera face-on first (`visit`), and back when the editor closes.
 */
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import type { CanvasNode } from "@kb/canvas";
import type { ViewSize } from "./canvas-camera";
import { faceFrameOf } from "./canvas-faces";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { CanvasCardFace } from "./canvas-card-layer";
import { faceTransform } from "./canvas-face-overlay";
import { EMPTY_SELECTION } from "./canvas-selection";

interface CanvasFaceEditorProps {
  /** The item being edited in 3D, or null for none. */
  readonly item: CanvasNode | null;
  readonly rig: CanvasCameraRig;
  /** The 3D canvas's size, which the face is projected onto. */
  readonly size: () => ViewSize;
  /** Its editor opened or closed. */
  readonly onEdit: (id: string, editing: boolean) => void;
  /** What its editor wrote, through the page's one write path. */
  readonly onChange: (item: CanvasNode) => void;
}

const noop = () => {};

export function CanvasFaceEditor({ item, ...rest }: CanvasFaceEditorProps) {
  return item === null ? null : <LaidFaceEditor item={item} {...rest} />;
}

function LaidFaceEditor({
  item,
  rig,
  size,
  onEdit,
  onChange,
}: CanvasFaceEditorProps & { readonly item: CanvasNode }) {
  const laid = useRef<HTMLDivElement>(null);
  /**
   * Lay the face where the camera draws it now. While it is seen from behind
   * or edge-on it is not shown and takes no pointer, but keeps its focus: it
   * is transparent, not hidden (a hidden field drops its focus, which would
   * close the editor mid-orbit).
   */
  const place = useEffectEvent((on: CanvasNode) => {
    const el = laid.current;
    if (el === null) return;
    const transform = faceTransform(faceFrameOf(on, on.z ?? 0, rig.view), rig.view, size());
    el.style.transform = transform ?? "";
    el.style.opacity = transform === null ? "0" : "";
    el.style.pointerEvents = transform === null ? "none" : "";
  });
  useLayoutEffect(() => place(item), [item]);
  useEffect(() => rig.subscribe(() => place(item)), [rig, item]);
  // The canvas resized: the same view projects elsewhere.
  useEffect(() => {
    const replace = () => place(item);
    window.addEventListener("resize", replace);
    return () => window.removeEventListener("resize", replace);
  }, [item]);
  return (
    <div data-face-editor className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={laid}
        className="pointer-events-auto absolute top-0 left-0 origin-top-left [&_[data-port]]:hidden"
        style={{ width: item.width, height: item.height }}
      >
        <CanvasCardFace
          card={item}
          box={{ left: 0, top: 0, width: item.width, height: item.height }}
          editing
          onEdit={(on) => onEdit(item.id, on)}
          selection={EMPTY_SELECTION}
          onCardSelect={noop}
          onCardChange={onChange}
          onResizeStart={noop}
          onRotateStart={noop}
          onPortDown={noop}
          onCardPointerDown={noop}
        />
      </div>
    </div>
  );
}
