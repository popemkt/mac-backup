/**
 * Focus follows the selection: Escape out of an editor used to drop focus
 * on <body> (closing audit P3), so Tab restarted from the top of the page.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NodeRow } from "./node-row";

function row(props: { isSelected: boolean; isActive?: boolean }) {
  return createElement(NodeRow, {
    depth: 0,
    nodeId: "n.x",
    onRowClick: () => undefined,
    bullet: createElement("span", null, "•"),
    content: createElement("input", { "data-inner": "true" }),
    ...props,
  });
}

describe("NodeRow focus follows selection (component)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    g.KeyboardEvent = dom.KeyboardEvent;
  });

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const rowEl = () => container.querySelector("[data-node-row]");

  it("takes focus from <body> when it becomes selected", () => {
    act(() => root.render(row({ isSelected: false })));
    expect(dom.document.activeElement).toBe(dom.document.body);
    act(() => root.render(row({ isSelected: true })));
    expect(dom.document.activeElement).toBe(rowEl());
  });

  it("takes focus back from inside itself when its editor gives up the caret", () => {
    act(() => root.render(row({ isSelected: false, isActive: true })));
    (container.querySelector("[data-inner]") as unknown as HTMLElement).focus();
    act(() => root.render(row({ isSelected: true, isActive: false })));
    expect(dom.document.activeElement).toBe(rowEl());
  });

  it("takes focus from the row the selection left, so Enter lands on the new row", () => {
    const clicked: string[] = [];
    const pair = (selected: "a" | "b") =>
      createElement(
        "div",
        null,
        ...(["a", "b"] as const).map((id) =>
          createElement(NodeRow, {
            key: id,
            depth: 0,
            nodeId: id,
            isSelected: id === selected,
            onRowClick: () => clicked.push(id),
            bullet: createElement("span", null, "•"),
            content: createElement("span", null, id),
          }),
        ),
      );
    const rowOf = (id: string) =>
      container.querySelector(`[data-node-id="${id}"]`) as unknown as HTMLElement;
    act(() => root.render(pair("a")));
    expect(dom.document.activeElement).toBe(rowOf("a"));
    // Arrow down: the selection moves to b while a still holds focus.
    act(() => root.render(pair("b")));
    expect(dom.document.activeElement).toBe(rowOf("b"));
    act(() => {
      dom.document.activeElement.dispatchEvent(
        new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(clicked).toEqual(["b"]);
  });

  it("never takes focus from an element outside the row", () => {
    const outside = dom.document.createElement("input");
    dom.document.body.appendChild(outside);
    outside.focus();
    act(() => root.render(row({ isSelected: true })));
    expect(dom.document.activeElement).toBe(outside);
    outside.remove();
  });
});
