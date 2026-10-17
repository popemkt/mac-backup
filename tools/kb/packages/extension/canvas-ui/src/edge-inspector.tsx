import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { styleOf, type CanvasEdge, type KbLinkMode } from "@kb/canvas";
import { cn, EnumSelect, isOutside, type EnumOption } from "@kb/ui-sdk";
import { ColorSwatches, EdgeLookRows } from "./item-style-rows";

export interface EdgeInspectorProps {
  edge: CanvasEdge;
  anchor: { x: number; y: number };
  /** The ref fields a native link on this edge can bind (`edgeFields`). */
  refFields: readonly { readonly id: string; readonly text: string }[];
  onClose: () => void;
  onModeChange: (mode: KbLinkMode) => void;
  onFieldChange: (fieldId: string) => void;
  onDelete: () => void;
  /** The edge changed as one step: its label, colour, route or looks. */
  onChange: (edge: CanvasEdge) => void;
}

const LINK_MODE_OPTIONS: readonly EnumOption<KbLinkMode>[] = [
  { value: "layout", label: "Canvas only" },
  { value: "native", label: "Node relationship" },
];

/** `edge` with `key` set to `value`, or without it when `value` is blank. */
function withText(edge: CanvasEdge, key: "label" | "color", value: string | undefined) {
  const updated = { ...edge };
  if (value === undefined || value === "") delete updated[key];
  else updated[key] = value;
  return updated;
}

/** Whether the edge draws a canvas line only, or binds a ref field between its ends' nodes. */
function LinkRows({
  edge,
  refFields,
  onModeChange,
  onFieldChange,
}: Pick<EdgeInspectorProps, "edge" | "refFields" | "onModeChange" | "onFieldChange">) {
  const mode = edge.kbLink?.mode ?? "layout";
  const fieldId = edge.kbLink?.fieldId ?? "";
  return (
    <>
      <label className="mb-2 flex items-center justify-between gap-2 text-meta">
        <span className="text-foreground/60">Mode</span>
        <EnumSelect
          className="rounded-md border border-foreground/10 bg-background px-2 py-1 text-meta"
          value={mode}
          options={LINK_MODE_OPTIONS}
          onChange={onModeChange}
        />
      </label>
      <p className="mb-3 text-label leading-relaxed text-foreground/50">
        {mode === "layout"
          ? "This connection appears on this canvas only."
          : "This connection uses a reference field between the underlying nodes."}
      </p>
      {mode === "native" && (
        <label className="mb-2 flex flex-col gap-1 text-meta">
          <span className="text-foreground/60">Ref field</span>
          <select
            className="rounded-md border border-foreground/10 bg-background px-2 py-1 text-meta"
            value={fieldId}
            onChange={(e) => onFieldChange(e.target.value)}
          >
            <option value="">Select field…</option>
            {refFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.text}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export function EdgeInspector({
  edge,
  anchor,
  refFields,
  onClose,
  onModeChange,
  onFieldChange,
  onDelete,
  onChange,
}: EdgeInspectorProps) {
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
    <div
      ref={ref}
      className="fixed z-50 w-72 rounded-lg border border-foreground/10 bg-popover p-3 shadow-overlay"
      style={{ top: anchor.y + 8, left: Math.max(8, anchor.x - 144) }}
    >
      <div className="mb-2 text-label font-medium text-foreground/50">Edge</div>

      <label className="mb-2 flex flex-col gap-1 text-meta">
        <span className="text-foreground/60">Label</span>
        <input
          type="text"
          className="rounded-md border border-foreground/10 bg-background px-2 py-1 text-meta"
          value={edge.label ?? ""}
          placeholder="Edge label…"
          onChange={(e) => onChange(withText(edge, "label", e.target.value))}
        />
      </label>

      <EdgeLookRows edge={edge} onChange={onChange} />

      <div className="mb-2">
        <div className="mb-1 text-meta text-foreground/60">Color</div>
        <ColorSwatches
          value={styleOf(edge).color}
          onChange={(color) => onChange(withText(edge, "color", color))}
          small
        />
      </div>

      <LinkRows
        edge={edge}
        refFields={refFields}
        onModeChange={onModeChange}
        onFieldChange={onFieldChange}
      />
      <button
        type="button"
        className={cn(
          "mt-1 w-full rounded-md border border-destructive/30 px-2 py-1.5",
          "text-meta text-destructive hover:bg-destructive/10",
        )}
        onClick={onDelete}
      >
        Delete edge
      </button>
    </div>,
    document.body,
  );
}
