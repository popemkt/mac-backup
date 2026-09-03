import { useEffect, useRef, useState } from "react";
import { GearSix } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { SYSTEM_IDS } from "@/lib/types";
import {
  LENS_LAYOUTS,
  type LensLabelDensity,
  type LensLayout,
  type LensPerspective,
} from "@/lib/graph-lens";
import { cn } from "@/lib/cn";

const CLUSTER_BY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "parent", label: "Parent" },
  { value: "none", label: "None" },
];

const DENSITY_OPTIONS: LensLabelDensity[] = ["low", "medium", "high"];

interface GraphSettingsProps {
  perspective: LensPerspective;
}

/**
 * Settings popover — every control writes a `sys.f.lens.*` prop via
 * setLensProp (unset-before-set). Only open/closed stays in React.
 */
export function GraphSettings({ perspective }: GraphSettingsProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const setStr = (field: string, v: string) => {
    void mutations.setLensProp(perspective.id, field, { t: "str", v });
  };
  const setNum = (field: string, v: number) => {
    void mutations.setLensProp(perspective.id, field, { t: "num", v });
  };
  const setBool = (field: string, v: boolean) => {
    void mutations.setLensProp(perspective.id, field, { t: "bool", v });
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80",
          open && "bg-foreground/[0.08] text-foreground/80",
        )}
        title="Graph settings"
        aria-label="Graph settings"
        aria-expanded={open}
        data-testid="graph-settings-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <GearSix size={14} />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-9 z-40 w-64 rounded-lg border border-foreground/10 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
          data-testid="graph-settings-panel"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">
            Settings
          </p>

          <Field label="Cluster by">
            <select
              className="w-full rounded border border-foreground/10 bg-transparent px-1.5 py-1 text-[12px]"
              value={perspective.clusterBy}
              data-testid="graph-settings-cluster-by"
              onChange={(e) =>
                setStr(SYSTEM_IDS.lensClusterByField, e.target.value)
              }
            >
              {CLUSTER_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {perspective.clusterBy.startsWith("tag:") ||
              perspective.clusterBy.startsWith("prop:") ? (
                <option value={perspective.clusterBy}>
                  {perspective.clusterBy}
                </option>
              ) : null}
            </select>
          </Field>

          <Field label="Layout">
            <div className="flex flex-wrap gap-1">
              {LENS_LAYOUTS.map((layout) => (
                <button
                  key={layout}
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] capitalize",
                    perspective.layout === layout
                      ? "bg-foreground/[0.1] font-semibold text-foreground/80"
                      : "text-foreground/45 hover:bg-foreground/[0.05]",
                  )}
                  onClick={() =>
                    setStr(SYSTEM_IDS.lensLayoutField, layout as LensLayout)
                  }
                >
                  {layout}
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Spread (${Math.round(perspective.spread)})`}>
            <input
              type="range"
              min={50}
              max={500}
              value={perspective.spread}
              className="w-full"
              onChange={(e) =>
                setNum(SYSTEM_IDS.lensSpreadField, Number(e.target.value))
              }
            />
          </Field>

          <Field label={`Links (${Math.round(perspective.linkDistance)})`}>
            <input
              type="range"
              min={30}
              max={200}
              value={perspective.linkDistance}
              className="w-full"
              onChange={(e) =>
                setNum(SYSTEM_IDS.lensLinkDistanceField, Number(e.target.value))
              }
            />
          </Field>

          <Field label="Label density">
            <div className="flex gap-1">
              {DENSITY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] capitalize",
                    perspective.labelDensity === d
                      ? "bg-foreground/[0.1] font-semibold text-foreground/80"
                      : "text-foreground/45 hover:bg-foreground/[0.05]",
                  )}
                  onClick={() => setStr(SYSTEM_IDS.lensLabelDensityField, d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>

          <Toggle
            label="Show labels"
            checked={perspective.showLabels}
            onChange={(v) => setBool(SYSTEM_IDS.lensShowLabelsField, v)}
          />
          <Toggle
            label="Curved links"
            checked={perspective.curvedLinks}
            onChange={(v) => setBool(SYSTEM_IDS.lensCurvedLinksField, v)}
          />
          <Toggle
            label="Auto-rotate (3D)"
            checked={perspective.autorotate}
            onChange={(v) => setBool(SYSTEM_IDS.lensAutorotateField, v)}
          />
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-2.5 flex flex-col gap-1">
      <span className="text-[11px] text-foreground/50">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-foreground/70">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
