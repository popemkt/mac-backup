import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CanvasShapeNode } from "@kb/canvas";
import { PopoverShell } from "@/components/ui/popover-shell";
import { CANVAS_COLOR_PRESETS } from "@/lib/canvas-color";
import { cn } from "@/lib/cn";
import { isOutside } from "@/lib/dom";
import { hasText } from "@/lib/text";

export interface ShapeInspectorProps {
  card: CanvasShapeNode;
  anchor: { x: number; y: number };
  onClose: () => void;
  onColorChange: (color: string | undefined) => void;
}

export function ShapeInspector({ card, anchor, onClose, onColorChange }: ShapeInspectorProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (isOutside(ref.current, e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed z-50" style={{ top: anchor.y + 8, left: Math.max(8, anchor.x - 160) }}>
      <PopoverShell title="Shape" panelRef={ref} className="w-72" data-testid="shape-inspector">
        <div className="px-1.5 pb-1 text-[12px] text-foreground/50">Color</div>
        <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
          <button
            type="button"
            aria-label="No color"
            title="None"
            className={cn(
              "h-6 w-6 rounded-full border border-foreground/15 bg-background",
              !hasText(card.color) && "ring-2 ring-primary/50",
            )}
            onClick={() => onColorChange(undefined)}
          />
          {CANVAS_COLOR_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={p.label}
              title={p.label}
              className={cn(
                "h-6 w-6 rounded-full border border-foreground/10",
                card.color === p.id && "ring-2 ring-primary/50",
              )}
              style={{ backgroundColor: p.css }}
              onClick={() => onColorChange(p.id)}
            />
          ))}
        </div>
      </PopoverShell>
    </div>,
    document.body,
  );
}
