import { THEME_GLYPHS } from "@/lib/theme-glyphs";
import { useEffect, useRef } from "react";
import { ArrowsHorizontalIcon, SwatchesIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { DESIGN_SYSTEMS } from "@/lib/theme";
import { usePrefsStore, type ThemePref, type WidthPref } from "@/stores/prefs.store";
import { isOutside } from "@/lib/dom";
import type { OptionalUiPlugin } from "@/lib/plugins";
import { useUiStore } from "@/stores/ui.store";
import { PrefFieldRow } from "@/components/ui/pref-field-row";
import { EnumSelect, type EnumOption } from "@/components/ui/enum-select";
import { POPOVER_VALUE_CLASS, PopoverShell } from "@/components/ui/popover-shell";

const THEME_OPTIONS: readonly EnumOption<ThemePref>[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];
const WIDTH_OPTIONS: readonly EnumOption<WidthPref>[] = [
  { value: "centered", label: "centered" },
  { value: "full", label: "full" },
];

/** Off first: an optional plugin is off until it is switched on. */
const PLUGIN_OPTIONS: readonly EnumOption<"off" | "on">[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

export function PreferencesPopover({
  plugins,
}: {
  /** The optional UI plugins, one on/off row each; none, no section. */
  plugins: readonly OptionalUiPlugin[];
}) {
  const open = useUiStore((s) => s.prefsOpen);
  const setOpen = useUiStore((s) => s.setPrefsOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (isOutside(panelRef.current, e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <PopoverShell panelRef={panelRef} title="Preferences" className="absolute right-4 top-11 mt-1">
      <ThemeRow />
      <DesignSystemRow />
      <WidthRow />
      {plugins.length > 0 ? (
        <section aria-label="plugins">
          <h3 className="px-1.5 pb-1 pt-2 text-meta uppercase tracking-wide text-foreground/30">
            plugins
          </h3>
          {plugins.map((entry) => (
            <PluginRow key={entry.plugin.name} entry={entry} />
          ))}
        </section>
      ) : null}
    </PopoverShell>
  );
}

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefFieldRow icon={THEME_GLYPHS[theme]} label="theme">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={theme}
        options={THEME_OPTIONS}
        onChange={setTheme}
      />
    </PrefFieldRow>
  );
}

/**
 * One swatch per design system. Each sample is live, not a picture: it
 * carries `data-theme`, so that system's own stylesheet paints its ground,
 * ink, accent, face, radius and border, in the current light or dark. The
 * name under it stays in the popover's face, so it reads as a label.
 */
function DesignSystemRow() {
  const current = usePrefsStore((s) => s.designSystem);
  const setDesignSystem = usePrefsStore((s) => s.setDesignSystem);
  return (
    <PrefFieldRow icon={SwatchesIcon} label="design">
      <div
        role="radiogroup"
        aria-label="design system"
        className="flex min-w-0 flex-1 gap-1.5 py-1"
      >
        {DESIGN_SYSTEMS.map((system) => {
          const checked = system.id === current;
          return (
            <button
              key={system.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-testid={`design-system-${system.id}`}
              onClick={() => setDesignSystem(system.id)}
              className="group flex min-w-0 flex-1 flex-col items-stretch gap-1"
            >
              <span
                data-theme={system.id}
                className={cn(
                  "flex items-center justify-between gap-1 rounded-md border border-border bg-background px-1.5 py-1 font-sans text-ui leading-none text-foreground shadow-edge outline-offset-2",
                  checked ? "outline-2 outline-primary" : "group-hover:bg-accent",
                )}
              >
                Aa
                <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              </span>
              <span
                className={cn(
                  "truncate text-caption leading-none",
                  checked ? "text-foreground/80" : "text-foreground/45",
                )}
              >
                {system.label}
              </span>
            </button>
          );
        })}
      </div>
    </PrefFieldRow>
  );
}

function WidthRow() {
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <PrefFieldRow icon={ArrowsHorizontalIcon} label="width">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={width}
        options={WIDTH_OPTIONS}
        onChange={setWidth}
      />
    </PrefFieldRow>
  );
}

function PluginRow({ entry }: { entry: OptionalUiPlugin }) {
  const name = entry.plugin.name;
  const enabled = usePrefsStore((s) => s.enabledPlugins.includes(name));
  const setPluginEnabled = usePrefsStore((s) => s.setPluginEnabled);
  return (
    <PrefFieldRow icon={entry.icon} label={entry.label}>
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={enabled ? "on" : "off"}
        options={PLUGIN_OPTIONS}
        testId={`plugin-${name}`}
        onChange={(next) => setPluginEnabled(name, next === "on")}
      />
    </PrefFieldRow>
  );
}
