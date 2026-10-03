/**
 * The view widget: its gizmo looks from the side clicked, it names the view
 * it shows (the top view in 2D), and its menu sends the keymap's own view
 * commands.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { presetView, viewOfPan, type CanvasView } from "./canvas-camera";
import { CanvasCameraRig } from "./canvas-camera-rig";
import type { CanvasIntent } from "./canvas-keymap";
import { TIMING_FALLBACK } from "@/lib/timing";
import { CanvasViewWidget } from "./canvas-view-widget";

const size = { width: 800, height: 600 };
const flat = viewOfPan({ x: 0, y: 0 }, 1, size);

let root: Root;
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: "https://kb.test/" });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(view: CanvasView, in3d: boolean, selectionEmpty = true) {
  const rig = new CanvasCameraRig(view, TIMING_FALLBACK, true);
  const onIntent = vi.fn<(intent: CanvasIntent) => void>();
  function Host() {
    const [open, setOpen] = useState(false);
    return createElement(CanvasViewWidget, {
      rig,
      in3d,
      flatView: flat,
      projection: in3d ? "3d" : "2d",
      selectionEmpty,
      menuOpen: open,
      onMenuOpenChange: setOpen,
      onIntent,
    });
  }
  act(() => root.render(createElement(Host)));
  return { rig, onIntent };
}

const label = () =>
  container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")?.textContent ?? "";
const click = (el: Element | null | undefined) =>
  act(() => {
    (el as HTMLElement | null)?.click();
  });

describe("the canvas view widget", () => {
  it("in 2D shows the top view, and an axis end asks to look from that side", () => {
    const { onIntent } = mount(flat, false);
    expect(label()).toBe("Top · 2D");
    click(container.querySelector("[data-axis-end='+x']"));
    expect(onIntent).toHaveBeenCalledWith({ type: "look", preset: "right" });
    expect(container.querySelector<HTMLButtonElement>("[data-axis-end='-z']")?.disabled).toBe(true);
  });

  it("follows the 3D camera as it moves", () => {
    const deep = { ...flat, fov: 34, yaw: 0.3, pitch: 0.7 };
    const { rig } = mount(deep, true);
    expect(label()).toBe("Free · Perspective");
    act(() => rig.jump({ ...presetView(deep, "front"), fov: 0 }));
    expect(label()).toBe("Front · Orthographic");
  });

  it("opens a menu of the view commands, checking the current ones", () => {
    const { onIntent } = mount(flat, false);
    click(container.querySelector("[aria-haspopup=menu]"));
    const items = [...container.querySelectorAll<HTMLButtonElement>("[role^=menuitem]")];
    const named = (name: string) => items.find((item) => item.textContent.startsWith(name));
    expect(named("Top")?.getAttribute("aria-checked")).toBe("true");
    expect(named("2D")?.getAttribute("aria-checked")).toBe("true");
    expect(named("Frame selection")?.disabled).toBe(true);
    click(named("Front"));
    expect(onIntent).toHaveBeenCalledWith({ type: "look", preset: "front" });
    expect(container.querySelector("[role=menu]")).toBeNull();
  });
});
