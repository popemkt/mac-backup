import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { traceOf } from "@kb/graph";
import type { LensNode } from "./graph-lens";
import { GraphTraceCard } from "./graph-trace-card";

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

const wire = (id: string, text: string, children: string[] = []) => ({
  id,
  text,
  props: {},
  children,
});
const nodes = [wire("a", "A on [[b|B]]"), wire("b", "B", ["c"]), wire("c", "C")];
const lens = (id: string): LensNode => ({
  id,
  label: id.toUpperCase(),
  tags: [],
  degree: 1,
  color: "#888",
  size: 4,
  clusterKey: "",
});

it("lists each path's hops as sentences, and saves it", () => {
  const onSave = vi.fn();
  const answer = traceOf(nodes, { from: "a", to: "c" });
  act(() =>
    root.render(
      createElement(GraphTraceCard, {
        trace: { from: "a", to: "c" },
        answer,
        nodes: ["a", "b", "c"].map(lens),
        onSave,
        onClose: () => {},
      }),
    ),
  );
  const text = container.textContent;
  expect(text).toContain("A → C");
  expect(text).toContain("A on B mentions B");
  expect(text).toContain("B contains C");
  const save = [...container.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Save as perspective"),
  );
  act(() => save?.click());
  expect(onSave).toHaveBeenCalledWith("A → C");
});

it("while picking says what to do; with no path says why", () => {
  act(() =>
    root.render(
      createElement(GraphTraceCard, {
        trace: { from: "a", to: null },
        answer: null,
        nodes: [lens("a")],
        onClose: () => {},
      }),
    ),
  );
  expect(container.textContent).toContain("Pick the node to trace to");
  const unreached = traceOf([wire("x", "X"), wire("y", "Y")], { from: "x", to: "y" });
  act(() =>
    root.render(
      createElement(GraphTraceCard, {
        trace: { from: "x", to: "y" },
        answer: unreached,
        nodes: [lens("x"), lens("y")],
        onSave: () => {},
        onClose: () => {},
      }),
    ),
  );
  expect(container.textContent).toContain("no path");
  expect(container.textContent).not.toContain("Save as perspective");
});
