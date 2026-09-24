/**
 * The plugins section of Preferences: one on/off row per optional plugin,
 * bound to the `enabledPlugins` preference, and no section at all when there
 * is nothing optional to switch.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { GearIcon } from "@phosphor-icons/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { definePlugin } from "@kb/plugin";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { DESIGN_SYSTEMS } from "@/lib/theme";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { PreferencesPopover } from "./preferences-popover";

const extra = definePlugin({ name: "extra", apply: () => Effect.void });
const OPTIONAL = [{ plugin: extra, label: "extra", icon: GearIcon }];

describe("PreferencesPopover plugins", () => {
  let dom: InstalledDom;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    usePrefsStore.setState({ enabledPlugins: [] });
    useUiStore.getState().setPrefsOpen(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    useUiStore.getState().setPrefsOpen(false);
    dom.restore();
  });

  it("lists each optional plugin as off by default, and switches it on and off", () => {
    act(() => root.render(createElement(PreferencesPopover, { plugins: OPTIONAL })));
    const select = present(
      container.querySelector<HTMLSelectElement>('[data-testid="plugin-extra"]'),
      "plugin row",
    );
    expect(select.value).toBe("off");

    act(() => {
      select.value = "on";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }) as unknown as Event);
    });
    expect(usePrefsStore.getState().enabledPlugins).toEqual(["extra"]);
    expect(select.value).toBe("on");

    act(() => {
      select.value = "off";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }) as unknown as Event);
    });
    expect(usePrefsStore.getState().enabledPlugins).toEqual([]);
  });

  it("offers one live swatch per design system and switches to the one clicked", () => {
    usePrefsStore.setState({ designSystem: "kb" });
    act(() => root.render(createElement(PreferencesPopover, { plugins: [] })));
    const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.dataset.testid)).toEqual(
      DESIGN_SYSTEMS.map((system) => `design-system-${system.id}`),
    );
    // Each sample is painted by its own system's stylesheet, not by a copy.
    expect(radios.map((r) => r.querySelector("[data-theme]")?.getAttribute("data-theme"))).toEqual(
      DESIGN_SYSTEMS.map((system) => system.id),
    );
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    act(() => present(radios[1], "second swatch").click());
    expect(usePrefsStore.getState().designSystem).toBe(DESIGN_SYSTEMS[1]?.id);
    expect(
      container
        .querySelector(`[data-testid="design-system-${DESIGN_SYSTEMS[1]?.id}"]`)
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("has no plugins section when nothing is optional", () => {
    act(() => root.render(createElement(PreferencesPopover, { plugins: [] })));
    expect(container.querySelector('[aria-label="plugins"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
