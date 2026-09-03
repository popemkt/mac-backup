/**
 * Focus / instance-key behavior: same nodeId as tree + query-result rows,
 * zoomed arrow/edit focus, ref-child non-cascade.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { outlineInstanceKey, queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import type { WireNode } from "@kb/contracts";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeBlock } from "./node-block";

const TODO_EDN = `[:find ?id ?text
  :where [?n :f/${SYSTEM_IDS.typeField} ?t]
         [?t :node/id "tag.todo"]
         [?n :node/id ?id]
         [?n :node/text ?text]]`;

function queryWire(): WireNode {
  return {
    id: "n.q1",
    text: "Open todos",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
      [SYSTEM_IDS.queryField]: [{ t: "str", v: TODO_EDN }],
    },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function seed(extra: WireNode[] = []) {
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
    .hydrateFromWire([...fixtureGraph.nodes, ...extra], fixtureGraph.rev, "fixtures");
}

describe("instance identity (component)", () => {
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
    seed([queryWire()]);
    // Expand query so result rows appear in the visible-instance walk.
    useOutlineStore.getState().toggleCollapse("n.q1");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("clicking the tree instance activates only that data-instance-key", async () => {
    const nodes = useOutlineStore.getState().nodes;
    const treeKey = outlineInstanceKey("n.root-a", nodes);
    const refKey = queryResultInstanceKey("n.q1", "n.root-a");

    await act(async () => {
      root.render(
        <div>
          <NodeBlock nodeId="n.root-a" instanceKey={treeKey} depth={0} />
          <NodeBlock nodeId="n.root-a" instanceKey={refKey} depth={1} isRef />
        </div>,
      );
    });

    const treeBlock = container.querySelector(`[data-instance-key="${treeKey}"]`);
    expect(treeBlock).toBeTruthy();
    const treeContent = treeBlock!.querySelector(
      "[contenteditable], .kb-text, [data-node-content]",
    );
    // Activate via store path used by NodeContent click
    act(() => {
      useOutlineStore.getState().activateNode("n.root-a", 0, treeKey);
    });

    await act(async () => {
      root.render(
        <div>
          <NodeBlock nodeId="n.root-a" instanceKey={treeKey} depth={0} />
          <NodeBlock nodeId="n.root-a" instanceKey={refKey} depth={1} isRef />
        </div>,
      );
    });

    const blocks = container.querySelectorAll(`.node-block[data-node-id="n.root-a"]`);
    expect(blocks.length).toBe(2);
    const s = useOutlineStore.getState();
    expect(s.activeNodeId).toBe("n.root-a");
    expect(s.activeInstanceKey).toBe(treeKey);
    expect(s.activeInstanceKey).not.toBe(refKey);

    // Only the tree row should show active editor chrome
    const treeActive = container.querySelector(
      `.node-block[data-instance-key="${treeKey}"] [contenteditable="true"]`,
    );
    const refActive = container.querySelector(
      `.node-block[data-instance-key="${refKey}"] [contenteditable="true"]`,
    );
    expect(treeActive).toBeTruthy();
    expect(refActive).toBeNull();
    void treeContent;
  });

  it("arrow from query-result instance stays in the query region", () => {
    const refA = queryResultInstanceKey("n.q1", "n.root-a");
    const refB = queryResultInstanceKey("n.q1", "n.root-b");
    const instances = useOutlineStore.getState().getVisibleInstances();
    expect(instances.some((i) => i.instanceKey === refA)).toBe(true);

    useOutlineStore.getState().activateNode("n.root-a", 0, refA);
    const next = useOutlineStore.getState().getNextVisibleInstance(refA);
    expect(next).not.toBeNull();
    // Next query result (children collapsed on ref rows by default).
    expect(next!.instanceKey).toBe(refB);

    useOutlineStore.getState().activateNode(next!.nodeId, 0, next!.instanceKey);
    expect(useOutlineStore.getState().activeInstanceKey).toBe(refB);
    expect(useOutlineStore.getState().activeInstanceKey).not.toBe(
      outlineInstanceKey(next!.nodeId, useOutlineStore.getState().nodes),
    );
  });

  it("zoomed view: outlineInstanceKey matches mounted row for edit focus", async () => {
    useOutlineStore.getState().zoomTo("n.root-a");
    const nodes = useOutlineStore.getState().nodes;
    const childKey = outlineInstanceKey("n.child-a1", nodes);
    expect(childKey).toBe("tree/n.root-a/n.child-a1");

    await act(async () => {
      root.render(<NodeBlock nodeId="n.child-a1" instanceKey={childKey} depth={0} />);
    });

    act(() => {
      // Simulate keyboard/optimistic path that uses outlineInstanceKey fallback
      useOutlineStore.getState().activateNode("n.child-a1", 2);
    });

    await act(async () => {
      root.render(<NodeBlock nodeId="n.child-a1" instanceKey={childKey} depth={0} />);
    });

    const s = useOutlineStore.getState();
    expect(s.activeInstanceKey).toBe(childKey);
    expect(
      container.querySelector(`[data-instance-key="${childKey}"] [contenteditable="true"]`),
    ).toBeTruthy();
  });

  it("expanded ref children render non-ref bullets", async () => {
    const refKey = queryResultInstanceKey("n.q1", "n.root-a");
    // Expand the result node so children mount under the ref instance.
    useOutlineStore.setState((s) => {
      const n = s.nodes.get("n.root-a");
      if (!n) return s;
      const next = new Map(s.nodes);
      next.set("n.root-a", { ...n, collapsed: false });
      return { nodes: next };
    });

    await act(async () => {
      root.render(<NodeBlock nodeId="n.root-a" instanceKey={refKey} depth={1} isRef />);
    });

    const parentBullet = container.querySelector(
      `[data-instance-key="${refKey}"] [data-bullet-ref="true"]`,
    );
    expect(parentBullet).toBeTruthy();

    const childKey = `${refKey}/n.child-a1`;
    const childBlock = container.querySelector(`[data-instance-key="${childKey}"]`);
    expect(childBlock).toBeTruthy();
    expect(childBlock!.querySelector('[data-bullet-ref="true"]')).toBeNull();
  });
});
