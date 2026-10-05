import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { ActionPoint, ViewKeyPoint, defineExtension } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { definePlugin, makeKernel } from "@kb/plugin";
import { extensionContract, type SwitchingHost } from "@kb/test-kit";
import { BUNDLED_EXTENSIONS, serverEntriesFor } from "../src/bundled.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { invoke } from "../src/invoke.ts";
import { kbRuntimeLayer } from "../src/layers.ts";
import { registryFor } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

/** A spec that draws the count of a query's rows: one bar, whatever the columns. */
const COUNT_ROWS = { mark: "bar", encoding: { y: { aggregate: "count", type: "quantitative" } } };

/** The registry as the host of a bundled family: what it loads and reports over a store's switches. */
function registryHost(name: string): SwitchingHost {
  return {
    compose: (nodeOf) =>
      registryFor(null, nodeOf).pipe(
        Effect.map(({ families, kernel }) => ({
          row: families.find((family) => family.name === name),
          kernel,
        })),
        Effect.provide(bunFileSystemLayer),
      ),
  };
}

// Every family the server bundles keeps the one extension contract, the registry its host.
for (const { declaration, entry } of BUNDLED_EXTENSIONS) {
  extensionContract(declaration, entry, registryHost(declaration.name));
}

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

  test("code declares a seed and a view, and on the runtime its figure is a snapshot", async () => {
    const code = BUNDLED_EXTENSIONS.find(({ declaration }) => declaration.name === "code");
    expect(code?.declaration.seed?.("2026-01-01T00:00:00.000Z").map((node) => node.id)).toEqual([
      "sys.f.code",
      "sys.f.code.grant",
    ]);
    expect(code?.declaration.views?.map((view) => view.key.id)).toEqual(["code.view"]);
    const ctx = await openKb(root);
    const added = await invoke(ctx, { id: "node.add", input: { id: "n.subject", text: "Drawn" } });
    expect(added.status).toBe("succeeded");
    const params = {
      source: "n.subject",
      code: 'const node = await kb.node(kb.subject); kb.draw(["p", {}, node.text]);',
      grant: { reads: "subject", actions: [] },
    };
    const texts = await Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        if (code !== undefined) yield* kernel.load(code.entry);
        const views = kernel.contributions(ViewKeyPoint).map(({ value }) => value);
        yield* kernel.shutdown;
        return yield* Effect.forEach(views, (view) =>
          Effect.gen(function* () {
            const figure = view.text?.figure?.(ctx, params, null) ?? Effect.succeed(null);
            return {
              body: view.text?.body(ctx, params, null).join("\n") ?? "",
              // The page binds no engine: the same figure draws nothing there.
              bare: yield* figure,
              snapshot: yield* figure.pipe(Effect.provide(kbRuntimeLayer(ctx))),
            };
          }),
        );
      }),
    );
    expect(texts.map(({ body }) => body.includes(`\`\`\`js\n${params.code}\n\`\`\``))).toEqual([
      true,
    ]);
    expect(texts.map(({ bare }) => bare)).toEqual([null]);
    expect(texts.map(({ snapshot }) => snapshot)).toEqual(["<p>Drawn</p>"]);
  });

  test("lab declares a view and no seed, and the server names its page through the family", async () => {
    const lab = BUNDLED_EXTENSIONS.find(({ declaration }) => declaration.name === "lab");
    expect(lab?.declaration.seed).toBeUndefined();
    expect(lab?.declaration.views?.map((view) => view.key.id)).toEqual(["lab.page"]);
    expect(lab?.declaration.views?.map((view) => view.text)).toEqual([undefined]);
    const ctx = await openKb(root);
    // The option the fold derives from the family's key, where E4b froze it.
    const options = ctx.index.getNode(SYSTEM_IDS.viewsRoot)?.children ?? [];
    const at = options.indexOf("sys.view.lab.page");
    expect(options.slice(at - 1, at + 2)).toEqual([
      "sys.view.canvas.page",
      "sys.view.lab.page",
      "sys.view.code.view",
    ]);
    const added = await invoke(ctx, {
      id: "node.add",
      input: {
        id: "v.lab",
        text: "",
        props: [{ field: SYSTEM_IDS.viewField, value: { t: "ref", v: "sys.view.lab.page" } }],
      },
    });
    expect(added.status).toBe("succeeded");
    // The lab is optional, so the registry holds its key only while the store has it on.
    const on = await invoke(ctx, { id: "extension.switch", input: { name: "lab", on: true } });
    expect(on.status).toBe("succeeded");
    const rendered = await invoke(ctx, { id: "render.view", input: { id: "v.lab", format: "md" } });
    // The registry's catalog holds the key, so the page reads as the lab's, in the generic text.
    expect(rendered).toMatchObject({ status: "succeeded", output: { name: "Lab view" } });
    const { content } = (rendered.status === "succeeded" ? rendered.output : {}) as {
      content?: string;
    };
    expect(content).toContain("Lab view (lab.page), view node v.lab.");
  });

  test("canvas declares its tag, its field and two views, and its server entry holds both halves", async () => {
    const canvas = BUNDLED_EXTENSIONS.find(({ declaration }) => declaration.name === "canvas");
    expect(canvas?.declaration.seed?.("2026-01-01T00:00:00.000Z").map((node) => node.id)).toEqual([
      "sys.f.canvas",
      "sys.tag.canvas",
    ]);
    expect(canvas?.declaration.views?.map((view) => view.key.id)).toEqual([
      "canvas.list",
      "canvas.page",
    ]);
    expect(canvas?.declaration.views?.map((view) => view.text)).toEqual([undefined, undefined]);
    // The server's entry is the family's actions with its shared plugin as a child.
    const held = await Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        if (canvas !== undefined) yield* kernel.load(canvas.entry);
        const views = kernel.contributions(ViewKeyPoint).map(({ id }) => id);
        const actions = kernel.contributions(ActionPoint).map(({ id }) => id);
        yield* kernel.shutdown;
        return { views, actions };
      }),
    );
    expect(held.views).toEqual(["canvas.list", "canvas.page"]);
    expect(held.actions).toContain("ext.canvas.tx.apply");
    const ctx = await openKb(root);
    // Core's options first, then the canvas's, where E4b froze them.
    const options = ctx.index.getNode(SYSTEM_IDS.viewsRoot)?.children ?? [];
    const at = options.indexOf("sys.view.canvas.list");
    expect(options.slice(at - 1, at + 3)).toEqual([
      "sys.view.layout.node",
      "sys.view.canvas.list",
      "sys.view.canvas.page",
      "sys.view.lab.page",
    ]);
    const added = await invoke(ctx, {
      id: "node.add",
      input: {
        id: "v.canvases",
        text: "",
        props: [{ field: SYSTEM_IDS.viewField, value: { t: "ref", v: "sys.view.canvas.list" } }],
      },
    });
    expect(added.status).toBe("succeeded");
    const rendered = await invoke(ctx, {
      id: "render.view",
      input: { id: "v.canvases", format: "md" },
    });
    // The registry's catalog holds the family's key, so the list reads as the canvas's.
    expect(rendered).toMatchObject({ status: "succeeded", output: { name: "Canvases view" } });
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
