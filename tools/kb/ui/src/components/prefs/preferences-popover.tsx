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

const valueClass =
  "min-w-0 flex-1 cursor-pointer appearance-none rounded-sm border-none bg-transparent text-[14.5px] leading-[1.6] text-foreground/70 outline-none hover:text-foreground/85";

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
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Preferences"
      className="absolute right-4 top-11 z-40 mt-1 w-[320px] rounded-lg border border-foreground/10 bg-popover p-2 shadow-xl"
    >
      <h2 className="px-1.5 pb-1 pt-0.5 text-[12px] uppercase tracking-wide text-foreground/30">
        Preferences
      </h2>
      <ThemeRow />
      <FontRow />
      <WidthRow />
      <ShowAllFieldsRow />
    </div>
  );
}

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefFieldRow icon={CircleHalf} label="theme">
      <select
        className={valueClass}
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
        className={valueClass}
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
        className={valueClass}
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
        <span className={valueClass}>Show all fields (debug)</span>
      </label>
    </PrefFieldRow>
  );
}
