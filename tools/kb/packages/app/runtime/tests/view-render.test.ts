/**
 * `render.view` renders a view node by its id through the one render path a
 * docs view's name also takes: a docs view through its template, any other
 * view node as its markdown (the view, its settings, the nodes it shows).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SYSTEM_IDS, present } from "@kb/model";
import { ViewCatalog, viewDef, type KbContext, type ViewDef } from "@kb/contracts";
import { coreExtension, renderViewNodeEffect } from "@kb/operations";
import { CodeView, viewCatalogOf, type ViewCatalogOf } from "@kb/views";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";

const FRAME = "n.render-frame";
const STATUS = "f.render-status";
const BOARD = { filters: [], sort: [], display: [], groupFieldId: STATUS };

let root: string;
let ctx: KbContext;

async function mustInvoke(id: string, input: unknown): Promise<unknown> {
  const receipt = await invoke(ctx, { id, input });
  if (receipt.status !== "succeeded") throw new Error(`${id}: ${receipt.message}`);
  return receipt.output;
}

async function render(input: Record<string, unknown>): Promise<{ name: string; content: string }> {
  return (await mustInvoke("render.view", input)) as { name: string; content: string };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-view-render-"));
  ctx = await openKb(root);
  await mustInvoke("field.define", { name: "status", id: STATUS });
  await mustInvoke("node.add", { id: FRAME, text: "Todos" });
  await mustInvoke("node.add", { id: "n.ship", text: "Ship it", parent: FRAME });
  await mustInvoke("node.add", { id: "n.test", text: "Test it", parent: FRAME });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("render.view by view node id", () => {
  test("a frame view renders as its view, its settings and its host's rows", async () => {
    await mustInvoke("view.propose", {
      view: "outline.board",
      params: BOARD,
      host: FRAME,
      id: "v.b",
    });
    const md = await render({ id: "v.b", format: "md" });
    expect(md.name).toBe("Board view");
    expect(md.content).toContain(
      "Board view (outline.board), view node v.b, shown for Todos (n.render-frame).",
    );
    expect(md.content).toContain(`- groupFieldId: "${STATUS}"`);
    expect(md.content).toContain("## Rows\n\n- Ship it (n.ship)\n- Test it (n.test)\n");
    const html = await render({ id: "v.b" });
    expect(html.content).toContain("<h2>Rows</h2>");
    expect(html.content).toContain("<li>Ship it (n.ship)</li>");
  });

  test("a graph view renders the nodes its lens query finds", async () => {
    await mustInvoke("node.add", {
      id: "v.graph",
      text: "Shipping",
      props: [
        { field: SYSTEM_IDS.viewField, value: { t: "ref", v: "sys.view.graph.tree" } },
        {
          field: SYSTEM_IDS.lensQueryField,
          value: { t: "str", v: '[:find ?id :where [?n :node/id "n.ship"] [?n :node/id ?id]]' },
        },
      ],
    });
    const md = await render({ id: "v.graph", format: "md" });
    expect(md.content).toContain("# Shipping\n\nTree view (graph.tree), view node v.graph.");
    expect(md.content).toContain("## Nodes\n\n- Ship it (n.ship)\n");
  });

  test("a docs view renders the same by its id as by its name", async () => {
    // A docs view proposed like any other view: its text is its name.
    await mustInvoke("view.propose", {
      view: "docs.markdown",
      params: {
        query: '[:find ?id :where [?n :node/id "n.ship"] [?n :node/id ?id]]',
        template: "todos",
        output: "docs/kb/x.md",
      },
      text: "todos-by-id",
      id: "v.docs",
    });
    const byName = await render({ name: "todos-by-id", format: "md" });
    expect(byName.content).toContain("Ship it");
    expect(await render({ id: "v.docs", format: "md" })).toEqual(byName);
  });

  test("a chart renders as its encoding and its query's rows, and its page as SVG", async () => {
    await mustInvoke("node.add", {
      id: "q.todos",
      text: "Todo texts",
      props: [
        {
          field: SYSTEM_IDS.queryField,
          value: {
            t: "str",
            v: '[:find ?id ?text :where [?f :node/id "n.render-frame"] [?f :node/child ?n] [?n :node/id ?id] [?n :node/text ?text]]',
          },
        },
      ],
    });
    await mustInvoke("view.propose", {
      view: "chart.vega-lite",
      params: {
        spec: {
          mark: "bar",
          encoding: {
            x: { field: "text", type: "nominal" },
            y: { aggregate: "count", type: "quantitative" },
          },
        },
      },
      host: "q.todos",
      id: "v.chart",
    });
    const md = await render({ id: "v.chart", format: "md" });
    expect(md.content).toContain(
      "Chart view (chart.vega-lite), view node v.chart, shown for Todo texts (q.todos).",
    );
    expect(md.content).toContain(
      "## Chart\n\n- mark: bar\n- x: text (nominal)\n- y: count (quantitative)\n",
    );
    expect(md.content).toContain("The rows of Todo texts (q.todos).");
    expect(md.content).toContain("| id | text |\n| --- | --- |\n");
    expect(md.content).toContain("| n.ship | Ship it |");
    expect(md.content).toContain("| n.test | Test it |");
    const html = await render({ id: "v.chart" });
    expect(html.content).toContain("<figure");
    expect(html.content).toContain("<svg");
    expect(html.content).toContain("<td>Ship it</td>");
  });

  test("a chart shown for no query node says it draws nothing, and draws no figure", async () => {
    await mustInvoke("view.propose", {
      view: "chart.vega-lite",
      params: { spec: { mark: "point" } },
      host: FRAME,
      id: "v.lost",
    });
    const md = await render({ id: "v.lost", format: "md" });
    expect(md.content).toContain("Todos (n.render-frame) is no query node with a query");
    expect((await render({ id: "v.lost" })).content).not.toContain("<figure");
  });

  test("a code view an agent proposes renders as its code, its grant and where it runs", async () => {
    const code = 'kb.draw(["p", {}, "```", kb.subject]);';
    await mustInvoke("view.propose", {
      view: "code.view",
      params: { code, grant: { reads: "subject", actions: ["node.update"] } },
      host: FRAME,
      id: "v.code",
    });
    const md = await render({ id: "v.code", format: "md" });
    expect(md.content).toContain("Code view (code.view), view node v.code, shown for Todos");
    expect(md.content).toContain("It runs only in the kb UI, sandboxed");
    expect(md.content).toContain("It may read its subject, and call node.update.");
    expect(md.content).toContain(`\`\`\`\`js\n${code}\n\`\`\`\``);
  });

  test("a view says itself in the text its catalog contribution carries, else generically", async () => {
    await mustInvoke("view.propose", {
      view: "code.view",
      params: { code: "kb.draw([]);", grant: { reads: "none", actions: [] } },
      host: FRAME,
      id: "v.code",
    });
    const renderWith = (catalog: ViewCatalogOf<ViewDef<unknown>>) =>
      Effect.runPromise(
        renderViewNodeEffect({ id: "v.code" }, "md").pipe(
          Effect.provideService(ViewCatalog, catalog),
          Effect.provide(kbRuntimeLayer(ctx)),
        ),
      );
    // The code view as core contributes it, its text included, and the same key bare.
    const declared = present(
      coreExtension.views?.find((view) => view.key === CodeView),
      "core declares the code view",
    );
    const contributed = (await renderWith(viewCatalogOf([declared]))).content;
    expect(contributed).toContain("It runs only in the kb UI, sandboxed");
    const bare = (await renderWith(viewCatalogOf([viewDef(CodeView)]))).content;
    expect(bare).not.toContain("It runs only in the kb UI");
    expect(bare).toContain("## Settings");
  });

  test("a code view's page draws what its code draws, read-only, as of the render", async () => {
    const code = [
      "const host = await kb.node(kb.subject, 1);",
      "let wrote;",
      'try { await kb.invoke("node.update", { id: kb.subject, text: "changed" }); wrote = "wrote"; }',
      "catch (e) { wrote = e.code; }",
      'kb.draw(["ul", { class: "kids" }, ...host.children.map((c) => ["li", {}, c.text]),',
      '  ["li", { onclick: "x" }, wrote]]);',
    ].join("\n");
    await mustInvoke("view.propose", {
      view: "code.view",
      params: { code, grant: { reads: "subject", actions: ["node.update"] } },
      host: FRAME,
      id: "v.snap",
    });
    const html = await render({ id: "v.snap" });
    expect(html.content).toContain(
      '<figure style="margin:0 0 1rem"><ul class="kids"><li>Ship it</li><li>Test it</li><li>forbidden</li></ul></figure>',
    );
    expect(ctx.index.getNode(FRAME)?.text).toBe("Todos");
  });

  test("a code view whose code loops says so on its page", async () => {
    await mustInvoke("view.propose", {
      view: "code.view",
      params: { code: "while (true) {}", grant: { reads: "none", actions: [] } },
      host: FRAME,
      id: "v.loop",
    });
    const html = await render({ id: "v.loop" });
    expect(html.content).toContain("ran longer than 500 ms in one turn and was interrupted");
  });

  test("a node that is no view node, a missing one, or two refs at once are refused", async () => {
    expect(await invoke(ctx, { id: "render.view", input: { id: FRAME } })).toMatchObject({
      status: "failed",
      code: "invalid_input",
    });
    expect(await invoke(ctx, { id: "render.view", input: { id: "n.nobody" } })).toMatchObject({
      status: "failed",
      code: "not_found",
    });
    expect(
      await invoke(ctx, { id: "render.view", input: { id: "v.x", name: "todos" } }),
    ).toMatchObject({ status: "failed", code: "invalid_input" });
  });
});
