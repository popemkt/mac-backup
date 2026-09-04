import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasShapeNode } from "@kb/canvas";
import { canvasColorStyle, resolveCanvasColor } from "@/lib/canvas-color";
import { classifyCardPointer } from "@/lib/card-pointer";
import { cn } from "@/lib/cn";
import {
  cancelLabelEdit,
  commitLabelEdit,
  startLabelEdit,
  typeLabelDraft,
  type LabelEditState,
} from "@/lib/shape-label-edit";

interface ShapeCardProps {
  card: CanvasShapeNode;
  selected: boolean;
  onSelect: (anchor: { x: number; y: number }) => void;
  onLabelChange: (label: string) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

function ShapeChrome({
  shape,
  color,
  selected,
  children,
}: {
  shape: CanvasShapeNode["shape"];
  color?: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  const tint = canvasColorStyle(color);
  const stroke =
    resolveCanvasColor(color) ?? "color-mix(in oklab, var(--foreground) 18%, transparent)";

  if (shape === "diamond") {
    return (
      <div className="relative h-full w-full">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polygon
            points="50,2 98,50 50,98 2,50"
            fill={tint.backgroundColor ?? "color-mix(in oklab, var(--foreground) 3%, transparent)"}
            stroke={selected ? "var(--primary)" : stroke}
            strokeWidth={selected ? 2.2 : 1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center px-4">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center border px-3",
        shape === "ellipse" ? "rounded-full" : "rounded-md",
        selected ? "border-primary/40 shadow-sm" : "border-foreground/[0.12]",
      )}
      style={{
        borderColor: selected ? undefined : tint.borderColor,
        backgroundColor:
          tint.backgroundColor ?? "color-mix(in oklab, var(--foreground) 2%, var(--background))",
      }}
    >
      {children}
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
  const [edit, setEdit] = useState<LabelEditState>(() => startLabelEdit(""));
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
      <ShapeChrome shape={card.shape} color={card.color} selected={selected}>
        {edit.editing ? (
          <input
            ref={inputRef}
            data-testid="shape-label-input"
            className="w-full truncate bg-transparent text-center text-[13px] text-foreground/85 outline-none"
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
              "max-w-full truncate text-center text-[13px]",
              card.label ? "text-foreground/85" : "text-foreground/25",
            )}
          >
            {card.label || "Label"}
          </span>
        )}
      </ShapeChrome>
      {(["left", "right", "top", "bottom"] as const).map((side) => (
        <button
          key={side}
          type="button"
          data-port={side}
          aria-label={`Connect ${side}`}
          className={cn(
            "absolute z-10 h-2.5 w-2.5 rounded-full border border-foreground/20 bg-background",
            "opacity-0 transition-opacity group-hover/card:opacity-100",
            side === "left" && "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
            side === "right" && "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
            side === "top" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
            side === "bottom" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPortDown(side, e);
          }}
        />
      ))}
      <div
        data-resize
        className="absolute right-0 bottom-0 z-10 h-3 w-3 cursor-se-resize opacity-0 group-hover/card:opacity-60"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeStart(e);
        }}
      />
    </div>
  );
}
