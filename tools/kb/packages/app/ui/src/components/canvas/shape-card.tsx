import { useCallback, useEffect, useRef, useState } from "react";
import { shapeOutline, svgPathData, type CanvasShapeNode } from "@kb/canvas";
import { canvasColorStyle, resolveCanvasColor } from "@/lib/canvas-color";
import { classifyCardPointer } from "@/lib/card-pointer";
import { cn } from "@/lib/cn";
import { readShapeRadius } from "./canvas-card-face";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";
import {
  cancelLabelEdit,
  commitLabelEdit,
  startLabelEdit,
  typeLabelDraft,
  type LabelEditState,
} from "@/lib/shape-label-edit";
import { hasText, textOr } from "@/lib/text";

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
 * A shape's outline, traced from the shape table (`shapeOutline`) as the 3D
 * faces trace it, filled with its preset tint and stroked in its colour; a
 * selected shape is stroked in the primary over a soft halo.
 */
function ShapeChrome({
  card,
  selected,
  children,
}: {
  card: CanvasShapeNode;
  selected: boolean;
  children: React.ReactNode;
}) {
  const tint = canvasColorStyle(card.color);
  const stroke =
    resolveCanvasColor(card.color) ?? "color-mix(in oklab, var(--foreground) 18%, transparent)";
  const d = svgPathData(shapeOutline(card.shape, card.width, card.height, readShapeRadius()));
  return (
    <div className="relative h-full w-full">
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${card.width} ${card.height}`}
        aria-hidden
      >
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
          fill={
            tint.backgroundColor ?? "color-mix(in oklab, var(--foreground) 2%, var(--background))"
          }
          stroke={selected ? "color-mix(in oklab, var(--primary) 70%, transparent)" : stroke}
          strokeWidth={selected ? 2 : 1}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center px-4">{children}</div>
    </div>
  );
}

/** One card for rect / ellipse / diamond — CSS/SVG only. */
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

  return (
    <div
      className="group/card absolute"
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
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
      <ShapeChrome card={card} selected={selected}>
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
      </ShapeChrome>
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles selected={selected} onResizeStart={onResizeStart} />
    </div>
  );
}
