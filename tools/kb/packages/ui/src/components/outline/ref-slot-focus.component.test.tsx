/**
 * The options search opens on focus, not on mount.
 *
 * Static markup pins what each state renders (ref-editor.test.tsx); this pins
 * the transitions, because the whole point is that focus — not emptiness — is
 * what opens the picker.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { WORKSPACE_ROOT_ID, type PropValue } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldValueStack } from "./fields-section";

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

function seed() {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(
      [
        wire({ id: "n.host", text: "Host" }),
        wire({ id: "n.target", text: "Target one" }),
        wire({ id: "n.other", text: "Target two" }),
      ],
      1,
      "fixtures",
    );
}

describe("ref slot focus behaviour", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.FocusEvent = dom.FocusEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    seed();
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(values: PropValue[]) {
    await act(async () => {
      root.render(
        <FieldValueStack
          nodeId="n.host"
          fieldId="f.link"
          fieldType="ref"
          allowedRefIds={null}
          values={values}
          nodes={useOutlineStore.getState().nodes}
          readOnly={false}
        />,
      );
    });
  }

  const inputs = () => container.querySelectorAll("input");
  const listboxes = () => container.querySelectorAll('[role="listbox"]');
  const placeholder = () =>
    container.querySelector('[data-ref-slot="closed"]') as HTMLElement | null;

  it("an unset field renders one closed placeholder, no dropdown", async () => {
    await render([]);
    expect(placeholder()).toBeTruthy();
    expect(inputs().length).toBe(0);
    expect(listboxes().length).toBe(0);
  });

  it("focusing the placeholder opens the search and its suggestions", async () => {
    await render([]);
    await act(async () => {
      placeholder()!.dispatchEvent(
        new dom.FocusEvent("focusin", { bubbles: true }) as unknown as Event,
      );
    });
    expect(inputs().length).toBe(1);
    expect(listboxes().length).toBe(1);
    expect(placeholder()).toBeNull();
  });

  it('"+ value" mints a slot that is already open', async () => {
    await render([{ t: "ref", v: "n.target" }]);
    expect(inputs().length).toBe(0);
    const addValue = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "value",
    ) as HTMLElement | undefined;
    expect(addValue).toBeTruthy();
    await act(async () => {
      addValue!.click();
    });
    expect(inputs().length).toBe(1);
    expect(listboxes().length).toBe(1);
  });

  it("a filled ref still opens the search when its value is clicked", async () => {
    await render([{ t: "ref", v: "n.target" }]);
    const row = container.querySelector(
      '[data-node-row="true"][data-node-id="n.target"]',
    ) as HTMLElement | null;
    expect(row).toBeTruthy();
    await act(async () => {
      row!.click();
    });
    expect(inputs().length).toBe(1);
  });
});
