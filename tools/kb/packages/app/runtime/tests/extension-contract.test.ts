import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { ViewKeyPoint, defineExtension } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { definePlugin, makeKernel } from "@kb/plugin";
import { extensionContract } from "@kb/test-kit";
import { BUNDLED_EXTENSIONS, serverEntriesFor } from "../src/bundled.ts";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

/** A spec that draws the count of a query's rows: one bar, whatever the columns. */
const COUNT_ROWS = { mark: "bar", encoding: { y: { aggregate: "count", type: "quantitative" } } };

// Every family the server bundles keeps the one extension contract.
for (const { declaration, entry } of BUNDLED_EXTENSIONS) extensionContract(declaration, entry);

describe("the contract's seed, view and text promises have a subject", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-extension-subject-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("chart declares a seed and a view, and the server's entry paints its figure", async () => {
    const chart = BUNDLED_EXTENSIONS.find(({ declaration }) => declaration.name === "chart");
    expect(chart?.declaration.seed?.("2026-01-01T00:00:00.000Z").length).toBeGreaterThan(0);
    expect(chart?.declaration.views?.map((view) => view.key.id)).toEqual(["chart.vega-lite"]);
    const ctx = await openKb(root);
    const added = await invoke(ctx, {
      id: "node.add",
      input: {
        id: "q.views",
        text: "View types",
        props: [
          {
            field: SYSTEM_IDS.queryField,
            value: { t: "str", v: "[:find ?id :where [?n :node/id ?id]]" },
          },
        ],
      },
    });
    expect(added.status).toBe("succeeded");
    const figures = await Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        if (chart !== undefined) yield* kernel.load(chart.entry);
        const views = kernel.contributions(ViewKeyPoint).map(({ value }) => value);
        yield* kernel.shutdown;
        return yield* Effect.forEach(views, (view) =>
          view.text?.figure === undefined
            ? Effect.succeed(null)
            : view.text.figure(ctx, { source: "q.views", spec: COUNT_ROWS }, null),
        );
      }),
    );
    // A painted figure, not the null a host without a painter, or a chart with no rows, draws.
    expect(figures.map((figure) => figure?.includes("<svg") ?? false)).toEqual([true]);
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
