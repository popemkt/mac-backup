import { GraphMappings } from "./graph-mappings";
import { useEffect, useRef, useState } from "react";
import { GearSixIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { SYSTEM_IDS } from "@/lib/types";
import { GRAPH_LINK_STYLE_VALUES, GRAPH_NODE_LOOK_VALUES } from "@kb/model";
import {
  LENS_LABEL_DENSITIES,
  LENS_LAYOUTS,
  LENS_LINK_STYLES,
  LENS_NODE_LOOKS,
  type LensPerspective,
} from "@/lib/graph-lens";
import { settingDisabledReason } from "./graph-capabilities";
import { cn } from "@/lib/cn";
import { isOutside } from "@/lib/dom";

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
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (isOutside(panelRef.current, e.target)) setOpen(false);
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
  const setRef = (field: string, v: string) => {
    void mutations.setLensProp(perspective.id, field, { t: "ref", v });
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
        <GearSixIcon size={14} />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-9 z-40 max-h-[calc(100vh-10rem)] w-72 overflow-y-auto rounded-lg border border-foreground/10 bg-popover/95 p-3 shadow-overlay backdrop-blur-sm"
          data-testid="graph-settings-panel"
        >
          <p className="mb-2 text-label font-semibold uppercase tracking-wide text-foreground/40">
            Settings
          </p>

          <GraphMappings perspective={perspective} />

          <Choice
            label="Layout"
            reason={settingDisabledReason(perspective.renderer, "layout")}
            options={LENS_LAYOUTS.map((layout) => ({ key: layout, label: layout }))}
            value={perspective.layout}
            onPick={(layout) => setStr(SYSTEM_IDS.lensLayoutField, layout)}
          />

          <Field
            label={`Spread (${Math.round(perspective.spread)})`}
            reason={settingDisabledReason(perspective.renderer, "spread")}
          >
            <input
              type="range"
              min={50}
              max={500}
              value={perspective.spread}
              className="w-full"
              onChange={(e) => setNum(SYSTEM_IDS.lensSpreadField, Number(e.target.value))}
            />
          </Field>

          <Field
            label={`Links (${Math.round(perspective.linkDistance)})`}
            reason={settingDisabledReason(perspective.renderer, "linkDistance")}
          >
            <input
              type="range"
              min={30}
              max={200}
              value={perspective.linkDistance}
              className="w-full"
              onChange={(e) => setNum(SYSTEM_IDS.lensLinkDistanceField, Number(e.target.value))}
            />
          </Field>

          <Choice
            label="Label density"
            reason={settingDisabledReason(perspective.renderer, "labelDensity")}
            options={LENS_LABEL_DENSITIES.map((density) => ({ key: density, label: density }))}
            value={perspective.labelDensity}
            onPick={(density) => setStr(SYSTEM_IDS.lensLabelDensityField, density)}
          />

          <Choice
            label="Node look"
            reason={settingDisabledReason(perspective.renderer, "nodeLook")}
            options={LENS_NODE_LOOKS.map((look) => ({
              key: look,
              label: GRAPH_NODE_LOOK_VALUES[look].label,
            }))}
            value={perspective.nodeLook}
            onPick={(look) => setRef(SYSTEM_IDS.lensNodeLookField, GRAPH_NODE_LOOK_VALUES[look].id)}
          />

          <Choice
            label="Link style"
            reason={settingDisabledReason(perspective.renderer, "linkStyle")}
            options={LENS_LINK_STYLES.map((style) => ({
              key: style,
              label: GRAPH_LINK_STYLE_VALUES[style].label,
            }))}
            value={perspective.linkStyle}
            onPick={(style) =>
              setRef(SYSTEM_IDS.lensLinkStyleField, GRAPH_LINK_STYLE_VALUES[style].id)
            }
          />

          <Toggle
            label="Show labels"
            reason={settingDisabledReason(perspective.renderer, "showLabels")}
            checked={perspective.showLabels}
            onChange={(v) => setBool(SYSTEM_IDS.lensShowLabelsField, v)}
          />
          <Toggle
            label="Curved links"
            reason={settingDisabledReason(perspective.renderer, "curvedLinks")}
            checked={perspective.curvedLinks}
            onChange={(v) => setBool(SYSTEM_IDS.lensCurvedLinksField, v)}
          />
          <Toggle
            label="Auto-rotate (3D)"
            reason={settingDisabledReason(perspective.renderer, "autorotate")}
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
  reason,
}: {
  reason?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      disabled={reason !== undefined}
      title={reason}
      className="mb-2.5 flex flex-col gap-1 disabled:opacity-40"
    >
      <span className="text-label text-foreground/50">{label}</span>
      {children}
      {reason !== undefined ? (
        <span className="text-caption text-foreground/55">{reason}</span>
      ) : null}
    </fieldset>
  );
}

/** One choice among a lens field's options: a row of buttons, the chosen one marked. */
function Choice<K extends string>({
  label,
  reason,
  options,
  value,
  onPick,
}: {
  label: string;
  reason?: string;
  options: readonly { readonly key: K; readonly label: string }[];
  value: K;
  onPick: (key: K) => void;
}) {
  return (
    <Field label={label} {...(reason === undefined ? {} : { reason })}>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            className={cn(
              "rounded-xs px-2 py-0.5 text-label capitalize",
              value === option.key
                ? "bg-foreground/[0.1] font-semibold text-foreground/80"
                : "text-foreground/45 hover:bg-foreground/[0.05]",
            )}
            onClick={() => onPick(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  reason,
}: {
  label: string;
  reason?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      title={reason}
      className="mb-1.5 flex items-center justify-between gap-2 text-meta text-foreground/70"
    >
      <span>{label}</span>
      <input
        type="checkbox"
        disabled={reason !== undefined}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
