/**
 * The chart painter's promise (`ChartPainter` in @kb/contracts): a Vega-Lite
 * spec with inline data becomes one SVG document, drawn headless; nothing is
 * fetched, and no expression is compiled to code.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { chartSvg, vegaChartPainter } from "@kb/vega";

const BAR = {
  mark: "bar",
  encoding: {
    x: { field: "status", type: "nominal" },
    y: { aggregate: "count", type: "quantitative" },
  },
  data: {
    values: [{ status: "doing" }, { status: "done" }, { status: "doing" }],
  },
  width: 320,
};

const realFetch = globalThis.fetch;
const RealFunction = globalThis.Function;

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.Function = RealFunction;
});

describe("vega chart painter", () => {
  test("draws a bar chart as one SVG document, one bar per category", async () => {
    const svg = await Effect.runPromise(vegaChartPainter.svg(BAR));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<path[^>]*aria-roledescription="bar"/g)?.length).toBe(2);
    expect(svg).toContain("doing");
  });

  test("fetches nothing: a URL in the spec draws as nothing", async () => {
    const fetched: string[] = [];
    globalThis.fetch = Object.assign(
      (input: string | URL | Request) => {
        fetched.push(input instanceof Request ? input.url : input.toString());
        return Promise.reject(new Error("no network in a chart"));
      },
      { preconnect: realFetch.preconnect },
    );
    const exit = await Effect.runPromiseExit(
      chartSvg({ ...BAR, data: { url: "https://example.com/rows.json" } }),
    );
    expect(fetched).toEqual([]);
    if (Exit.isSuccess(exit)) expect(exit.value).not.toContain("doing");
  });

  test("compiles no expression to code: a calculate runs with Function forbidden", async () => {
    const forbidden = new Proxy(RealFunction, {
      apply: () => {
        throw new Error("Function called");
      },
      construct: () => {
        throw new Error("new Function called");
      },
    });
    globalThis.Function = forbidden;
    const svg = await Effect.runPromise(
      chartSvg({
        ...BAR,
        transform: [{ calculate: "upper(datum.status) + '!'", as: "shout" }],
        encoding: { ...BAR.encoding, x: { field: "shout", type: "nominal" } },
      }),
    );
    expect(svg).toContain("DOING!");
  });
});
