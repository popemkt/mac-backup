import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CanvasEdge, KbLinkMode } from "@kb/canvas";
import { cn } from "@/lib/cn";

export interface EdgeInspectorProps {
  edge: CanvasEdge;
  anchor: { x: number; y: number };
  refFields: { id: string; name: string; isRef: boolean }[];
  onClose: () => void;
  onModeChange: (mode: KbLinkMode) => void;
  onFieldChange: (fieldId: string) => void;
  onDelete: () => void;
}

export function EdgeInspector({
  edge,
  anchor,
  refFields,
  onClose,
  onModeChange,
  onFieldChange,
  onDelete,
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
      <div className="mb-2 text-[11px] font-medium text-foreground/50">
        Edge
      </div>
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
