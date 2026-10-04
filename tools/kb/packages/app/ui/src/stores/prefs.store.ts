import { z } from "zod";
import { create } from "zustand";
import { SIDEBAR_REGION_SELECTOR } from "@/lib/dom";
import { hasText } from "@/lib/text";
import { useNarrowViewport } from "@/lib/viewport";
import { useUiStore } from "@/stores/ui.store";
import { transitionTheme } from "@/lib/theme-transition";

/**
 * Device-level preferences (DESIGN-RESKIN §1.7): theme / design system /
 * width, the sidebar, and which optional UI plugins are switched on.
 * Persisted to localStorage["kb-prefs"] — device concern, never repo data.
 * index.html carries a blocking script that reads the same key pre-paint.
 */
import {
  DEFAULT_DESIGN_SYSTEM,
  DESIGN_SYSTEM_IDS,
  THEMES,
  WIDTHS,
  appearanceOf,
  type Appearance,
  type DesignSystemId,
  type ThemePref,
  type WidthPref,
} from "@/lib/theme";
export type { ThemePref, WidthPref } from "@/lib/theme";

export interface Prefs {
  theme: ThemePref;
  /**
   * Which design system paints the page: every layer-1 value, faces
   * included. The UI face used to be a pref of its own (`font`); a face is a
   * design-system value, so a stale `font` key is ignored on read and
   * dropped on the next write.
   */
  designSystem: DesignSystemId;
  width: WidthPref;
  /** Tana-style left rail. Absent in storage → viewport default (≥1024 open). */
  sidebarOpen: boolean;
}

export const PREFS_STORAGE_KEY = "kb-prefs";

/**
 * `showAllFields` used to live here as one device-wide switch. Debug field
 * visibility is per node now (`stores/debug-fields.store`), so a stale key in
 * an existing payload is ignored on read and dropped on the next write.
 *
 * `enabledPlugins` went the same way: whether an optional extension is on is
 * the server's decision now (`extension.switch`), not the device's.
 */

/** Default open on large viewports; closed on narrow (first visit / missing key). */
export function defaultSidebarOpen(
  widthPx: number | null = typeof window !== "undefined" ? window.innerWidth : null,
): boolean {
  // `?? 1024` (not `=== null`): happy-dom leaves window.innerWidth undefined,
  // which the `number | null` annotation does not admit but the runtime does.
  return (widthPx ?? 1024) >= 1024;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  designSystem: DEFAULT_DESIGN_SYSTEM,
  width: "centered",
  sidebarOpen: true,
};

/**
 * The stored payload is untrusted text. Each field falls back on its own, so
 * one unreadable value cannot reset the rest.
 */
const StoredPrefsSchema = z.object({
  theme: z.enum(THEMES).catch(DEFAULT_PREFS.theme),
  designSystem: z.enum(DESIGN_SYSTEM_IDS).catch(DEFAULT_PREFS.designSystem),
  width: z.enum(WIDTHS).catch(DEFAULT_PREFS.width),
  sidebarOpen: z.boolean().optional().catch(undefined),
});

/** The persisted preferences out of anything that carries them (the store state). */
function prefsOf(source: Prefs): Prefs {
  return {
    theme: source.theme,
    designSystem: source.designSystem,
    width: source.width,
    sidebarOpen: source.sidebarOpen,
  };
}

/** Parse a raw localStorage payload; unknown values fall back to defaults. */
export function loadPrefs(
  raw: string | null,
  viewportWidth: number | null = typeof window !== "undefined" ? window.innerWidth : null,
): Prefs {
  if (!hasText(raw)) {
    return { ...DEFAULT_PREFS, sidebarOpen: defaultSidebarOpen(viewportWidth) };
  }
  try {
    const parsed = StoredPrefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { ...DEFAULT_PREFS, sidebarOpen: defaultSidebarOpen(viewportWidth) };
    }
    return {
      ...parsed.data,
      sidebarOpen: parsed.data.sidebarOpen ?? defaultSidebarOpen(viewportWidth),
    };
  } catch {
    return { ...DEFAULT_PREFS, sidebarOpen: defaultSidebarOpen(viewportWidth) };
  }
}

/** Resolve the effective dark flag from the theme pref + system preference. */
export function resolveDark(theme: ThemePref, systemDark: boolean): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemDark;
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Push prefs onto <html>: .dark class + data-theme / data-width attributes. */
export function applyPrefs(prefs: Prefs, systemDark = systemPrefersDark()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolveDark(prefs.theme, systemDark));
  root.setAttribute("data-theme", prefs.designSystem);
  root.setAttribute("data-width", prefs.width);
}

function readStored(): Prefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREFS };
  try {
    return loadPrefs(localStorage.getItem(PREFS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeStored(prefs: Prefs) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefsOf(prefs)));
  } catch {
    // Quota / private mode — prefs stay in-memory for this session.
  }
}

interface PrefsState extends Prefs {
  /** Live device signal, never persisted as an intentional preference. */
  systemDark: boolean;
  setTheme: (theme: ThemePref) => void;
  setDesignSystem: (designSystem: DesignSystemId) => void;
  setWidth: (width: WidthPref) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const usePrefsStore = create<PrefsState>((set, get) => {
  const commit = (patch: Partial<Prefs>) => {
    set(patch);
    const prefs = prefsOf(get());
    writeStored(prefs);
    applyPrefs(prefs);
  };
  return {
    ...readStored(),
    systemDark: systemPrefersDark(),
    setTheme: (theme) => {
      const dark = resolveDark(theme, systemPrefersDark());
      const changesAppearance =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark") !== dark;
      transitionTheme(() => commit({ theme }), changesAppearance);
    },
    setDesignSystem: (designSystem) => {
      const changesAppearance =
        typeof document !== "undefined" &&
        document.documentElement.getAttribute("data-theme") !== designSystem;
      transitionTheme(() => commit({ designSystem }), changesAppearance);
    },
    setWidth: (width) => commit({ width }),
    setSidebarOpen: (sidebarOpen) => commit({ sidebarOpen }),
    toggleSidebar: () => commit({ sidebarOpen: !get().sidebarOpen }),
  };
});

let lastAppearance: Appearance | null = null;

/**
 * The page's appearance in `state`: the same object while its key holds, so
 * a reader that compares by identity (a selector, `useSyncExternalStore`, a
 * memo) sees a change only when there was one.
 */
export function appearanceIn(
  state: Pick<PrefsState, "designSystem" | "theme" | "systemDark">,
): Appearance {
  const next = appearanceOf(state.designSystem, resolveDark(state.theme, state.systemDark));
  if (lastAppearance === null || lastAppearance.key !== next.key) {
    lastAppearance = next;
    return next;
  }
  return lastAppearance;
}

export function useAppearance(): Appearance {
  return usePrefsStore(appearanceIn);
}

/**
 * The left-rail toggle's state and gesture, for the primitive that renders it
 * (`components/ui/sidebar-toggle`).
 *
 * Two headers render that button — the shell's and the graph page's — so the
 * wiring has one home. The focus hand-off lives here rather than in the button
 * because it is about the panel going away, not about the button: collapsing a
 * sidebar that holds focus would otherwise drop focus on the document.
 */
export function useSidebarToggle(): {
  open: boolean;
  onToggle: (button: HTMLButtonElement | null) => void;
} {
  const narrow = useNarrowViewport();
  const docked = usePrefsStore((s) => s.sidebarOpen);
  const overlay = useUiStore((s) => s.sidebarOverlayOpen);
  const open = sidebarOpenOf(narrow, docked, overlay);
  return { open, onToggle: (button) => toggleSidebarFrom(narrow, open, button) };
}

/**
 * Whether the left rail is open. Wide, the sidebar docks and its open state
 * is the device preference; narrow, it floats over the page and opens only
 * for this visit.
 */
function sidebarOpenOf(narrow: boolean, docked: boolean, overlay: boolean): boolean {
  return narrow ? overlay : docked;
}

/** Whether the left rail is open now, for a reader outside React. */
export function sidebarOpenIn(narrow: boolean): boolean {
  return sidebarOpenOf(
    narrow,
    usePrefsStore.getState().sidebarOpen,
    useUiStore.getState().sidebarOverlayOpen,
  );
}

/** Toggle the left rail from its button, which was drawn with the rail `open`. */
export function toggleSidebarFrom(
  narrow: boolean,
  open: boolean,
  button: HTMLButtonElement | null,
): void {
  const focusedInSidebar = document.activeElement?.closest(SIDEBAR_REGION_SELECTOR);
  if (narrow) useUiStore.getState().setSidebarOverlayOpen(!open);
  else usePrefsStore.getState().toggleSidebar();
  if (open && focusedInSidebar) {
    requestAnimationFrame(() => button?.focus());
  }
}

/**
 * One-time boot wiring: apply stored prefs, follow the OS theme while in
 * "system", and sync edits from other tabs. Call from main.tsx.
 */
export function initPrefs() {
  if (typeof window === "undefined") return;
  const current = () => prefsOf(usePrefsStore.getState());
  usePrefsStore.setState({ systemDark: systemPrefersDark() });
  applyPrefs(current());

  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", (e) => {
      usePrefsStore.setState({ systemDark: e.matches });
      applyPrefs(current(), e.matches);
    });
  }

  window.addEventListener("storage", (e) => {
    if (e.key !== PREFS_STORAGE_KEY) return;
    usePrefsStore.setState(loadPrefs(e.newValue));
    applyPrefs(current());
  });
}
