/**
 * A frame whose view is a collection view, on a page where the collections
 * family is switched off: the frame says which view it cannot show here, and
 * its walk offers no rows, so the keyboard reaches nothing the page does not
 * draw. Its view node stays, and the view comes back when the family does.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/api/fixture-graph";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { syncUiPlugins } from "@kb/ui-sdk";
import { FrameViewSlot, outlineUiPlugin, useOutlineStore } from "@kb/outline-ui";
import { collectionsUiPlugin } from "@kb/collections-ui";

const FRAME = "n.root-a";

function hydrateFramedAsTable(): void {
  const nodes = structuredClone(fixtureGraph.nodes).flatMap((w) =>
    w.id === FRAME ? framedAs(w, "table") : [w],
  );
  useGraphStore
    .getState()
    .hydrateFromWire([...nodes, ...viewFieldNodes], fixtureGraph.rev, "fixtures");
}

const slot = () => renderToStaticMarkup(createElement(FrameViewSlot, { frameId: FRAME, depth: 0 }));

describe("a collection view with the collections switched off", () => {
  beforeAll(() => syncPagePlugins([outlineUiPlugin]));
  afterAll(() => syncUiPlugins([]));

  beforeEach(() => {
    resetOutlineStore();
    hydrateFramedAsTable();
    useGraphStore.getState().zoomTo(FRAME);
  });

  it("says which view the frame cannot show here, rather than drawing another", () => {
    const html = slot();
    expect(html).toContain('data-view-unavailable="true"');
    expect(html).toContain("This view cannot be shown here. Table: its plugin is not loaded");
    expect(html).not.toContain('data-node-row="true"');
  });

  it("offers no rows to the keyboard", () => {
    expect(useOutlineStore.getState().getVisibleInstances()).toEqual([]);
  });

  it("draws the view again once the family is back", () => {
    syncPagePlugins([outlineUiPlugin, collectionsUiPlugin]);
    try {
      expect(slot()).toContain('data-table-view="true"');
      expect(useOutlineStore.getState().getVisibleInstances()).not.toEqual([]);
    } finally {
      syncPagePlugins([outlineUiPlugin]);
    }
  });
});
