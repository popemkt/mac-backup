import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { present } from "@kb/model";
import type { LensTreeNode } from "@/lib/graph-lens";
import type { GraphCameraControls } from "./graph-camera-controls";
import { TreeGraph } from "./tree-graph";

let dom: Window, container: HTMLDivElement, root: Root;
beforeAll(() => {
  dom = new Window();
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperties(dom.HTMLElement.prototype, {
    clientWidth: { get: () => 900 },
    clientHeight: { get: () => 600 },
  });
  Object.defineProperty(dom.document, "fonts", { value: { ready: Promise.resolve() } });
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const branch = (id: string, children: LensTreeNode[] = []): LensTreeNode => ({
  id,
  label: id,
  color: "#123456",
  size: 5,
  children,
});

it("keeps zoom and the clicked branch at the same screen position through collapse and expansion", async () => {
  let controls: GraphCameraControls | null = null;
  await act(async () =>
    root.render(
      createElement(TreeGraph, {
        forest: [
          branch("root", [
            branch("branch", [branch("leaf-a"), branch("leaf-b")]),
            branch("sibling"),
          ]),
        ],
        themeKey: "light",
        onControlsReady: (value) => {
          controls = value;
        },
      }),
    ),
  );
  act(() => present(controls, "tree controls").zoomIn());
  const point = () => {
    const svg = present(container.querySelector("svg"), "tree svg");
    const node = present(container.querySelector('[data-node-id="branch"]'), "branch");
    const outer = present(
      svg.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/),
      "camera transform",
    );

    const origin = coords(present(svg.querySelector("g"), "origin")),
      position = coords(node);
    const zoom = Number(outer[3]);
    return {
      zoom,
      x: Number(outer[1]) + (Number(origin[1]) + Number(position[1])) * zoom,
      y: Number(outer[2]) + (Number(origin[2]) + Number(position[2])) * zoom,
    };
  };
  const before = point();
  for (const label of ["Collapse branch", "Expand branch"]) {
    const toggle = present(container.querySelector('[aria-label="' + label + '"]'), label);
    act(() => {
      toggle.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as MouseEvent);
    });
    const after = point();
    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(container.querySelector('[data-node-id="leaf-a"]') === null).toBe(
      label === "Collapse branch",
    );
  }
});

const coords = (el: Element) =>
  present(
    el.getAttribute("transform")?.match(/translate\(([-\d.]+),([-\d.]+)\)/),
    "node transform",
  );
