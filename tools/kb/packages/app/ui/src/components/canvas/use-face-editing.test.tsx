/**
 * Which item's editor is open (`use-face-editing`): one state the showing
 * projection edits; a double-click in 3D enters a group first, then opens an
 * item's editor and looks at its face face-on, and the camera comes back
 * when the editor closes — unless it was taken elsewhere meanwhile.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
import { CanvasCameraRig } from "./canvas-camera-rig";
import { useFaceEditing } from "./use-face-editing";

const card: CanvasNode = {
  id: "c",
  type: "text",
  text: "",
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  rotation: { x: -40 },
};
const frame: CanvasNode = { id: "f", type: "group", x: -50, y: -50, width: 400, height: 300 };
const start = { x: 600, y: 400, z: 0, zoom: 0.5, yaw: 1, pitch: 0.6, fov: 34 };

describe("which item's editor is open", () => {
  let dom: InstalledDom;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());

  function mount(in3d: boolean, entered: (item: CanvasNode) => boolean = () => false) {
    const rig = new CanvasCameraRig(start, TIMING_FALLBACK, true);
    const seen: { faces?: ReturnType<typeof useFaceEditing> } = {};
    const selected: string[] = [];
    function Probe({ deep }: { deep: boolean }) {
      const faces = useFaceEditing({
        byId: new Map([
          [card.id, card],
          [frame.id, frame],
        ]),
        in3d: deep,
        rig,
        size: () => ({ width: 1000, height: 700 }),
        settled: () => {},
        select: (id) => selected.push(id),
        enter: entered,
      });
      useEffect(() => {
        seen.faces = faces;
      });
      return null;
    }
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<Probe deep={in3d} />));
    const show = (deep: boolean) => act(() => root.render(<Probe deep={deep} />));
    return { rig, seen, selected, show };
  }

  test("a double-click in 3D opens the item's editor and looks at it face-on, then back", () => {
    const { rig, seen, selected } = mount(true);
    act(() => {
      seen.faces?.doubleClick(card);
    });
    expect(selected).toEqual(["c"]);
    expect(seen.faces?.deep?.id).toBe("c");
    expect(seen.faces?.flat).toBeNull();
    expect(rig.view.pitch).not.toBe(start.pitch);
    act(() => seen.faces?.onEdit("c", false));
    expect(seen.faces?.deep).toBeNull();
    expect(rig.view).toEqual(start);
    act(() => root.unmount());
  });

  test("a camera taken elsewhere while editing stays where it was taken", () => {
    const { rig, seen } = mount(true);
    act(() => {
      seen.faces?.doubleClick(card);
    });
    act(() => rig.orbitBy(50, 0));
    const moved = rig.view;
    act(() => seen.faces?.onEdit("c", false));
    expect(rig.view).toEqual(moved);
    act(() => root.unmount());
  });

  test("a double-click enters a group first, and an item with no editor opens none", () => {
    const { seen, selected } = mount(true, (item) => item.id === "c");
    let went = false;
    act(() => {
      went = seen.faces?.doubleClick(card) ?? false;
    });
    expect(went).toBe(true);
    expect(seen.faces?.deep).toBeNull();
    act(() => {
      went = seen.faces?.doubleClick(frame) ?? true;
    });
    expect(went).toBe(false);
    expect(selected).toEqual([]);
    act(() => root.unmount());
  });

  test("an editor whose item is gone is closed, so its return opens nothing", () => {
    const { seen } = mount(false);
    act(() => seen.faces?.onEdit("gone", true));
    expect(seen.faces?.flat).toBeNull();
    act(() => root.unmount());
  });

  test("leaving 3D hands the edit to 2D, and the hidden 3D camera is not flown back", () => {
    const { rig, seen, show } = mount(true);
    act(() => {
      seen.faces?.doubleClick(card);
    });
    const faced = rig.view;
    show(false);
    expect(seen.faces?.deep).toBeNull();
    expect(seen.faces?.flat).toBe("c");
    act(() => seen.faces?.onEdit("c", false));
    expect(rig.view).toEqual(faced);
    act(() => root.unmount());
  });

  test("in 2D the editor is the 2D canvas's", () => {
    const { seen } = mount(false);
    act(() => seen.faces?.onEdit("c", true));
    expect(seen.faces?.flat).toBe("c");
    expect(seen.faces?.deep).toBeNull();
    act(() => root.unmount());
  });
});
