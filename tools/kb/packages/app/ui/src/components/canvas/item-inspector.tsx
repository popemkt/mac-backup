import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isShapeNode, type CanvasNode } from "@kb/canvas";
import { PopoverShell } from "@/components/ui/popover-shell";
import { CANVAS_COLOR_PRESETS } from "@/lib/canvas-color";
import { cn } from "@/lib/cn";
import { isOutside } from "@/lib/dom";
import { hasText } from "@/lib/text";

export interface ItemInspectorProps {
  item: CanvasNode;
  anchor: { x: number; y: number };
  onClose: () => void;
  onChange: (item: CanvasNode) => void;
}

/** The colour row: a shape's preset tint (the item kind that paints its colour). */
function ColorRow({ item, onChange }: Pick<ItemInspectorProps, "item" | "onChange">) {
  const setColor = (color: string | undefined) => {
    const updated = { ...item };
    if (color === undefined) delete updated.color;
    else updated.color = color;
    onChange(updated);
  };
  return (
    <>
      <div className="px-1.5 pb-1 text-meta text-foreground/50">Color</div>
      <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
        <button
          type="button"
          aria-label="No color"
          title="None"
          className={cn(
            "h-6 w-6 rounded-full border border-foreground/15 bg-background",
            !hasText(item.color) && "ring-2 ring-primary/50",
          )}
          onClick={() => setColor(undefined)}
        />
        {CANVAS_COLOR_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={p.label}
            title={p.label}
            className={cn(
              "h-6 w-6 rounded-full border border-foreground/10",
              item.color === p.id && "ring-2 ring-primary/50",
            )}
            style={{ backgroundColor: p.css }}
            onClick={() => setColor(p.id)}
          />
        ))}
      </div>
    </>
  );
}

/**
 * The selected item's inspector: a canvas widget, not kb's node inspector,
 * because canvas items are not nodes yet (plan 2026-10-02, owner answer 2).
 */
export function ItemInspector({ item, anchor, onClose, onChange }: ItemInspectorProps) {
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
        {isShapeNode(item) && <ColorRow item={item} onChange={onChange} />}
      </PopoverShell>
    </div>,
    document.body,
  );
}
