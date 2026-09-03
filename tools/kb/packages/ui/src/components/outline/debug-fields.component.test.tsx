/**
 * Debug field rows are per node, in the rendered outline.
 *
 * The store test pins the set; this pins the thing the owner asked for — "debug
 * 1 node instead of turn on for everything". Two sibling rows, one flag: only
 * the flagged node reveals its `sys.*` rows.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldsSection } from "./fields-section";

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** Two ordinary rows, each with one visible field and one sys.* prop. */
function graph(): WireNode[] {
  const props = {
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: "t.x" }],
    "f.status": [{ t: "str" as const, v: "doing" }],
  };
  return [
    wire({
      id: "f.status",
      text: "status",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
    }),
    wire({ id: "n.a", text: "Node A", props }),
    wire({ id: "n.b", text: "Node B", props }),
  ];
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
  useOutlineStore.getState().hydrateFromWire(graph(), 1, "fixtures");
  useDebugFieldsStore.setState({ ids: new Set() });
}

describe("per-node debug field rows", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom as unknown;
    g.document = dom.document as unknown;
    g.HTMLElement = dom.HTMLElement as unknown;
    g.KeyboardEvent = dom.KeyboardEvent as unknown;
    g.MouseEvent = dom.MouseEvent as unknown;
    g.Node = dom.Node as unknown;
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

  async function render() {
    await act(async () => {
      root.render(
        <>
          <FieldsSection nodeId="n.a" depth={0} />
          <FieldsSection nodeId="n.b" depth={0} />
        </>,
      );
    });
  }

  const debugRows = (nodeId: string) =>
    container.querySelectorAll(`[data-fields-for="${nodeId}"] [data-debug-field="true"]`).length;

  it("shows no debug rows until a node asks for them", async () => {
    await render();
    expect(container.querySelector('[data-fields-for="n.a"]')).toBeTruthy();
    expect(debugRows("n.a")).toBe(0);
    expect(debugRows("n.b")).toBe(0);
  });

  it("reveals them on the flagged node only", async () => {
    act(() => useDebugFieldsStore.getState().toggle("n.a"));
    await render();
    expect(debugRows("n.a")).toBeGreaterThan(0);
    expect(debugRows("n.b")).toBe(0);
    expect(
      container.querySelector(
        `[data-fields-for="n.a"] [data-field-values="${SYSTEM_IDS.typeField}"]`,
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        `[data-fields-for="n.b"] [data-field-values="${SYSTEM_IDS.typeField}"]`,
      ),
    ).toBeNull();
  });

  it("turning it back off hides them again", async () => {
    act(() => useDebugFieldsStore.getState().toggle("n.a"));
    await render();
    expect(debugRows("n.a")).toBeGreaterThan(0);
    act(() => useDebugFieldsStore.getState().toggle("n.a"));
    await render();
    expect(debugRows("n.a")).toBe(0);
  });
});
