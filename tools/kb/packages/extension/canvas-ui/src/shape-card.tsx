import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CANVAS_SHAPES, canvasDepth, type CanvasShapeNode, type CanvasVolume } from "@kb/canvas";
import { classifyCardPointer } from "./card-pointer";
import type { FaceLayout } from "./canvas-face";
import { hasText, textOr } from "@kb/ui-sdk";
import { ItemOutline } from "./canvas-item-outline";
import { outlinePath, wordsInk, wordsStyle } from "./canvas-dom-paint";
import { itemPaint } from "./canvas-style";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";
import {
  cancelLabelEdit,
  commitLabelEdit,
  startLabelEdit,
  typeLabelDraft,
  type LabelEditState,
} from "./shape-label-edit";

interface ShapeCardProps extends FaceLayout {
  card: CanvasShapeNode;
  selected: boolean;
  onSelect: (anchor: { x: number; y: number }) => void;
  onLabelChange: (label: string) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

/**
 * How a solid's top view marks what fills it, by volume: a prism's top is
 * flat, so nothing; an ellipsoid's top is a dome, lit from the upper left;
 * a cone's rises to a point over its centre.
 */
const TOP_VIEW_MARKS: { readonly [V in CanvasVolume]: (id: string) => React.ReactNode } = {
  prism: () => null,
  // Light and shade are amounts of white and black, the same in every theme.
  ellipsoid: (id) => (
    <radialGradient id={id} cx="38%" cy="32%" r="75%">
      <stop offset="0%" stopColor="rgb(255 255 255)" stopOpacity={0.45} />
      <stop offset="50%" stopColor="rgb(255 255 255)" stopOpacity={0} />
      <stop offset="100%" stopColor="rgb(0 0 0)" stopOpacity={0.22} />
    </radialGradient>
  ),
  cone: (id) => (
    <radialGradient id={id} cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="rgb(255 255 255)" stopOpacity={0.4} />
      <stop offset="4%" stopColor="rgb(255 255 255)" stopOpacity={0.2} />
      <stop offset="100%" stopColor="rgb(0 0 0)" stopOpacity={0.16} />
    </radialGradient>
  ),
};

/**
 * A shape's top view: its outline as its look draws it (`ItemOutline`),
 * with a solid's top-view mark. Drawn only; the footprint the pointer hits
 * is {@link ShapeCard}'s clipped layer.
 */
function ShapeChrome({
  card,
  d,
  selected,
}: {
  card: CanvasShapeNode;
  d: string;
  selected: boolean;
}) {
  const markId = useId();
  const mark =
    canvasDepth(card) > 0 ? TOP_VIEW_MARKS[CANVAS_SHAPES[card.shape].volume](markId) : null;
  return (
    <ItemOutline item={card} paint={itemPaint(card)} selected={selected} ink={18}>
      {mark !== null && <defs>{mark}</defs>}
      {mark !== null && <path d={d} fill={`url(#${markId})`} />}
    </ItemOutline>
  );
}

/**
 * A shape item in 2D: its top view, and its footprint as what the pointer
 * hits — the outline as a clip path, so the corners of an ellipse's or a
 * sphere's box are open canvas, exactly as the camera model's `hitTest`
 * says.
 */
/**
 * The label's editor: a draft the page opens and closes (`editing`), which
 * starts from the label each time it opens; Enter or a blur commits it,
 * Escape drops it, and either tells the page it closed.
 */
function useLabelEditor(
  label: string,
  editing: boolean,
  onEdit: (editing: boolean) => void,
  onLabelChange: (label: string) => void,
  inputRef: React.RefObject<HTMLInputElement | null>,
) {
  const [edit, setEdit] = useState<LabelEditState>(() =>
    editing ? startLabelEdit(label) : cancelLabelEdit(startLabelEdit(label)),
  );
  const [opened, setOpened] = useState(editing);
  if (opened !== editing) {
    setOpened(editing);
    setEdit(editing ? startLabelEdit(label) : cancelLabelEdit(edit));
  }
  const editRef = useRef(edit);
  editRef.current = edit;
  /** Guards blur after Enter commit / Escape cancel (input unmount). */
  const endEditRef = useRef<"idle" | "committing" | "canceling">("idle");

  useEffect(() => {
    if (!editing) return;
    endEditRef.current = "idle";
    inputRef.current?.focus();
  }, [editing, inputRef]);

  const commit = useCallback(() => {
    if (endEditRef.current !== "idle") {
      setEdit((s) => ({ ...s, editing: false }));
      return;
    }
    endEditRef.current = "committing";
    const result = commitLabelEdit(editRef.current);
    setEdit(result.state);
    if (result.persist !== null) onLabelChange(result.persist);
    onEdit(false);
  }, [onLabelChange, onEdit]);

  const cancel = useCallback(() => {
    if (endEditRef.current !== "idle") return;
    endEditRef.current = "canceling";
    setEdit(cancelLabelEdit(editRef.current));
    onEdit(false);
  }, [onEdit]);

  const type = (draft: string) => setEdit((s) => typeLabelDraft(s, draft));
  return { open: editing && edit.editing, draft: edit.draft, type, commit, cancel };
}

export function ShapeCard({
  card,
  box,
  editing,
  onEdit,
  selected,
  onSelect,
  onLabelChange,
  onMoveStart,
  onResizeStart,
  onRotateStart,
  onPortDown,
}: ShapeCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const editor = useLabelEditor(card.label ?? "", editing, onEdit, onLabelChange, inputRef);
  const d = outlinePath(card);
  const paint = itemPaint(card);
  return (
    // The box is only a frame: the footprint inside it is what the pointer hits.
    <div
      className="group/card pointer-events-none absolute"
      style={box}
      onPointerDown={(e) => {
        const intent = classifyCardPointer(e.target, "input");
        if (intent === "chrome") return;
        if (intent === "edit") {
          onSelect({ x: e.clientX, y: e.clientY });
          return;
        }
        e.stopPropagation();
        onSelect({ x: e.clientX, y: e.clientY });
        onMoveStart(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect({ x: e.clientX, y: e.clientY });
        onEdit(true);
      }}
    >
      <ShapeChrome card={card} d={d} selected={selected} />
      <div
        data-footprint
        data-words
        className="pointer-events-auto absolute inset-0 px-4 py-2"
        style={{ clipPath: `path("${d}")`, ...wordsStyle(paint.words, true) }}
      >
        {editor.open ? (
          <input
            ref={inputRef}
            data-testid="shape-label-input"
            className="w-full truncate bg-transparent outline-none"
            style={{ ...wordsStyle(paint.words), color: wordsInk(paint, 85) }}
            value={editor.draft}
            onChange={(e) => editor.type(e.target.value)}
            onBlur={editor.commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor.commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                editor.cancel();
              }
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="max-w-full truncate"
            style={{ color: wordsInk(paint, hasText(card.label) ? 85 : 25) }}
          >
            {textOr(card.label, "Label")}
          </span>
        )}
      </div>
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles
        selected={selected}
        onResizeStart={onResizeStart}
        onRotateStart={onRotateStart}
      />
    </div>
  );
}
