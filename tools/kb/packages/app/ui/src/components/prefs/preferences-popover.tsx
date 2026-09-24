import { THEME_GLYPHS } from "@/lib/theme-glyphs";
import { useEffect, useRef } from "react";
import { ArrowsHorizontalIcon, TextAaIcon } from "@phosphor-icons/react";
import { usePrefsStore, type FontPref, type ThemePref, type WidthPref } from "@/stores/prefs.store";
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
const FONT_OPTIONS: readonly EnumOption<FontPref>[] = [
  { value: "inter", label: "Inter" },
  { value: "outfit", label: "Outfit" },
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
      <FontRow />
      <WidthRow />
      {plugins.length > 0 ? (
        <section aria-label="plugins">
          <h3 className="px-1.5 pb-1 pt-2 text-[12px] uppercase tracking-wide text-foreground/30">
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

function FontRow() {
  const font = usePrefsStore((s) => s.font);
  const setFont = usePrefsStore((s) => s.setFont);
  return (
    <PrefFieldRow icon={TextAaIcon} label="font">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={font}
        options={FONT_OPTIONS}
        onChange={setFont}
      />
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
