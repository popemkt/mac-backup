/**
 * The chart view type: its spec is checked as Vega-Lite's top-level shape,
 * holds no data of its own and fetches nothing; a view node stores it as one
 * JSON prop and reads its source from its focus or its host; the query's rows
 * are the only data it draws; and the catalog describes it as JSON Schema.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS, canonicalJson, type NodeProps } from "@kb/model";
import {
  CHART_DATA,
  ChartView,
  chartSpecWithData,
  describeChartSpec,
  fillsChartBox,
  issueText,
  paramsFromProps,
  paramsIssues,
  starterChartSpec,
  viewCatalog,
  viewNodeFor,
} from "@kb/views";

const BAR = {
  mark: "bar",
  encoding: {
    x: { field: "status", type: "nominal" },
    y: { aggregate: "count", type: "quantitative" },
  },
} as const;

/** Every issue a proposal of `spec` meets, one line each. */
function refused(spec: unknown): readonly string[] {
  const proposal = viewNodeFor(ChartView, { spec }, "q.todos");
  return Result.isFailure(proposal) ? proposal.failure.map(issueText) : [];
}

const quiet = () => {};

describe("chart spec", () => {
  test("a valid bar chart is accepted, and stored as one canonical JSON prop", () => {
    const proposal = viewNodeFor(ChartView, { spec: BAR }, "q.todos");
    expect(Result.isSuccess(proposal)).toBe(true);
    if (Result.isFailure(proposal)) return;
    const { props } = proposal.success;
    expect(props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: ChartView.option }]);
    expect(props[SYSTEM_IDS.chartField]).toEqual([{ t: "str", v: canonicalJson(BAR) }]);
    // Proposed without a source, it is a template: it names no query node of its own.
    expect(props[SYSTEM_IDS.lensFocusField]).toBeUndefined();
  });

  test("a layer, a facet and a Vega-Lite $schema are a chart's shapes too", () => {
    expect(
      refused({
        $schema: "https://vega.github.io/schema/vega-lite/v6.json",
        layer: [BAR, { mark: { type: "rule" }, encoding: { y: { datum: 3 } } }],
      }),
    ).toEqual([]);
    expect(refused({ facet: { field: "owner" }, spec: BAR })).toEqual([]);
  });

  test("data of its own is refused wherever it is, so the rows are the query's", () => {
    expect(refused({ ...BAR, data: { url: "https://example.com/x.csv" } })).toEqual([
      "spec.data: Expected no excess property",
    ]);
    expect(refused({ ...BAR, datasets: { a: [] } })).toEqual([
      "spec.datasets: Expected no excess property",
    ]);
    expect(refused({ layer: [{ ...BAR, data: { values: [{ a: 1 }] } }] })).toEqual([
      "spec.layer.0.data: a chart's data is its query's rows, so a spec holds none",
    ]);
  });

  test("a url anywhere is refused: a stored spec fetches nothing", () => {
    expect(refused({ ...BAR, encoding: { ...BAR.encoding, url: { field: "img" } } })).toEqual([
      "spec.encoding.url: a chart fetches nothing, so a spec names no url",
    ]);
    expect(
      refused({ ...BAR, transform: [{ lookup: "id", from: { data: { url: "x.json" } } }] }),
    ).toEqual([
      "spec.transform.0.from.data: a chart's data is its query's rows, so a spec holds none",
    ]);
  });

  test("a spec that draws nothing, a plain Vega spec and a mark Vega-Lite lacks are refused", () => {
    expect(refused({ encoding: BAR.encoding })).toEqual([
      "spec: draws nothing: give it one of mark, layer, concat, hconcat, vconcat, facet, repeat",
    ]);
    expect(refused({ ...BAR, $schema: "https://vega.github.io/schema/vega/v6.json" })).toHaveLength(
      1,
    );
    expect(refused({ ...BAR, mark: "pie" })).toHaveLength(1);
    expect(refused("bar")).toHaveLength(1);
  });
});

describe("chart view node", () => {
  test("its source is its focus, else the node it is shown for", () => {
    const props: NodeProps = {
      [SYSTEM_IDS.chartField]: [{ t: "str", v: JSON.stringify(BAR) }],
    };
    expect(paramsFromProps(ChartView, props, "q.host", quiet)).toEqual(
      Result.succeed({ source: "q.host", spec: BAR }),
    );
    const focused: NodeProps = {
      ...props,
      [SYSTEM_IDS.lensFocusField]: [{ t: "ref", v: "q.other" }],
    };
    expect(paramsFromProps(ChartView, focused, "q.host", quiet)).toEqual(
      Result.succeed({ source: "q.other", spec: BAR }),
    );
  });

  test("a source proposed is stored as its focus and reads back", () => {
    const proposal = viewNodeFor(ChartView, { source: "q.todos", spec: BAR }, null);
    expect(Result.isSuccess(proposal)).toBe(true);
    if (Result.isSuccess(proposal))
      expect(proposal.success.props[SYSTEM_IDS.lensFocusField]).toEqual([
        { t: "ref", v: "q.todos" },
      ]);
  });

  test("holding no spec, it draws the count of its rows", () => {
    expect(paramsFromProps(ChartView, {}, "q.host", quiet)).toEqual(
      Result.succeed({ source: "q.host", spec: starterChartSpec([]) }),
    );
  });

  test("a spec that is not JSON is reported, and the view cannot be read", () => {
    const reported: string[] = [];
    const props: NodeProps = { [SYSTEM_IDS.chartField]: [{ t: "str", v: "{mark: bar" }] };
    const params = paramsFromProps(ChartView, props, "q.host", (w) => reported.push(w));
    expect(Result.isFailure(params)).toBe(true);
    expect(reported).toEqual([`${SYSTEM_IDS.chartField} is not JSON`]);
  });

  test("a stored spec with data of its own does not decode, so it is never drawn", () => {
    const props: NodeProps = {
      [SYSTEM_IDS.chartField]: [
        { t: "str", v: JSON.stringify({ layer: [{ ...BAR, data: { url: "x" } }] }) },
      ],
    };
    expect(Result.isFailure(paramsFromProps(ChartView, props, "q.host", quiet))).toBe(true);
  });
});

describe("chart data", () => {
  const records = [
    { id: "a", status: "doing" },
    { id: "b", status: "done" },
  ];

  test("the query's rows are the spec's named data, fitted to the box it is drawn in", () => {
    expect(chartSpecWithData(BAR, records, { width: 480, height: 300 })).toEqual({
      ...BAR,
      width: 480,
      height: 300,
      autosize: { type: "fit", contains: "padding" },
      data: { name: CHART_DATA, values: records },
    });
    const layered = { layer: [BAR] };
    expect(chartSpecWithData(layered, records, { width: 480 })).toMatchObject({ width: 480 });
  });

  test("a size the spec sets, or a composition's own, is kept", () => {
    const sized = chartSpecWithData({ ...BAR, width: 300 }, records, { width: 480 });
    expect(sized["width"]).toBe(300);
    expect(sized["autosize"]).toBeUndefined();
    const composed = chartSpecWithData({ hconcat: [BAR, BAR] }, records, { width: 480 });
    expect(composed["width"]).toBeUndefined();
    expect(fillsChartBox({ facet: { field: "a" }, spec: BAR })).toBe(false);
  });

  test("the starter draws a measure by a category, else counts rows by one", () => {
    expect(starterChartSpec(["id", "text", "status"])).toEqual({
      mark: "bar",
      encoding: {
        x: { field: "text", type: "nominal", sort: "-y" },
        y: { aggregate: "count", type: "quantitative", title: "Rows" },
      },
    });
    expect(starterChartSpec(["status", "count_n"])).toEqual({
      mark: "bar",
      encoding: {
        x: { field: "status", type: "nominal", sort: "-y" },
        y: { field: "count_n", type: "quantitative" },
      },
    });
    expect(starterChartSpec(["node_id"])).toEqual({
      mark: "bar",
      encoding: { y: { aggregate: "count", type: "quantitative", title: "Rows" } },
    });
    for (const columns of [[], ["id"], ["a", "b"], ["sum_x"]])
      expect(
        Result.isSuccess(paramsIssues(ChartView, { spec: starterChartSpec(columns) }, true)),
      ).toBe(true);
  });

  test("a spec is described as its mark and channels, layer by layer", () => {
    expect(describeChartSpec(BAR)).toEqual([
      "- mark: bar",
      "- x: status (nominal)",
      "- y: count (quantitative)",
    ]);
    expect(
      describeChartSpec({
        layer: [{ mark: { type: "line" }, encoding: { y: { field: "n", aggregate: "sum" } } }],
      }),
    ).toEqual(["- layer 1:", "  - mark: line", "  - y: sum of n"]);
  });
});

describe("chart catalog entry", () => {
  const entry = viewCatalog().find((e) => e.id === ChartView.id);

  test("its settings are a JSON Schema of the spec, which names no data of its own", () => {
    expect(entry?.label).toBe("Chart");
    expect(entry?.settings).toMatchObject({
      type: "object",
      required: ["spec"],
      properties: {
        source: { type: "string" },
        spec: { type: "object", additionalProperties: false },
      },
    });
    const settings = entry?.settings as { properties: { spec: { properties: object } } };
    const { spec } = settings.properties;
    expect(Object.keys(spec.properties)).toContain("mark");
    expect(Object.keys(spec.properties)).not.toContain("data");
  });

  test("its defaults are the count of rows, a legal proposal", () => {
    expect(entry?.defaults).toEqual({ spec: starterChartSpec([]) });
  });
});
