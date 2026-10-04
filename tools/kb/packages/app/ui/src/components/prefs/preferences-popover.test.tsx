/**
 * The plugins section of Preferences: one on/off row per optional extension,
 * showing what the server reports and asking for the switch, and no section
 * at all when there is nothing optional to switch.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { DESIGN_SYSTEMS } from "@/lib/theme";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { PreferencesPopover } from "./preferences-popover";

const off = [{ name: "extra", label: "Extra", on: false }];
const on = [{ name: "extra", label: "Extra", on: true }];

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
    useUiStore.getState().setPrefsOpen(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    useUiStore.getState().setPrefsOpen(false);
    dom.restore();
  });

  it("shows each optional extension as reported, and asks for the switch", () => {
    const asked: [string, boolean][] = [];
    const onSwitch = (name: string, next: boolean) => void asked.push([name, next]);
    act(() => root.render(createElement(PreferencesPopover, { switches: off, onSwitch })));
    const select = () =>
      present(
        container.querySelector<HTMLSelectElement>('[data-testid="plugin-extra"]'),
        "plugin row",
      );
    expect(container.textContent).toContain("Extra");
    expect(select().value).toBe("off");

    act(() => {
      select().value = "on";
      select().dispatchEvent(new dom.window.Event("change", { bubbles: true }) as unknown as Event);
    });
    expect(asked).toEqual([["extra", true]]);

    // The row shows what the server then reports, not what was asked.
    act(() => root.render(createElement(PreferencesPopover, { switches: on, onSwitch })));
    expect(select().value).toBe("on");
    act(() => {
      select().value = "off";
      select().dispatchEvent(new dom.window.Event("change", { bubbles: true }) as unknown as Event);
    });
    expect(asked).toEqual([
      ["extra", true],
      ["extra", false],
    ]);
  });

  it("offers one live swatch per design system and switches to the one clicked", () => {
    usePrefsStore.setState({ designSystem: "kb" });
    act(() => root.render(createElement(PreferencesPopover, { switches: [], onSwitch: () => {} })));
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
    act(() => root.render(createElement(PreferencesPopover, { switches: [], onSwitch: () => {} })));
    expect(container.querySelector('[aria-label="plugins"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
