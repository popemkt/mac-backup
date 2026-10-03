import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { ViewKeyPoint, defineExtension } from "@kb/contracts";
import { definePlugin, makeKernel } from "@kb/plugin";
import { extensionContract } from "@kb/test-kit";
import { BUNDLED_EXTENSIONS, serverEntriesFor } from "../src/bundled.ts";

// Every family the server bundles keeps the one extension contract.
for (const { declaration, entry } of BUNDLED_EXTENSIONS) extensionContract(declaration, entry);

describe("the contract's seed, view and text promises have a subject", () => {
  test("chart declares a seed and a view whose text the server's entry paints", () => {
    const chart = BUNDLED_EXTENSIONS.find(({ declaration }) => declaration.name === "chart");
    expect(chart?.declaration.seed?.("2026-01-01T00:00:00.000Z").length).toBeGreaterThan(0);
    expect(chart?.declaration.views?.map((view) => view.key.id)).toEqual(["chart.vega-lite"]);
    const contributed = Effect.runSync(
      Effect.gen(function* () {
        const kernel = makeKernel();
        if (chart !== undefined) yield* kernel.load(chart.entry);
        const views = kernel.contributions(ViewKeyPoint).map(({ value }) => value);
        yield* kernel.shutdown;
        return views;
      }),
    );
    expect(contributed.map((view) => view.text?.figure !== undefined)).toEqual([true]);
  });
});

const plugin = (name: string) => definePlugin({ name, apply: () => Effect.void });
const family = (name: string) => defineExtension({ name, label: name });

describe("the server's entries are resolved from the one bundled list", () => {
  test("the resolved list is the bundled families, in order", () => {
    expect(BUNDLED_EXTENSIONS.map(({ declaration }) => declaration)).toEqual([...BUNDLED_FAMILIES]);
  });

  test("a bundled family with no server entry fails", () => {
    expect(() => serverEntriesFor([family("a"), family("b")], [plugin("a")])).toThrow(
      "bundled family b has no server entry",
    );
  });

  test("a server entry that names no bundled family fails", () => {
    expect(() => serverEntriesFor([family("a")], [plugin("a"), plugin("z")])).toThrow(
      "server entries z name no bundled family",
    );
  });
});
