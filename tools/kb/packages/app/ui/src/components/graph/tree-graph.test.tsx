import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
        appearance: { designSystem: "kb", dark: false, key: "kb:light" },
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
    // The origin group is placed by its attribute, a node by its (eased) style.
    `${el.getAttribute("transform") ?? ""} ${el.getAttribute("style") ?? ""}`.match(
      /translate\(([-\d.]+)(?:px)?,\s*([-\d.]+)(?:px)?\)/,
    ),
    "node transform",
  );

/** A forest past the open-whole budget: a root, `children` children, 6 leaves each. */
const bigForest = (prefix: string, children = 10): LensTreeNode[] => [
  branch(
    prefix,
    Array.from({ length: children }, (_child, c) =>
      branch(
        `${prefix}-${c}`,
        Array.from({ length: 6 }, (_leaf, l) => branch(`${prefix}-${c}-${l}`)),
      ),
    ),
  ),
];

describe("the tree's fold belongs to the view", () => {
  const appearance = { designSystem: "kb" as const, dark: false, key: "kb:light" };
  const show = (forest: LensTreeNode[], viewKey: string) =>
    act(async () => root.render(createElement(TreeGraph, { forest, viewKey, appearance })));
  const visible = (id: string) => container.querySelector(`[data-node-id="${id}"]`) !== null;
  const expand = (id: string) => {
    const toggle = present(container.querySelector(`[aria-label="Expand ${id}"]`), `expand ${id}`);
    act(() => {
      toggle.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as MouseEvent);
    });
  };

  it("keeps the user's fold through a store write that adds and removes nodes, folding only the new", async () => {
    await show(bigForest("a"), "view-1");
    expect(visible("a-0")).toBe(true);
    expect(visible("a-0-0")).toBe(false);
    expand("a-0");
    expect(visible("a-0-0")).toBe(true);
    // A store write adds a branch (a-10) and drops another (a-9): same view.
    const written = bigForest("a", 11).map((top) => ({
      ...top,
      children: top.children.filter((child) => child.id !== "a-9"),
    }));
    await show(written, "view-1");
    expect(visible("a-0-0")).toBe(true);
    expect(visible("a-10")).toBe(true);
    expect(visible("a-10-0")).toBe(false);
  });

  it("leaves what is on screen alone when a write crosses the open-whole budget, with no gesture", async () => {
    // 5 branches of 6 leaves: 36 nodes, opened whole.
    await show(bigForest("a", 5), "view-1");
    expect(visible("a-0-0")).toBe(true);
    // A write adds branches past 60 nodes: what was open stays open; the new folds.
    await show(bigForest("a", 12), "view-1");
    expect(visible("a-0-0")).toBe(true);
    expect(visible("a-4-5")).toBe(true);
    expect(visible("a-11")).toBe(true);
    expect(visible("a-11-0")).toBe(false);
  });

  it("does not re-judge a node already seen when a later write gives it children", async () => {
    await show(bigForest("a"), "view-1");
    expand("a-0");
    // Write 1: a new leaf under the open branch — seen, and open.
    const withLeaf = (leafChildren: LensTreeNode[]) =>
      bigForest("a").map((top) => ({
        ...top,
        children: top.children.map((child) =>
          child.id === "a-0"
            ? { ...child, children: [...child.children, branch("a-0-new", leafChildren)] }
            : child,
        ),
      }));
    await show(withLeaf([]), "view-1");
    expect(visible("a-0-new")).toBe(true);
    // Write 2: that leaf gains a child. It was already seen, so it stays open.
    await show(withLeaf([branch("a-0-new-kid")]), "view-1");
    expect(visible("a-0-new-kid")).toBe(true);
    expect(visible("a-0-0")).toBe(true);
  });

  it("folds afresh for a new view, even over the same nodes", async () => {
    await show(bigForest("a"), "view-1");
    expand("a-0");
    expect(visible("a-0-0")).toBe(true);
    await show(bigForest("a"), "view-2");
    expect(visible("a-0-0")).toBe(false);
  });
});
