/**
 * The chart view in the browser: it draws its source query node's rows with
 * Vega (lazily, as SVG), says why when it has nothing to draw, follows the
 * rows as they change, and edits its spec through the chart key's own check,
 * writing the view node it is drawn from. It is drawn as the shell draws it:
 * the chart family's page entry loaded beside the page's host, and its view
 * found on the view point.
 */
import { Suspense, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { CHART_IDS, ChartView, type ChartParams } from "@kb/chart";
import { SYSTEM_IDS } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { browserHostUiPlugin } from "@/browser-host";
import { ViewPoint, currentContributions, findView, syncUiPlugins } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { chartUiPlugin } from "@kb/chart-ui";

const replaceField = vi.fn((_node: string, _field: string, _values: unknown) => Promise.resolve());
vi.mock("@/actions/mutations", () => ({
  mutations: {
    replaceField: (node: string, field: string, values: unknown) =>
      replaceField(node, field, values),
  },
}));

const AT = "2026-10-03T00:00:00.000Z";

function wire(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

/** Three nodes with a size, and a query over them naming its columns. */
const TASKS = [
  wire("t.a", "Alpha", { "f.size": [{ t: "str", v: "small" }] }),
  wire("t.b", "Beta", { "f.size": [{ t: "str", v: "large" }] }),
  wire("t.c", "Gamma", { "f.size": [{ t: "str", v: "small" }] }),
];
const QUERY = wire("q.sizes", "Sizes", {
  [SYSTEM_IDS.queryField]: [
    {
      t: "str",
      v: "[:find ?id ?size :where [?n :f/f.size ?size] [?n :node/id ?id]]",
    },
  ],
});
const VIEW = wire("v.chart", "Task sizes", {
  [SYSTEM_IDS.viewField]: [{ t: "ref", v: "sys.view.chart.vega-lite" }],
});

const BAR: ChartParams["spec"] = {
  mark: "bar",
  encoding: {
    x: { field: "size", type: "nominal" },
    y: { aggregate: "count", type: "quantitative" },
  },
};

/** Let the lazy chunks and Vega's async run settle. */
async function settle(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("chart view (component)", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    const g = globalThis as Record<string, unknown>;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    g.SVGElement = dom.window.SVGElement;
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  });

  afterAll(() => dom.restore());

  // The chart reaches the shell through the page's host, as it does when the app boots.
  beforeAll(() => syncUiPlugins([browserHostUiPlugin, chartUiPlugin]));
  afterAll(() => syncUiPlugins([]));

  beforeEach(() => {
    replaceField.mockClear();
    resetOutlineStore();
    useOutlineStore
      .getState()
      .hydrateFromWire(
        [...fixtureGraph.nodes, ...TASKS, QUERY, VIEW],
        fixtureGraph.rev,
        "fixtures",
      );
    useUiStore.getState().setWsStatus("idle");
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(params: ChartParams, viewNode?: string): Promise<void> {
    const page = findView(currentContributions(ViewPoint), ChartView);
    if (page === null) throw new Error("the chart family's page entry provides no chart view");
    await act(async () =>
      root.render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(page.Component, {
            params,
            host: viewNode === undefined ? { placement: "page" } : { placement: "page", viewNode },
          }),
        ),
      ),
    );
    // The page is its own chunk.
    await settle(() => container.childElementCount > 0);
  }

  const text = () => container.textContent;

  it("draws the query's rows as SVG, named by the view node, counting its rows", async () => {
    // happy-dom lays nothing out: the chart's box is given a size here.
    const width = vi.spyOn(dom.window.HTMLElement.prototype, "clientWidth", "get");
    const height = vi.spyOn(dom.window.HTMLElement.prototype, "clientHeight", "get");
    width.mockReturnValue(480);
    height.mockReturnValue(300);
    try {
      await show({ source: "q.sizes", spec: BAR }, "v.chart");
      expect(text()).toContain("Task sizes");
      expect(text()).toContain("3 rows");
      const bars = () => container.querySelectorAll('path[aria-roledescription="bar"]').length;
      await settle(() => bars() > 0);
      // Two sizes, so two bars: small (2) and large (1).
      expect(bars()).toBe(2);
      expect(container.querySelector("svg.marks")?.getAttribute("width")).toBe("480");
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it("follows its rows: a new node in the query shows in the count", async () => {
    await show({ source: "q.sizes", spec: BAR }, "v.chart");
    expect(text()).toContain("3 rows");
    act(() =>
      useOutlineStore
        .getState()
        .hydrateFromWire(
          [
            ...fixtureGraph.nodes,
            ...TASKS,
            wire("t.d", "Delta", { "f.size": [{ t: "str", v: "large" }] }),
            QUERY,
            VIEW,
          ],
          fixtureGraph.rev + 1,
          "fixtures",
        ),
    );
    await settle(() => text().includes("4 rows"));
    expect(text()).toContain("4 rows");
  });

  it("says why it draws nothing: no source, or a source that is no query", async () => {
    await show({ spec: BAR });
    expect(text()).toContain("This chart draws no query");
    await show({ source: "t.a", spec: BAR });
    expect(text()).toContain("Alpha is no query");
  });

  it("checks the spec as it is typed, and saves it to the view node it is drawn from", async () => {
    await show({ source: "q.sizes", spec: BAR }, "v.chart");
    const toggle = container.querySelector('button[aria-label="Edit the spec"]');
    await act(async () => (toggle as HTMLButtonElement | null)?.click());
    const area = container.querySelector("textarea");
    expect(area).not.toBeNull();
    expect(text()).toContain("Fields: id, size");

    const type = async (value: string) => {
      if (area === null) return;
      await act(async () => {
        area.value = value;
        area.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
      });
    };
    await type(JSON.stringify({ ...BAR, data: { url: "https://example.com/rows.json" } }));
    expect(text()).toContain("data: Expected no excess property");
    const save = () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Save") ?? null;
    expect(save()?.disabled).toBe(true);

    const line = { mark: "line", encoding: BAR.encoding };
    await type(JSON.stringify(line));
    expect(save()?.disabled).toBe(false);
    await act(async () => save()?.click());
    expect(replaceField).toHaveBeenCalledWith("v.chart", CHART_IDS.chartField, [
      { t: "str", v: JSON.stringify({ encoding: BAR.encoding, mark: "line" }) },
    ]);
  });
});
