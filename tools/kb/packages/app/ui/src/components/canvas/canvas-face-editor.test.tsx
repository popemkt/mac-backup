/**
 * Editing a face in 3D (`canvas-face-editor`): the item's own editor opens
 * with focus, lies on the face as the camera draws it and follows every move
 * of the camera, writes through the page, and says when it closes.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CanvasNode, CanvasTextNode } from "@kb/canvas";
import { CanvasCameraRig } from "./canvas-camera-rig";
import { CanvasFaceEditor } from "./canvas-face-editor";
import { hasEditor } from "./canvas-face-overlay";
import { TIMING_FALLBACK } from "@/lib/timing";

const card: CanvasTextNode = {
  id: "c",
  type: "text",
  text: "words",
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  rotation: { x: -30, z: 20 },
};
const size = { width: 1000, height: 700 };

describe("a face's editor in 3D", () => {
  let root: Root;
  let container: HTMLElement;
  let dom: InstalledDom;

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => dom.restore());

  function mount(item: CanvasNode = card) {
    const rig = new CanvasCameraRig(
      { x: 100, y: 40, z: 0, zoom: 1, yaw: 0.3, pitch: 0.7, fov: 34 },
      TIMING_FALLBACK,
      true,
    );
    const edits: string[] = [];
    const writes: CanvasNode[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <CanvasFaceEditor
          item={item}
          rig={rig}
          size={() => size}
          onEdit={(id, on) => edits.push(`${id}:${on ? "open" : "closed"}`)}
          onChange={(next) => writes.push(next)}
        />,
      ),
    );
    const laid = container.querySelector<HTMLElement>("[data-face-editor] > div");
    return { rig, edits, writes, laid };
  }

  const unmount = () => {
    act(() => root.unmount());
    container.remove();
  };

  test("only an item with words of its own, a label or a node has an editor", () => {
    expect(hasEditor(card)).toBe(true);
    expect(hasEditor({ id: "f", type: "group", x: 0, y: 0, width: 1, height: 1 })).toBe(false);
    // GAP [canvas-card-activation]: a card's node text cannot take the caret on a canvas.
    expect(
      hasEditor({ id: "k", type: "kb-node", nodeId: "n", x: 0, y: 0, width: 1, height: 1 }),
    ).toBe(false);
    expect(
      hasEditor({ id: "i", type: "file", file: "assets/a.png", x: 0, y: 0, width: 1, height: 1 }),
    ).toBe(false);
  });

  test("it opens with focus, its caret after the words, and says so", () => {
    const { edits } = mount();
    const field = container.querySelector("textarea");
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe("words".length);
    expect(edits).toEqual(["c:open"]);
    act(() => field?.blur());
    expect(edits).toEqual(["c:open", "c:closed"]);
    unmount();
  });

  test("it lies on the face and follows the camera", () => {
    const { rig, laid } = mount();
    const before = laid?.style.transform ?? "";
    expect(before).toMatch(/^matrix3d\(/);
    act(() => rig.orbitBy(40, -20));
    expect(laid?.style.transform).toMatch(/^matrix3d\(/);
    expect(laid?.style.transform).not.toBe(before);
    unmount();
  });

  test("seen from behind it is not shown, but keeps its focus and stays open", () => {
    const facedDown: CanvasNode = { ...card, rotation: { x: 180 } };
    const { rig, edits, laid } = mount(facedDown);
    act(() => rig.jump({ ...rig.view, pitch: 0, yaw: 0 }));
    expect(laid?.style.opacity).toBe("0");
    expect(laid?.style.pointerEvents).toBe("none");
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    expect(edits).toEqual(["c:open"]);
    unmount();
  });

  test("a shape's editor is its label field, open, and Escape closes it", () => {
    const shape: CanvasNode = {
      id: "s",
      type: "shape",
      shape: "sphere",
      label: "Sphere",
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      depth: 120,
    };
    const { edits } = mount(shape);
    const input = container.querySelector<HTMLInputElement>('[data-testid="shape-label-input"]');
    expect(input?.value).toBe("Sphere");
    expect(document.activeElement).toBe(input);
    act(() => {
      input?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(edits.at(-1)).toBe("s:closed");
    unmount();
  });
});
