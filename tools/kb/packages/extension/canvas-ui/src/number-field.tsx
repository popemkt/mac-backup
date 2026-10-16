/**
 * The number field the canvas inspectors share — an item's lift, depth,
 * turn and opacity, an edge's bend — read and stepped in its unit and
 * committed as one change.
 */
import { useState } from "react";

/**
 * How a field reads its number: a length in whole canvas units, stepped by
 * ten; an angle in degrees to a tenth, stepped by the 15° a turn snaps to;
 * a share in whole percent, stepped by ten.
 */
const FIELD_UNITS = {
  length: { step: 10, round: (v: number) => Math.round(v) },
  angle: { step: 15, round: (v: number) => Math.round(v * 10) / 10 },
  percent: { step: 10, round: (v: number) => Math.round(Math.min(100, v)) },
} as const;

/**
 * A number in its unit, committed on Enter or blur as one change (one
 * history step), never per keystroke; Escape puts the value back.
 */
export function NumberField({
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
