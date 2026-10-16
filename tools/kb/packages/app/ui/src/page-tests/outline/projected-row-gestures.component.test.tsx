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
import { fieldContextOf, frameConfigOf, queryResultInstanceKey, schemaOf } from "@kb/ui-sdk";
import { OutlineCardsView, OutlineTableView, paramsFrom } from "@kb/views";
import { Result } from "effect";
import { useGraphStore } from "@/stores/graph.store";
import { installDomGlobals } from "@kb/ui-test-kit";
import { resetOutlineStore } from "@/test-support/outline-store";
import { framedAs } from "@/fixtures/view-fields";
import {
  BoardCardsView,
  outlineFrameSubject,
  outlineNodes,
  outlineSource,
  TableView,
  useOutlineStore,
} from "@kb/outline-ui";

const RESULTS = ["n.root-b", "n.root-c"];

/** What the view named `key` reads of n.root-a's config, decoded the way its host decodes it. */
function settingsOf<P>(key: Parameters<typeof paramsFrom<P>>[0]): P {
  const nodes = outlineNodes();
  const schema = schemaOf(useGraphStore.getState());
  return Result.getOrThrow(paramsFrom(key, frameConfigOf(nodes.get("n.root-a"), schema)));
}

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
    useGraphStore
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
          frame={outlineFrameSubject(
            { frameId: "n.root-a", rowIds: RESULTS, isQuerySource: true, depth: 0 },
            1,
          )}
          settings={settingsOf(OutlineTableView)}
          context={fieldContextOf(outlineSource())}
        />,
      );
    });
  }

  it("table: a row click selects the result, it does not navigate", async () => {
    await renderTable();
    const before = useGraphStore.getState().rootNodeId;
    await act(async () => click(row()));
    const s = useOutlineStore.getState();
    const graph = useGraphStore.getState();
    expect(graph.rootNodeId).toBe(before);
    expect(s.selectedNodeId).toBe("n.root-b");
    expect(s.selectedInstanceKey).toBe(key);
  });

  it("table: a plain bullet click toggles, ⌘-click opens the node", async () => {
    await renderTable();
    const before = useGraphStore.getState().rootNodeId;
    const collapsed = present(outlineNodes().get("n.root-b"), "n.root-b").collapsed;
    await act(async () => click(bullet()));
    expect(useGraphStore.getState().rootNodeId).toBe(before);
    expect(outlineNodes().get("n.root-b")?.collapsed).toBe(!collapsed);
    await act(async () => click(bullet(), { metaKey: true }));
    expect(useGraphStore.getState().rootNodeId).toBe("n.root-b");
  });

  it("cards: a row click selects the result, the bullet opens it", async () => {
    const wires = structuredClone(fixtureGraph.nodes).flatMap((w) =>
      w.id === "n.root-a" ? framedAs(w, "cards") : [w],
    );
    useGraphStore.getState().hydrateFromWire(wires, fixtureGraph.rev, "fixtures");
    await act(async () => {
      root.render(
        <BoardCardsView
          frame={outlineFrameSubject(
            { frameId: "n.root-a", rowIds: RESULTS, isQuerySource: true, depth: 0 },
            1,
          )}
          view={{ key: OutlineCardsView, params: settingsOf(OutlineCardsView) }}
          context={fieldContextOf(outlineSource())}
        />,
      );
    });
    const before = useGraphStore.getState().rootNodeId;
    await act(async () => click(row()));
    expect(useGraphStore.getState().rootNodeId).toBe(before);
    expect(useOutlineStore.getState().selectedInstanceKey).toBe(key);
    await act(async () => click(bullet()));
    expect(useGraphStore.getState().rootNodeId).toBe("n.root-b");
  });
});
