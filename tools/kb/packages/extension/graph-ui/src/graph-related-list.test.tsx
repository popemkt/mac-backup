import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Related } from "./graph-related";
import { RelatedList } from "./graph-related-list";

let dom: Window, container: HTMLDivElement, root: Root;
beforeAll(() => {
  dom = new Window();
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
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

function related(link: Related["typing"]["link"]): Related {
  return {
    suggestions: [
      { id: "e", text: "E", score: 2, reasons: { shared: ["b"], tags: ["t"], citedBy: [] } },
      { id: "x", text: "X", score: 1, reasons: { shared: ["b"], tags: [], citedBy: ["b"] } },
    ],
    typing: {
      fieldsFor: (target) => (target === "e" ? [{ id: "f.influences", text: "influences" }] : []),
      link,
    },
  };
}

it("lists each related node with its evidence, and links it as the field picked", () => {
  const link = vi.fn(() => Promise.resolve(true));
  act(() => root.render(createElement(RelatedList, { related: related(link) })));
  expect(container.textContent).toContain("Related, not connected");
  expect(container.textContent).toContain("1 shared · 1 tag");
  const [linkE, linkX] = [...container.querySelectorAll("select")];
  // A node no ref field allows cannot be linked from here.
  expect(linkX?.disabled).toBe(true);
  act(() => {
    if (linkE === undefined) return;
    linkE.value = "f.influences";
    linkE.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(link).toHaveBeenCalledWith("e", "f.influences");
});
