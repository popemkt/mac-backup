import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CANVAS_SHAPES,
  canvasDepth,
  shapeOutline,
  svgPathData,
  type CanvasShapeNode,
  type CanvasVolume,
} from "@kb/canvas";
import { resolveCanvasColor } from "./canvas-color";
import { classifyCardPointer } from "./card-pointer";
import { cardBoxStyle } from "./canvas-card-box";
import { cn, hasText, textOr } from "@/sdk";
import { cornerRadius, readCornerRadii } from "./canvas-card-face";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";
import {
  cancelLabelEdit,
  commitLabelEdit,
  startLabelEdit,
  typeLabelDraft,
  type LabelEditState,
} from "./shape-label-edit";

interface ShapeCardProps {
  card: CanvasShapeNode;
  selected: boolean;
  onSelect: (anchor: { x: number; y: number }) => void;
  onLabelChange: (label: string) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
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
 * A shape's top view: its outline, traced from the shape table
 * (`shapeOutline`) as the 3D faces and meshes trace it, filled with its
 * preset tint and stroked in its colour (a selected shape in the primary over
 * a soft halo), with a solid's top-view mark. Drawn only; the footprint the
 * pointer hits is {@link ShapeCard}'s clipped layer.
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
  const color = resolveCanvasColor(card.color);
  const stroke = color ?? "color-mix(in oklab, var(--foreground) 18%, transparent)";
  // Opaque, as the 3D face is: what stands on a shape covers it.
  const fill = `color-mix(in oklab, ${color ?? "var(--foreground)"} ${color === undefined ? 2 : 14}%, var(--background))`;
  const markId = useId();
  const mark =
    canvasDepth(card) > 0 ? TOP_VIEW_MARKS[CANVAS_SHAPES[card.shape].volume](markId) : null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${card.width} ${card.height}`}
      aria-hidden
    >
      {mark !== null && <defs>{mark}</defs>}
      {selected && (
        <path
          d={d}
          fill="none"
          stroke="color-mix(in oklab, var(--primary) 15%, transparent)"
          strokeWidth={6}
        />
      )}
      <path
        d={d}
        fill={fill}
        stroke={selected ? "color-mix(in oklab, var(--primary) 70%, transparent)" : stroke}
        strokeWidth={selected ? 2 : 1}
      />
      {mark !== null && <path d={d} fill={`url(#${markId})`} />}
    </svg>
  );
}

/**
 * A shape item in 2D: its top view, and its footprint as what the pointer
 * hits — the outline as a clip path, so the corners of an ellipse's or a
 * sphere's box are open canvas, exactly as the camera model's `hitTest`
 * says.
 */
export function ShapeCard({
  card,
  selected,
  onSelect,
  onLabelChange,
  onMoveStart,
  onResizeStart,
  onPortDown,
}: ShapeCardProps) {
  const [edit, setEdit] = useState<LabelEditState>(() =>
    cancelLabelEdit(startLabelEdit(card.label ?? "")),
  );
  const editRef = useRef(edit);
  editRef.current = edit;
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards blur after Enter commit / Escape cancel (input unmount). */
  const endEditRef = useRef<"idle" | "committing" | "canceling">("idle");

  useEffect(() => {
    if (edit.editing) inputRef.current?.focus();
  }, [edit.editing]);

  const beginEdit = useCallback(() => {
    endEditRef.current = "idle";
    setEdit(startLabelEdit(card.label ?? ""));
  }, [card.label]);

  const commit = useCallback(() => {
    if (endEditRef.current !== "idle") {
      setEdit((s) => ({ ...s, editing: false }));
      return;
    }
    endEditRef.current = "committing";
    const result = commitLabelEdit(editRef.current);
    setEdit(result.state);
    if (result.persist !== null) onLabelChange(result.persist);
  }, [onLabelChange]);

  const cancel = useCallback(() => {
    if (endEditRef.current !== "idle") return;
    endEditRef.current = "canceling";
    setEdit(cancelLabelEdit(editRef.current));
  }, []);

  const d = svgPathData(
    shapeOutline(card.shape, card.width, card.height, cornerRadius(card, readCornerRadii())),
  );
  return (
    // The box is only a frame: the footprint inside it is what the pointer hits.
    <div
      className="group/card pointer-events-none absolute"
      style={cardBoxStyle(card)}
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
        beginEdit();
      }}
    >
      <ShapeChrome card={card} d={d} selected={selected} />
      <div
        data-footprint
        className="pointer-events-auto absolute inset-0 flex items-center justify-center px-4"
        style={{ clipPath: `path("${d}")` }}
      >
        {edit.editing ? (
          <input
            ref={inputRef}
            data-testid="shape-label-input"
            className="w-full truncate bg-transparent text-center text-ui text-foreground/85 outline-none"
            value={edit.draft}
            onChange={(e) => setEdit((s) => typeLabelDraft(s, e.target.value))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={cn(
              "max-w-full truncate text-center text-ui",
              hasText(card.label) ? "text-foreground/85" : "text-foreground/25",
            )}
          >
            {textOr(card.label, "Label")}
          </span>
        )}
      </div>
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles selected={selected} onResizeStart={onResizeStart} />
    </div>
  );
}
