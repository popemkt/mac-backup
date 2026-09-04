/**
 * ShapeCard wires the label-edit draft machine (Esc cancel / Enter commit).
 * Draft semantics are unit-tested in shape-label-edit.test.ts.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import type { CanvasShapeNode } from "@kb/canvas";
import { ShapeCard } from "./shape-card";

const baseCard: CanvasShapeNode = {
  id: "s1",
  type: "shape",
  shape: "rect",
  label: "Prior",
  x: 0,
  y: 0,
  width: 160,
  height: 100,
};

describe("ShapeCard label edit wiring", () => {
  let root: Root;
  let container: HTMLElement;

  beforeAll(() => {
    const win = new Window({ url: "https://kb.test/" });
    // @ts-expect-error happy-dom window bridge
    globalThis.window = win;
    globalThis.document = win.document as unknown as Document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.KeyboardEvent = win.KeyboardEvent as unknown as typeof KeyboardEvent;
    globalThis.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;
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

  it("double-click opens draft input seeded with card.label", () => {
    const onLabelChange = vi.fn();
    act(() => {
      root.render(
        <ShapeCard
          card={baseCard}
          selected
          onSelect={() => {}}
          onLabelChange={onLabelChange}
          onMoveStart={() => {}}
          onResizeStart={() => {}}
          onPortDown={() => {}}
        />,
      );
    });

    const shell = present(container.querySelector(".group\\/card"), "card shell");
    act(() => {
      shell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    const input = container.querySelector('[data-testid="shape-label-input"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("Prior");
    expect(onLabelChange).not.toHaveBeenCalled();
  });
});
