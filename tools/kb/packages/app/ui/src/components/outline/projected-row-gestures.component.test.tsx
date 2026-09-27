/**
 * Projected rows (table rows, board/cards cards) answer clicks the way an
 * outline row does, whether the row is an owned child or a query result:
 * clicking the row selects it, clicking its text edits in place, and ⌘-click
 * on the table bullet (or any click on a card's bullet) opens the node the row
 * shows. A query-result row used to navigate on a plain row click instead.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { fieldContextOf } from "@/lib/schema";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { installDomGlobals } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { BoardCardsView } from "./board-cards-view";
import { TableView } from "./table-view";

const RESULTS = ["n.root-b", "n.root-c"];

describe("projected query-result rows behave like owned rows", () => {
  let dom: Window;
  const installed = { restore: () => {} };
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    installed.restore = fresh.restore;
  });

  afterAll(() => installed.restore());

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore
      .getState()
      .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function click(el: Element, init: { metaKey?: boolean } = {}) {
    el.dispatchEvent(
      new dom.MouseEvent("click", { bubbles: true, cancelable: true, ...init }) as unknown as Event,
    );
  }

  const key = queryResultInstanceKey("n.root-a", "n.root-b");
  const row = () =>
    present(container.querySelector(`[data-node-row="true"][data-instance-key="${key}"]`), "row");
  const bullet = () =>
    present(container.querySelector(`[data-instance-key="${key}"] [data-bullet-kind]`), "bullet");

  async function renderTable() {
    await act(async () => {
      root.render(
        <TableView
          frameId="n.root-a"
          rowIds={RESULTS}
          isQuerySource
          context={fieldContextOf(useOutlineStore.getState())}
        />,
      );
    });
  }

  it("table: a row click selects the result, it does not navigate", async () => {
    await renderTable();
    const before = useOutlineStore.getState().rootNodeId;
    await act(async () => click(row()));
    const s = useOutlineStore.getState();
    expect(s.rootNodeId).toBe(before);
    expect(s.selectedNodeId).toBe("n.root-b");
    expect(s.selectedInstanceKey).toBe(key);
  });

  it("table: a plain bullet click toggles, ⌘-click opens the node", async () => {
    await renderTable();
    const before = useOutlineStore.getState().rootNodeId;
    const collapsed = present(
      useOutlineStore.getState().nodes.get("n.root-b"),
      "n.root-b",
    ).collapsed;
    await act(async () => click(bullet()));
    expect(useOutlineStore.getState().rootNodeId).toBe(before);
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.collapsed).toBe(!collapsed);
    await act(async () => click(bullet(), { metaKey: true }));
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-b");
  });

  it("cards: a row click selects the result, the bullet opens it", async () => {
    const wires = structuredClone(fixtureGraph.nodes).map((w) =>
      w.id === "n.root-a"
        ? {
            ...w,
            props: { ...w.props, [SYSTEM_IDS.viewModeField]: [{ t: "str" as const, v: "cards" }] },
          }
        : w,
    );
    useOutlineStore.getState().hydrateFromWire(wires, fixtureGraph.rev, "fixtures");
    await act(async () => {
      root.render(
        <BoardCardsView
          frameId="n.root-a"
          rowIds={RESULTS}
          isQuerySource
          context={fieldContextOf(useOutlineStore.getState())}
        />,
      );
    });
    const before = useOutlineStore.getState().rootNodeId;
    await act(async () => click(row()));
    expect(useOutlineStore.getState().rootNodeId).toBe(before);
    expect(useOutlineStore.getState().selectedInstanceKey).toBe(key);
    await act(async () => click(bullet()));
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-b");
  });
});
