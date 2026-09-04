import { useEffect, useRef } from "react";
import { ArrowsHorizontalIcon, CircleHalfIcon, TextAaIcon } from "@phosphor-icons/react";
import { usePrefsStore, type FontPref, type ThemePref, type WidthPref } from "@/stores/prefs.store";
import { isOutside } from "@/lib/dom";
import { useUiStore } from "@/stores/ui.store";
import { PrefFieldRow } from "@/components/outline/fields-section";
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

export function PreferencesPopover() {
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
    </PopoverShell>
  );
}

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefFieldRow icon={CircleHalfIcon} label="theme">
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
