import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import type { LensNode } from "@/lib/graph-lens";
import { GraphLegend } from "./graph-legend";
let dom: Window, container: HTMLDivElement, root: Root;
beforeAll(() => {
  dom = new Window();
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
  });
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
const node = (id: string, tag: string): LensNode => ({
  id,
  label: id,
  tags: ["Same name"],
  tagIds: [tag],
  color: "#123456",
  size: 5,
  degree: 0,
  clusterKey: "none",
});
it("keeps same-name tag nodes distinct and refreshes membership when live nodes change", () => {
  const filter = vi.fn();
  const render = (nodes: LensNode[]) =>
    act(() => root.render(createElement(GraphLegend, { nodes, onFilterChange: filter })));
  render([node("a", "tag.a"), node("b", "tag.b")]);
  const choices = container.querySelectorAll("button[aria-pressed]");
  expect(choices.length).toBe(2);
  void act(() =>
    present(choices[0], "first legend bucket").dispatchEvent(
      new dom.MouseEvent("click", { bubbles: true }) as unknown as MouseEvent,
    ),
  );
  expect(filter).toHaveBeenLastCalledWith(new Set(["b"]));
  render([node("a", "tag.a"), node("c", "tag.a"), node("b", "tag.b")]);
  expect(filter).toHaveBeenLastCalledWith(new Set(["b"]));
  render([node("b", "tag.b")]);
  expect(filter).toHaveBeenLastCalledWith(null);
  expect(container.querySelector("button[aria-pressed]")).toBeNull();
});
