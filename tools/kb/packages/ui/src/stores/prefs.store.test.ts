import type * as PrefsStore from "./prefs.store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { present } from "@kb/model";

/** Minimal localStorage + document stubs so the store persists in node. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

function fakeDocument() {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  return {
    documentElement: {
      classList: {
        toggle: (name: string, force: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
          return force;
        },
        contains: (name: string) => classes.has(name),
      },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    },
  };
}

function fakeWindow() {
  type StorageHandler = (e: { type: string; key: string | null; newValue: string | null }) => void;
  const listeners = new Map<string, Set<StorageHandler>>();
  return {
    addEventListener(type: string, handler: StorageHandler) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
    },
    removeEventListener(type: string, handler: StorageHandler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event: { type: string; key: string | null; newValue: string | null }) {
      for (const handler of listeners.get(event.type) ?? []) {
        handler(event);
      }
      return true;
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  };
}

const g = globalThis as Record<string, unknown>;
let prefs: typeof PrefsStore;

beforeAll(async () => {
  g.localStorage = fakeStorage();
  g.document = fakeDocument();
  g.window = fakeWindow();
  prefs = await import("./prefs.store");
});

afterAll(() => {
  delete g.localStorage;
  delete g.document;
  delete g.window;
});

describe("loadPrefs", () => {
  it("defaults when key is missing or malformed", () => {
    expect(prefs.loadPrefs(null)).toEqual(prefs.DEFAULT_PREFS);
    expect(prefs.loadPrefs("not json")).toEqual(prefs.DEFAULT_PREFS);
    expect(prefs.loadPrefs("42")).toEqual(prefs.DEFAULT_PREFS);
  });

  it("parses valid values and rejects unknown ones", () => {
    expect(
      prefs.loadPrefs('{"theme":"dark","font":"inter","width":"full","sidebarOpen":false}', 1280),
    ).toEqual({
      theme: "dark",
      font: "inter",
      width: "full",
      sidebarOpen: false,
    });
    expect(prefs.loadPrefs('{"theme":"neon","font":"comic","width":"wide"}', 1280)).toEqual({
      ...prefs.DEFAULT_PREFS,
      sidebarOpen: true,
    });
  });

  it("ignores a stale showAllFields key (debug visibility is per node now)", () => {
    // The device-wide switch is gone; a payload written by an older build must
    // not resurrect it as a pref, and must not fail to parse either.
    const loaded = prefs.loadPrefs('{"theme":"dark","showAllFields":true}', 1280);
    expect(loaded).toEqual({ ...prefs.DEFAULT_PREFS, theme: "dark" });
    expect("showAllFields" in loaded).toBe(false);
  });

  it("defaults sidebarOpen from viewport when key is absent", () => {
    expect(prefs.defaultSidebarOpen(1280)).toBe(true);
    expect(prefs.defaultSidebarOpen(800)).toBe(false);
    expect(prefs.loadPrefs(null, 800).sidebarOpen).toBe(false);
    expect(prefs.loadPrefs('{"theme":"system"}', 1280).sidebarOpen).toBe(true);
  });
});

describe("resolveDark", () => {
  it("explicit themes ignore the system preference", () => {
    expect(prefs.resolveDark("dark", false)).toBe(true);
    expect(prefs.resolveDark("light", true)).toBe(false);
  });

  it("system follows the media query", () => {
    expect(prefs.resolveDark("system", true)).toBe(true);
    expect(prefs.resolveDark("system", false)).toBe(false);
  });
});

describe("usePrefsStore", () => {
  it("persists setter changes to localStorage[kb-prefs]", () => {
    prefs.usePrefsStore.getState().setTheme("dark");
    prefs.usePrefsStore.getState().setFont("inter");
    prefs.usePrefsStore.getState().setWidth("full");
    prefs.usePrefsStore.getState().setSidebarOpen(false);
    const raw = (g.localStorage as Storage).getItem(prefs.PREFS_STORAGE_KEY);
    expect(JSON.parse(present(raw, "raw json"))).toEqual({
      theme: "dark",
      font: "inter",
      width: "full",
      sidebarOpen: false,
    });
  });

  it("toggleSidebar persists collapse state", () => {
    prefs.usePrefsStore.getState().setSidebarOpen(true);
    prefs.usePrefsStore.getState().toggleSidebar();
    expect(prefs.usePrefsStore.getState().sidebarOpen).toBe(false);
    const raw = (g.localStorage as Storage).getItem(prefs.PREFS_STORAGE_KEY);
    expect(JSON.parse(present(raw, "raw json")).sidebarOpen).toBe(false);
  });

  it("applies theme class + font attribute to <html>", () => {
    prefs.usePrefsStore.getState().setTheme("dark");
    const root = (
      g.document as {
        documentElement: {
          classList: { contains(n: string): boolean };
          getAttribute(k: string): string | null;
        };
      }
    ).documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.getAttribute("data-font")).toBe("inter");
    expect(root.getAttribute("data-width")).toBe("full");

    prefs.usePrefsStore.getState().setTheme("light");
    expect(root.classList.contains("dark")).toBe(false);
  });
});

describe("initPrefs cross-tab sync", () => {
  it("storage event updates store state and re-applies html attrs", () => {
    (g.localStorage as Storage).setItem(
      prefs.PREFS_STORAGE_KEY,
      JSON.stringify({ theme: "dark", font: "inter", width: "full" }),
    );

    prefs.initPrefs();

    (g.localStorage as Storage).setItem(
      prefs.PREFS_STORAGE_KEY,
      JSON.stringify({ theme: "light", font: "outfit", width: "centered" }),
    );

    (g.window as ReturnType<typeof fakeWindow>).dispatchEvent({
      type: "storage",
      key: prefs.PREFS_STORAGE_KEY,
      newValue: '{"theme":"light","font":"outfit","width":"centered"}',
    });

    expect(prefs.usePrefsStore.getState()).toMatchObject({
      theme: "light",
      font: "outfit",
      width: "centered",
    });

    const root = (
      g.document as {
        documentElement: {
          classList: { contains(n: string): boolean };
          getAttribute(k: string): string | null;
        };
      }
    ).documentElement;
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.getAttribute("data-font")).toBe("outfit");
    expect(root.getAttribute("data-width")).toBe("centered");
  });
});
