import { useMemo } from "react";
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
  /**
   * The optional UI plugins switched on, by plugin name. Optional plugins are
   * off until named here; a name with no plugin behind it is inert, so a
   * plugin that ships later (or is removed) needs no migration.
   */
  enabledPlugins: readonly string[];
}

export const PREFS_STORAGE_KEY = "kb-prefs";

/**
 * `showAllFields` used to live here as one device-wide switch. Debug field
 * visibility is per node now (`stores/debug-fields.store`), so a stale key in
 * an existing payload is ignored on read and dropped on the next write.
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
  enabledPlugins: [],
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
  enabledPlugins: z.array(z.string()).catch([]),
});

/** The persisted preferences out of anything that carries them (the store state). */
function prefsOf(source: Prefs): Prefs {
  return {
    theme: source.theme,
    designSystem: source.designSystem,
    width: source.width,
    sidebarOpen: source.sidebarOpen,
    enabledPlugins: source.enabledPlugins,
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
  /** Switch one optional UI plugin on or off; the shell loads or unloads it. */
  setPluginEnabled: (name: string, enabled: boolean) => void;
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
    setPluginEnabled: (name, enabled) => {
      const others = get().enabledPlugins.filter((candidate) => candidate !== name);
      commit({ enabledPlugins: enabled ? [...others, name] : others });
    },
  };
});

/**
 * What the page is painted in, resolved: everything that changes the values
 * the design-system tokens hold. DOM styling follows a change by itself (every
 * utility is a live `var()`); canvas and WebGL renderers copied token values
 * out, so they re-read them whenever `key` changes. This is the one signal
 * they listen to.
 */
export interface Appearance {
  readonly designSystem: DesignSystemId;
  readonly dark: boolean;
  /** Changes exactly when any field above does. */
  readonly key: string;
}

function appearanceOf(designSystem: DesignSystemId, dark: boolean): Appearance {
  return { designSystem, dark, key: `${designSystem}:${dark ? "dark" : "light"}` };
}

export function useAppearance(): Appearance {
  const designSystem = usePrefsStore((s) => s.designSystem);
  const dark = usePrefsStore((s) => resolveDark(s.theme, s.systemDark));
  return useMemo(() => appearanceOf(designSystem, dark), [designSystem, dark]);
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
  // Wide, the sidebar docks and its open state is the device preference.
  // Narrow, it floats over the page and opens only for this visit.
  const narrow = useNarrowViewport();
  const docked = usePrefsStore((s) => s.sidebarOpen);
  const toggleDocked = usePrefsStore((s) => s.toggleSidebar);
  const overlay = useUiStore((s) => s.sidebarOverlayOpen);
  const setOverlay = useUiStore((s) => s.setSidebarOverlayOpen);
  const open = narrow ? overlay : docked;
  const toggle = narrow ? () => setOverlay(!overlay) : toggleDocked;
  return {
    open,
    onToggle: (button) => {
      const focusedInSidebar = document.activeElement?.closest(SIDEBAR_REGION_SELECTOR);
      toggle();
      if (open && focusedInSidebar) {
        requestAnimationFrame(() => button?.focus());
      }
    },
  };
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
