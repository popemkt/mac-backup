import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Minimal localStorage + document stubs so the store persists in node. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
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

const g = globalThis as Record<string, unknown>;
let prefs: typeof import("./prefs.store");

beforeAll(async () => {
  g.localStorage = fakeStorage();
  g.document = fakeDocument();
  prefs = await import("./prefs.store");
});

afterAll(() => {
  delete g.localStorage;
  delete g.document;
});

describe("loadPrefs", () => {
  it("defaults when key is missing or malformed", () => {
    expect(prefs.loadPrefs(null)).toEqual(prefs.DEFAULT_PREFS);
    expect(prefs.loadPrefs("not json")).toEqual(prefs.DEFAULT_PREFS);
    expect(prefs.loadPrefs("42")).toEqual(prefs.DEFAULT_PREFS);
  });

  it("parses valid values and rejects unknown ones", () => {
    expect(
      prefs.loadPrefs('{"theme":"dark","font":"inter","width":"full"}'),
    ).toEqual({ theme: "dark", font: "inter", width: "full" });
    expect(
      prefs.loadPrefs('{"theme":"neon","font":"comic","width":"wide"}'),
    ).toEqual(prefs.DEFAULT_PREFS);
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
    const raw = (g.localStorage as Storage).getItem(prefs.PREFS_STORAGE_KEY);
    expect(JSON.parse(raw!)).toEqual({
      theme: "dark",
      font: "inter",
      width: "full",
    });
  });

  it("applies theme class + font attribute to <html>", () => {
    prefs.usePrefsStore.getState().setTheme("dark");
    const root = (
      g.document as { documentElement: { classList: { contains(n: string): boolean }; getAttribute(k: string): string | null } }
    ).documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.getAttribute("data-font")).toBe("inter");

    prefs.usePrefsStore.getState().setTheme("light");
    expect(root.classList.contains("dark")).toBe(false);
  });
});
