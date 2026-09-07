/**
 * What a row shows, per node shape and per view mode.
 *
 * `NodeBlock` computed `hasFields`, `showsQueryResults`, `showsChildren`,
 * `hasFrameRows`, `isExpandable`, `showToolbar`, `projected` and `bulletIsRef`
 * in its own body and then branched on all eight in JSX. These rows are that
 * decision, read off the DOM: which sections mount, whether the bullet promises
 * a toggle, and whether the create-child strip is offered.
 *
 * Written before `resolveRowChrome`, unchanged through it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { NodeBlock } from "./node-block";

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** Rows hydrate collapsed; open one so its chrome renders. */
async function expand(nodeId: string) {
  await act(async () => {
    const { nodes } = useOutlineStore.getState();
    if (nodes.get(nodeId)?.collapsed === true) useOutlineStore.getState().toggleCollapse(nodeId);
  });
}

/**
 * One graph covering every chrome case: a leaf, a parent, a fields-only row, a
 * query node, and a frame projected as a table.
 */
function graph(): WireNode[] {
  return [
    wire({ id: WORKSPACE_ROOT_ID, text: "root", children: ["n.parent", "n.query", "n.table"] }),
    wire({ id: "f.status", text: "status" }),
    wire({ id: "n.leaf", text: "Leaf" }),
    wire({ id: "n.parent", text: "Parent", children: ["n.leaf"] }),
    wire({
      id: "n.fields-only",
      text: "Fields only",
      props: { "f.status": [{ t: "str", v: "doing" }] },
    }),
    wire({
      id: "n.query",
      text: "Query",
      props: {
        [SYSTEM_IDS.queryField]: [
          { t: "str", v: '[:find ?id :where [?n :node/id ?id] [(= ?id "n.leaf")]]' },
        ],
      },
    }),
    wire({
      id: "n.table",
      text: "Table frame",
      children: ["n.row"],
      props: { [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "table" }] },
    }),
    wire({ id: "n.row", text: "Row" }),
  ];
}

describe("row chrome", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(nodeId: string, opts: { isRef?: boolean; instanceKey?: string } = {}) {
    await act(async () => {
      root.render(
        <NodeBlock
          nodeId={nodeId}
          depth={0}
          isRef={opts.isRef ?? false}
          instanceKey={opts.instanceKey}
        />,
      );
    });
  }

  const has = (selector: string) => container.querySelector(selector) !== null;
  const toggles = () =>
    container.querySelector("[data-node-id] [data-bullet-kind]")?.getAttribute("title") ===
    "Click to toggle, Cmd+click to focus";

  it("a leaf: no children container, no toggle promise", async () => {
    await render("n.leaf");
    expect(has(".children-container")).toBe(false);
    expect(toggles()).toBe(false);
  });

  it("an expanded parent: children, guide line, create-child strip, no toolbar", async () => {
    await expand("n.parent");
    await render("n.parent");
    expect(has(".children-container")).toBe(true);
    expect(has('[data-node-id="n.leaf"]')).toBe(true);
    expect(has('[data-create-child-zone="n.parent"]')).toBe(true);
    expect(has('[data-view-toolbar="true"]')).toBe(false);
    expect(toggles()).toBe(true);
  });

  it("a collapsed parent: the toggle is promised but nothing under it renders", async () => {
    await render("n.parent");
    expect(useOutlineStore.getState().nodes.get("n.parent")?.collapsed).toBe(true);
    expect(has(".children-container")).toBe(false);
    expect(has('[data-node-id="n.leaf"]')).toBe(false);
    expect(toggles()).toBe(true);
  });

  it("fields alone make a row expandable, and its fields render", async () => {
    await expand("n.fields-only");
    await render("n.fields-only");
    expect(toggles()).toBe(true);
    expect(has('[data-fields-for="n.fields-only"]')).toBe(true);
    expect(has('[data-field-values="f.status"]')).toBe(true);
    // No children: the create-child strip is still offered on a non-reference row.
    expect(has('[data-create-child-zone="n.fields-only"]')).toBe(true);
  });

  it("a query node projects results instead of children", async () => {
    await expand("n.query");
    await render("n.query");
    expect(has('[data-query-results-for="n.query"]')).toBe(true);
    expect(toggles()).toBe(true);
  });

  it("a query node rendered as a reference does not re-run its query", async () => {
    await expand("n.query");
    await render("n.query", {
      isRef: true,
      instanceKey: queryResultInstanceKey("n.other", "n.query"),
    });
    expect(has('[data-query-results-for="n.query"]')).toBe(false);
    // …and a reference row is never offered the create-child strip.
    expect(has('[data-create-child-zone="n.query"]')).toBe(false);
  });

  it("a projected frame swaps the child list for the projection, and shows the toolbar", async () => {
    await expand("n.table");
    await render("n.table");
    expect(has('[data-table-view="true"]')).toBe(true);
    expect(has('[data-view-toolbar="true"]')).toBe(true);
    // The nested list is gone, and so is the create-child strip: rows are the
    // projection's business now.
    expect(has('[data-node-block="true"][data-node-id="n.row"]')).toBe(false);
    expect(has('[data-create-child-zone="n.table"]')).toBe(false);
  });

  it("a collapsed projected frame shows no toolbar — chrome follows the rows", async () => {
    await render("n.table");
    expect(useOutlineStore.getState().nodes.get("n.table")?.collapsed).toBe(true);
    expect(has('[data-view-toolbar="true"]')).toBe(false);
    expect(has('[data-table-view="true"]')).toBe(false);
  });

  it("a reference row's bullet takes the dashed ring", async () => {
    await render("n.parent", { isRef: true, instanceKey: "ref:n.parent" });
    expect(has('[data-bullet-ref="true"]')).toBe(true);
  });

  it("an ordinary row's bullet does not", async () => {
    await render("n.parent");
    expect(has('[data-bullet-ref="true"]')).toBe(false);
  });
});
