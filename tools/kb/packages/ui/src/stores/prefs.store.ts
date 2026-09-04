import { z } from "zod";
import { create } from "zustand";
import { hasText } from "@/lib/text";

/**
 * Device-level preferences (DESIGN-RESKIN §1.7): theme / font / width.
 * Persisted to localStorage["kb-prefs"] — device concern, never repo data.
 * index.html carries a blocking script that reads the same key pre-paint.
 */
export type ThemePref = "light" | "dark" | "system";
export type FontPref = "outfit" | "inter";
export type WidthPref = "centered" | "full";

export interface Prefs {
  theme: ThemePref;
  font: FontPref;
  width: WidthPref;
  /** Tana-style left rail. Absent in storage → viewport default (≥1024 open). */
  sidebarOpen: boolean;
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
  font: "inter",
  width: "centered",
  sidebarOpen: true,
};

/**
 * The stored payload is untrusted text. Each field falls back on its own, so
 * one unreadable value cannot reset the rest.
 */
const StoredPrefsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).catch(DEFAULT_PREFS.theme),
  font: z.enum(["outfit", "inter"]).catch(DEFAULT_PREFS.font),
  width: z.enum(["centered", "full"]).catch(DEFAULT_PREFS.width),
  sidebarOpen: z.boolean().optional().catch(undefined),
});

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
      theme: parsed.data.theme,
      font: parsed.data.font,
      width: parsed.data.width,
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

/** Push prefs onto <html>: .dark class + data-font / data-width attributes. */
export function applyPrefs(prefs: Prefs, systemDark = systemPrefersDark()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolveDark(prefs.theme, systemDark));
  root.setAttribute("data-font", prefs.font);
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
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        theme: prefs.theme,
        font: prefs.font,
        width: prefs.width,
        sidebarOpen: prefs.sidebarOpen,
      }),
    );
  } catch {
    // Quota / private mode — prefs stay in-memory for this session.
  }
}

interface PrefsState extends Prefs {
  setTheme: (theme: ThemePref) => void;
  setFont: (font: FontPref) => void;
  setWidth: (width: WidthPref) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const usePrefsStore = create<PrefsState>((set, get) => {
  const commit = (patch: Partial<Prefs>) => {
    set(patch);
    const { theme, font, width, sidebarOpen } = get();
    const prefs = { theme, font, width, sidebarOpen };
    writeStored(prefs);
    applyPrefs(prefs);
  };
  return {
    ...readStored(),
    setTheme: (theme) => commit({ theme }),
    setFont: (font) => commit({ font }),
    setWidth: (width) => commit({ width }),
    setSidebarOpen: (sidebarOpen) => commit({ sidebarOpen }),
    toggleSidebar: () => commit({ sidebarOpen: !get().sidebarOpen }),
  };
});

/**
 * One-time boot wiring: apply stored prefs, follow the OS theme while in
 * "system", and sync edits from other tabs. Call from main.tsx.
 */
export function initPrefs() {
  if (typeof window === "undefined") return;
  const current = () => {
    const { theme, font, width, sidebarOpen } = usePrefsStore.getState();
    return { theme, font, width, sidebarOpen };
  };
  applyPrefs(current());

  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", (e) => {
      applyPrefs(current(), e.matches);
    });
  }

  window.addEventListener("storage", (e) => {
    if (e.key !== PREFS_STORAGE_KEY) return;
    usePrefsStore.setState(loadPrefs(e.newValue));
    applyPrefs(current());
  });
}
