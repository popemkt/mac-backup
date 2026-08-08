import { useEffect, useRef } from "react";
import {
  ArrowsHorizontal,
  CircleHalf,
  Eye,
  TextAa,
} from "@phosphor-icons/react";
import {
  usePrefsStore,
  type FontPref,
  type ThemePref,
  type WidthPref,
} from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { PrefFieldRow } from "@/components/outline/fields-section";
import {
  POPOVER_VALUE_CLASS,
  PopoverShell,
} from "@/components/ui/popover-shell";

export function PreferencesPopover() {
  const open = useUiStore((s) => s.prefsOpen);
  const setOpen = useUiStore((s) => s.setPrefsOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && !panel.contains(e.target)) {
        setOpen(false);
      }
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
    <PopoverShell
      panelRef={panelRef}
      title="Preferences"
      className="absolute right-4 top-11 mt-1"
    >
      <ThemeRow />
      <FontRow />
      <WidthRow />
      <ShowAllFieldsRow />
    </PopoverShell>
  );
}

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefFieldRow icon={CircleHalf} label="theme">
      <select
        className={POPOVER_VALUE_CLASS}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemePref)}
      >
        <option value="system">system</option>
        <option value="light">light</option>
        <option value="dark">dark</option>
      </select>
    </PrefFieldRow>
  );
}

function FontRow() {
  const font = usePrefsStore((s) => s.font);
  const setFont = usePrefsStore((s) => s.setFont);
  return (
    <PrefFieldRow icon={TextAa} label="font">
      <select
        className={POPOVER_VALUE_CLASS}
        value={font}
        onChange={(e) => setFont(e.target.value as FontPref)}
      >
        <option value="outfit">Outfit</option>
        <option value="inter">Inter</option>
      </select>
    </PrefFieldRow>
  );
}

function WidthRow() {
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <PrefFieldRow icon={ArrowsHorizontal} label="width">
      <select
        className={POPOVER_VALUE_CLASS}
        value={width}
        onChange={(e) => setWidth(e.target.value as WidthPref)}
      >
        <option value="centered">centered</option>
        <option value="full">full</option>
      </select>
    </PrefFieldRow>
  );
}

function ShowAllFieldsRow() {
  const showAllFields = usePrefsStore((s) => s.showAllFields);
  const setShowAllFields = usePrefsStore((s) => s.setShowAllFields);
  return (
    <PrefFieldRow icon={Eye} label="debug fields">
      <label className="flex min-h-6 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-foreground/20 accent-primary"
          checked={showAllFields}
          onChange={(e) => setShowAllFields(e.target.checked)}
        />
        <span className={POPOVER_VALUE_CLASS}>Show all fields (debug)</span>
      </label>
    </PrefFieldRow>
  );
}
