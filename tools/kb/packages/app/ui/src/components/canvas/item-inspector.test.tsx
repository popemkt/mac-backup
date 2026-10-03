/**
 * The item inspector edits where any item stands and how far it rises:
 * Extrude makes a flat item a block, Flatten lays it back, and the fields
 * commit one change each.
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { ItemInspector } from "./item-inspector";

const sticky: CanvasNode = {
  id: "s",
  type: "text",
  text: "idea",
  x: 0,
  y: 0,
  width: 220,
  height: 80,
};

/** The value in the inspector's field labelled `label`. */
const fieldValue = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label='${label}']`)?.value;

/** The inspector's button reading `label`. */
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === label);

describe("item inspector", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();

  beforeAll(() => {
    const dom = new Window({ url: "https://kb.test/" });
    const globals: Record<string, unknown> = {
      window: dom,
      document: dom.document,
      HTMLElement: dom.HTMLElement,
      Node: dom.Node,
      getComputedStyle: dom.getComputedStyle.bind(dom),
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  test("extrude makes a sticky a block, a typed depth commits once, flatten lays it back", () => {
    const changes: CanvasNode[] = [];
    function Host() {
      const [item, setItem] = useState(sticky);
      return createElement(ItemInspector, {
        item,
        anchor: { x: 200, y: 100 },
        onClose: () => {},
        onChange: (next: CanvasNode) => {
          changes.push(next);
          setItem(next);
        },
      });
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Host)));
    act(() => button("Extrude")?.click());
    expect(changes.at(-1)).toMatchObject({ depth: 40 });
    expect(document.body.textContent).toContain("Block");
    const depth = document.querySelector<HTMLInputElement>("input[aria-label='Depth']");
    expect(depth?.value).toBe("40");
    act(() => button("Flatten")?.click());
    expect(changes.at(-1)).not.toHaveProperty("depth");
    expect(changes).toHaveLength(2);
    act(() => root.unmount());
    container.remove();
  });

  test("the rotation row shows each angle the item is turned by, 0 for an absent one", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(ItemInspector, {
          item: { ...sticky, rotation: { x: 10, z: -45 } },
          anchor: { x: 200, y: 100 },
          onClose: () => {},
          onChange: () => {},
        }),
      ),
    );
    expect([fieldValue("X"), fieldValue("Y"), fieldValue("Z")]).toEqual(["10", "0", "-45"]);
    act(() => root.unmount());
    container.remove();
  });
});
