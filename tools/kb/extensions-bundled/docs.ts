import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { KbContext } from "../src/context.ts";
import type { ExtensionAction } from "../src/extensions.ts";
import { loadViews, renderView } from "../src/operations/docs/index.ts";

/**
 * Bundled example extension: repo-doc materialization policy.
 *
 * Core ships the mechanism (view specs, templates, renderView); this
 * extension ships the policy — which md files get written where. It is
 * the reference for `.kb/extensions/*.ts` modules: same shape, same
 * loading path, just registered from inside the package.
 *
 * Registered as `ext.docs.materialize` / `ext.docs.check`; the legacy ids
 * `docs.materialize` / `docs.check` stay as aliases so pre-commit and
 * existing callers keep working.
 */

const viewInput = z.object({
  view: z.string().optional(),
});

const materializeOutput = z.object({
  written: z.array(z.object({ view: z.string(), output: z.string() })),
});

const checkOutput = z.object({
  clean: z.boolean(),
  views: z.array(
    z.object({
      view: z.string(),
      output: z.string(),
      status: z.enum(["clean", "stale", "missing"]),
    }),
  ),
});

async function docsMaterialize(
  ctx: KbContext,
  input: z.infer<typeof viewInput>,
): Promise<z.infer<typeof materializeOutput>> {
  const views = await loadViews(ctx.root, input.view);
  const written: { view: string; output: string }[] = [];
  for (const view of views) {
    const content = await renderView(ctx, view);
    const path = join(ctx.root, view.spec.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    written.push({ view: view.name, output: view.spec.output });
  }
  return { written };
}

async function docsCheck(
  ctx: KbContext,
  input: z.infer<typeof viewInput>,
): Promise<z.infer<typeof checkOutput>> {
  const views = await loadViews(ctx.root, input.view);
  const results: z.infer<typeof checkOutput>["views"] = [];
  for (const view of views) {
    const expected = await renderView(ctx, view);
    let status: "clean" | "stale" | "missing";
    try {
      const actual = await readFile(join(ctx.root, view.spec.output), "utf8");
      status = actual === expected ? "clean" : "stale";
    } catch {
      status = "missing";
    }
    results.push({ view: view.name, output: view.spec.output, status });
  }
  return {
    clean: results.every((r) => r.status === "clean"),
    views: results,
  };
}

const actions: ExtensionAction[] = [
  {
    id: "materialize",
    title: "Materialize docs",
    description:
      "Run view specs from .kb/views (all, or one by name) and write generated markdown",
    mode: "apply",
    inputSchema: viewInput,
    outputSchema: materializeOutput,
    aliases: ["docs.materialize"],
    handler: docsMaterialize,
  },
  {
    id: "check",
    title: "Check docs",
    description:
      "Materialize views to memory and diff against disk; report clean/stale/missing per view",
    mode: "read",
    inputSchema: viewInput,
    outputSchema: checkOutput,
    aliases: ["docs.check"],
    handler: docsCheck,
  },
];

export default actions;
