/**
 * A live query node answers with rows or with an error, and both reach the
 * results section. Before, only rows did: a query the server could not run
 * left "Loading results…" on screen forever (closing audit P1-6).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import type { SubscriptionSink } from "@/api/ws";
import { fixtureGraph } from "@/api/fixture-graph";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { QueryResultsSection } from "./query-results";

const sinks = new Map<string, SubscriptionSink>();

vi.mock("@/api/live", () => ({
  getLiveClient: () => ({
    subscribe: (id: string, _query: string, sink: SubscriptionSink) => sinks.set(id, sink),
    unsubscribe: (id: string) => sinks.delete(id),
  }),
}));

const BAD_EDN = "[:find ?id :where";

function queryWire(): WireNode {
  return {
    id: "n.bad",
    text: "Broken query",
    props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: BAD_EDN }] },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("query results: a live subscription's error (component)", () => {
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
  });

  beforeEach(() => {
    sinks.clear();
    resetOutlineStore();
    useOutlineStore
      .getState()
      .hydrateFromWire([...fixtureGraph.nodes, queryWire()], fixtureGraph.rev, "fixtures");
    useUiStore.getState().setWsStatus("open");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useUiStore.getState().setWsStatus("idle");
  });

  it("shows the server's error in place of the loading state", () => {
    act(() =>
      root.render(
        createElement(QueryResultsSection, { nodeId: "n.bad", depth: 0, renderNode: () => null }),
      ),
    );
    expect(container.textContent).toContain("Loading results…");

    const sink = sinks.get("query-node:n.bad");
    expect(sink).toBeDefined();
    act(() => sink?.error({ code: "query_error", message: "bad find spec" }));

    expect(container.textContent).toContain("bad find spec");
    expect(container.textContent).not.toContain("Loading results…");

    // A later answer replaces the error.
    act(() => sink?.rows([], 2));
    expect(container.textContent).not.toContain("bad find spec");
  });
});
