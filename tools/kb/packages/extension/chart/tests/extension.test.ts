/**
 * The chart family owns its vocabulary: its declaration seeds `sys.f.chart`
 * under the id core once declared, lists the chart view, and both hosts'
 * entries are its shared plugin, differing only in the painter they hand it.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ViewKeyPoint } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import { CHART_IDS, ChartView, chartExtension, chartPlugin, type ChartPainter } from "@kb/chart";

const AT = "2026-01-01T00:00:00.000Z";
const PAINTER: ChartPainter = { svg: () => Effect.succeed("<svg/>") };

/** The chart view's text as a plugin contributes it. */
function contributedText(painter?: ChartPainter) {
  return Effect.runSync(
    Effect.gen(function* () {
      const kernel = makeKernel();
      yield* kernel.load(chartPlugin(painter === undefined ? {} : { painter }));
      const views = kernel.contributions(ViewKeyPoint).map(({ id, value }) => ({ id, value }));
      yield* kernel.shutdown;
      return views;
    }),
  );
}

describe("chart family", () => {
  test("its declaration seeds the chart field under its frozen id", () => {
    expect(chartExtension.seed?.(AT).map((node) => node.id)).toEqual(["sys.f.chart"]);
    expect(CHART_IDS.chartField).toBe("sys.f.chart");
  });

  test("its declaration lists the chart view", () => {
    expect(chartExtension.views?.map((view) => view.key)).toEqual([ChartView]);
  });

  test("its plugin takes the declaration's name, and draws a figure only with a painter", () => {
    expect(chartPlugin().name).toBe(chartExtension.name);
    const bare = contributedText();
    const painted = contributedText(PAINTER);
    expect(bare.map((view) => view.id)).toEqual([ChartView.id]);
    expect(painted.map((view) => view.id)).toEqual([ChartView.id]);
    expect(bare.map((view) => view.value.text?.figure !== undefined)).toEqual([false]);
    expect(painted.map((view) => view.value.text?.figure !== undefined)).toEqual([true]);
  });
});
