/**
 * ShapeCard wires the label-edit draft machine (Esc cancel / Enter commit)
 * to the page's edit: a double-click asks the page to open the editor, and
 * the editor tells the page when it closes. Draft semantics are unit-tested
 * in shape-label-edit.test.ts.
 */
import { act, useState } from "react";
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

/** The card with the page's edit state, as the canvas page holds it. */
function Harness({
  onLabelChange,
  onEdit,
}: {
  onLabelChange: (label: string) => void;
  onEdit: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <ShapeCard
      card={baseCard}
      box={{ left: 0, top: 0, width: 160, height: 100 }}
      editing={editing}
      onEdit={(on) => {
        onEdit(on);
        setEditing(on);
      }}
      selected
      onSelect={() => {}}
      onLabelChange={onLabelChange}
      onMoveStart={() => {}}
      onResizeStart={() => {}}
      onRotateStart={() => {}}
      onPortDown={() => {}}
    />
  );
}

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

  const input = () =>
    container.querySelector<HTMLInputElement>('[data-testid="shape-label-input"]');

  function openEditor(onLabelChange = vi.fn(), onEdit = vi.fn()) {
    act(() => {
      root.render(<Harness onLabelChange={onLabelChange} onEdit={onEdit} />);
    });
    const shell = present(container.querySelector(".group\\/card"), "shape shell");
    expect(shell.textContent).toContain("Prior");
    expect(input()).toBeNull();
    act(() => {
      shell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    return { onLabelChange, onEdit };
  }

  const key = (k: string) =>
    act(() => {
      input()?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });

  it("double-click asks the page to open the draft input, seeded with card.label", () => {
    const { onLabelChange, onEdit } = openEditor();
    expect(onEdit).toHaveBeenCalledWith(true);
    expect(input()?.value).toBe("Prior");
    expect(onLabelChange).not.toHaveBeenCalled();
  });

  it("Escape closes the editor without writing", () => {
    const { onLabelChange, onEdit } = openEditor();
    key("Escape");
    expect(input()).toBeNull();
    expect(onEdit).toHaveBeenLastCalledWith(false);
    expect(onLabelChange).not.toHaveBeenCalled();
  });

  it("Enter with an unchanged draft closes the editor and writes nothing", () => {
    const { onLabelChange, onEdit } = openEditor();
    key("Enter");
    expect(input()).toBeNull();
    expect(onEdit).toHaveBeenLastCalledWith(false);
    expect(onLabelChange).not.toHaveBeenCalled();
  });
});
