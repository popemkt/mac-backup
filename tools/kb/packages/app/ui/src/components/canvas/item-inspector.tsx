import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  canvasDepth,
  canvasElevation,
  canvasRotation,
  isGroupNode,
  isKbNode,
  isShapeNode,
  isTextNode,
  withDepth,
  withElevation,
  withRotation,
  type CanvasNode,
} from "@kb/canvas";
import { cn, hasText, isOutside, PopoverShell } from "@/sdk";
import { CANVAS_COLOR_PRESETS } from "./canvas-color";

export interface ItemInspectorProps {
  item: CanvasNode;
  anchor: { x: number; y: number };
  onClose: () => void;
  onChange: (item: CanvasNode) => void;
}

/** How deep Extrude makes a flat item: a block, not a tower; the field takes it from there. */
const EXTRUDE_DEPTH = 40;

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
 * How a field reads its number: a length in whole canvas units, stepped by
 * ten; an angle in degrees to a tenth, stepped by the 15° a turn snaps to.
 */
const FIELD_UNITS = {
  length: { step: 10, round: (v: number) => Math.round(v) },
  angle: { step: 15, round: (v: number) => Math.round(v * 10) / 10 },
} as const;

/**
 * A number in its unit, committed on Enter or blur as one change (one
 * history step), never per keystroke; Escape puts the value back.
 */
function NumberField({
  label,
  hint,
  value,
  unit,
  min,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  unit: keyof typeof FIELD_UNITS;
  min?: number;
  onCommit: (value: number) => void;
}) {
  // A new value from outside remounts the field (its `key`), so the draft starts from it.
  const [draft, setDraft] = useState(String(value));
  const { step, round } = FIELD_UNITS[unit];
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    const clamped = round(min === undefined ? next : Math.max(min, next));
    if (clamped !== value) onCommit(clamped);
    else setDraft(String(value));
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5" title={hint}>
      <span className="text-label text-foreground/45">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        aria-label={label}
        className="h-7 w-full rounded-md border border-foreground/10 bg-background px-2 text-ui text-foreground/85 tabular-nums outline-none focus:border-primary/50"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(String(value));
          }
        }}
      />
    </label>
  );
}

/**
 * Where the item stands and how far it rises: its elevation (`z`) and its
 * depth. Extrude lifts a flat item into a block — a sticky into a block, a
 * rectangle into a box — and Flatten lays it back on its plane.
 */
function HeightRow({ item, onChange }: Pick<ItemInspectorProps, "item" | "onChange">) {
  const depth = canvasDepth(item);
  return (
    <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
      <div className="flex items-center justify-between">
        <span className="text-meta text-foreground/50">Height</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-label text-foreground/55 hover:bg-foreground/5 hover:text-foreground/85"
          onClick={() => onChange(withDepth(item, depth > 0 ? 0 : EXTRUDE_DEPTH))}
        >
          {depth > 0 ? "Flatten" : "Extrude"}
        </button>
      </div>
      <div className="flex gap-2">
        <NumberField
          key={`lift:${canvasElevation(item)}`}
          label="Lift"
          hint="How high its base stands off the floor"
          value={canvasElevation(item)}
          unit="length"
          onCommit={(z) => onChange(withElevation(item, z))}
        />
        <NumberField
          key={`depth:${depth}`}
          label="Depth"
          hint="How far it rises from its base; 0 is flat"
          value={depth}
          unit="length"
          min={0}
          onCommit={(d) => onChange(withDepth(item, d))}
        />
      </div>
    </div>
  );
}

/** What each rotation field turns the item about. */
const TURN_HINTS = {
  x: "Degrees about its own width axis, applied first",
  y: "Degrees about its depth-wise axis, applied second",
  z: "Degrees about the vertical, applied last; clockwise from the top",
} as const;

/**
 * How the item is turned about its centre: degrees about x, then y, then z
 * (Blender's XYZ Euler), each committed as one change.
 */
function RotationRow({ item, onChange }: Pick<ItemInspectorProps, "item" | "onChange">) {
  const rotation = canvasRotation(item);
  return (
    <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
      <span className="text-meta text-foreground/50">Rotation</span>
      <div className="flex gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberField
            key={`turn:${axis}:${rotation[axis]}`}
            label={axis.toUpperCase()}
            hint={TURN_HINTS[axis]}
            value={rotation[axis]}
            unit="angle"
            onCommit={(angle) => onChange(withRotation(item, { ...rotation, [axis]: angle }))}
          />
        ))}
      </div>
    </div>
  );
}

/** What the inspector calls the item: by what it is, not how it is stored. */
function titleOf(item: CanvasNode): string {
  if (isShapeNode(item)) return canvasDepth(item) > 0 ? "Solid" : "Shape";
  if (isTextNode(item)) return canvasDepth(item) > 0 ? "Block" : "Text";
  if (isKbNode(item)) return "Card";
  if (isGroupNode(item)) return "Frame";
  return "Item";
}

/**
 * The selected item's inspector: a canvas widget, not kb's node inspector,
 * because canvas items are not nodes yet (plan 2026-10-02, owner answer 2).
 */
export function ItemInspector({ item, anchor, onClose, onChange }: ItemInspectorProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Below the anchor, or above it when the viewport has no room below.
  const [top, setTop] = useState(anchor.y + 8);
  useLayoutEffect(() => {
    const height = ref.current?.getBoundingClientRect().height ?? 0;
    const below = anchor.y + 8;
    setTop(below + height > window.innerHeight - 8 ? Math.max(8, anchor.y - height - 8) : below);
  }, [anchor.y]);

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
    <div className="fixed z-50" style={{ top, left: Math.max(8, anchor.x - 160) }}>
      <PopoverShell
        title={titleOf(item)}
        panelRef={ref}
        className="w-72"
        data-testid="item-inspector"
      >
        {isShapeNode(item) && <ColorRow item={item} onChange={onChange} />}
        <HeightRow item={item} onChange={onChange} />
        <RotationRow item={item} onChange={onChange} />
      </PopoverShell>
    </div>,
    document.body,
  );
}
