import { useEffect, useRef } from "react";
import {
  ArrowsHorizontal,
  CircleHalf,
  TextAa,
  type Icon,
} from "@phosphor-icons/react";
import {
  usePrefsStore,
  type FontPref,
  type ThemePref,
  type WidthPref,
} from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

/**
 * Device preferences popover (DESIGN-RESKIN §1.7). Floating panel under the
 * header button; rows use the nxus field-row anatomy — 24px icon slot,
 * 120px label at foreground/35, borderless value — so settings read like
 * editing a node's fields. Every change applies instantly.
 */
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
    </div>
  );
}

function PrefRow({
  icon: IconCmp,
  label,
  children,
}: {
  icon: Icon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-6 items-center py-1">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[13px] text-foreground/25">
        <IconCmp size={14} />
      </span>
      <span className="w-[120px] shrink-0 truncate text-[14.5px] font-medium text-foreground/35">
        {label}
      </span>
      {children}
    </label>
  );
}

const valueClass =
  "min-w-0 flex-1 cursor-pointer appearance-none rounded-sm border-none bg-transparent text-[14.5px] text-foreground/70 outline-none hover:text-foreground/85";

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefRow icon={CircleHalf} label="theme">
      <select
        className={valueClass}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemePref)}
      >
        <option value="system">system</option>
        <option value="light">light</option>
        <option value="dark">dark</option>
      </select>
    </PrefRow>
  );
}

function FontRow() {
  const font = usePrefsStore((s) => s.font);
  const setFont = usePrefsStore((s) => s.setFont);
  return (
    <PrefRow icon={TextAa} label="font">
      <select
        className={valueClass}
        value={font}
        onChange={(e) => setFont(e.target.value as FontPref)}
      >
        <option value="outfit">Outfit</option>
        <option value="inter">Inter</option>
      </select>
    </PrefRow>
  );
}

function WidthRow() {
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <PrefRow icon={ArrowsHorizontal} label="width">
      <select
        className={valueClass}
        value={width}
        onChange={(e) => setWidth(e.target.value as WidthPref)}
      >
        <option value="centered">centered</option>
        <option value="full">full</option>
      </select>
    </PrefRow>
  );
}
