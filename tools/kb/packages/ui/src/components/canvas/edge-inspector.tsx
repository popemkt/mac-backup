import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CanvasEdge, KbLinkMode } from "@kb/canvas";
import { CANVAS_COLOR_PRESETS } from "@/lib/canvas-color";
import { cn } from "@/lib/cn";

export interface EdgeInspectorProps {
  edge: CanvasEdge;
  anchor: { x: number; y: number };
  refFields: { id: string; name: string; isRef: boolean }[];
  onClose: () => void;
  onModeChange: (mode: KbLinkMode) => void;
  onFieldChange: (fieldId: string) => void;
  onDelete: () => void;
  onArrowChange?: (end: "fromEnd" | "toEnd", value: "none" | "arrow") => void;
  onColorChange?: (color: string | undefined) => void;
  onLabelChange?: (label: string) => void;
}

export function EdgeInspector({
  edge,
  anchor,
  refFields,
  onClose,
  onModeChange,
  onFieldChange,
  onDelete,
  onArrowChange,
  onColorChange,
  onLabelChange,
}: EdgeInspectorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = edge.kbLink?.mode ?? "layout";
  const fieldId = edge.kbLink?.fieldId ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 w-64 rounded-lg border border-foreground/10 bg-popover p-3 shadow-xl"
      style={{ top: anchor.y + 8, left: Math.max(8, anchor.x - 128) }}
    >
      <div className="mb-2 text-[11px] font-medium text-foreground/50">Edge</div>

      {/* Label */}
      {onLabelChange && (
        <label className="mb-2 flex flex-col gap-1 text-[12px]">
          <span className="text-foreground/60">Label</span>
          <input
            type="text"
            className="rounded-md border border-foreground/10 bg-background px-2 py-1 text-[12px]"
            value={edge.label ?? ""}
            placeholder="Edge label…"
            onChange={(e) => onLabelChange(e.target.value)}
          />
        </label>
      )}

      {/* Arrowheads */}
      {onArrowChange && (
        <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-foreground/60">Arrows</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Start arrow"
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[11px]",
                edge.fromEnd === "arrow"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-foreground/10 text-foreground/50 hover:bg-foreground/5",
              )}
              onClick={() => onArrowChange("fromEnd", edge.fromEnd === "arrow" ? "none" : "arrow")}
            >
              ←
            </button>
            <button
              type="button"
              title="End arrow"
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[11px]",
                (edge.toEnd ?? "arrow") === "arrow"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-foreground/10 text-foreground/50 hover:bg-foreground/5",
              )}
              onClick={() =>
                onArrowChange("toEnd", (edge.toEnd ?? "arrow") === "arrow" ? "none" : "arrow")
              }
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* Color swatches */}
      {onColorChange && (
        <div className="mb-2">
          <div className="mb-1 text-[12px] text-foreground/60">Color</div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="No color"
              title="None"
              className={cn(
                "h-5 w-5 rounded-full border border-foreground/15 bg-background",
                !edge.color && "ring-2 ring-primary/50",
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
                  "h-5 w-5 rounded-full border border-foreground/10",
                  edge.color === p.id && "ring-2 ring-primary/50",
                )}
                style={{ backgroundColor: p.css }}
                onClick={() => onColorChange(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      <label className="mb-2 flex items-center justify-between gap-2 text-[12px]">
        <span className="text-foreground/60">Mode</span>
        <select
          className="rounded-md border border-foreground/10 bg-background px-2 py-1 text-[12px]"
          value={mode}
          onChange={(e) => onModeChange(e.target.value as KbLinkMode)}
        >
          <option value="layout">layout</option>
          <option value="native">native</option>
        </select>
      </label>
      {mode === "native" && (
        <label className="mb-2 flex flex-col gap-1 text-[12px]">
          <span className="text-foreground/60">Ref field</span>
          <select
            className="rounded-md border border-foreground/10 bg-background px-2 py-1 text-[12px]"
            value={fieldId}
            onChange={(e) => onFieldChange(e.target.value)}
          >
            <option value="">Select field…</option>
            {refFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.isRef ? "" : " (not ref)"}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className={cn(
          "mt-1 w-full rounded-md border border-destructive/30 px-2 py-1.5",
          "text-[12px] text-destructive hover:bg-destructive/10",
        )}
        onClick={onDelete}
      >
        Delete edge
      </button>
    </div>,
    document.body,
  );
}
