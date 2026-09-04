import { dirname, join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx } from "@kb/contracts";
import type { ExtensionAction, ExtensionTemplate, TemplateRegistry } from "@kb/contracts";
import { DocsError, loadViewsEffect, renderViewEffect } from "@kb/operations";
import { rules } from "./rules.ts";
import { todos } from "./todos.ts";

/**
 * Bundled example extension: repo-doc materialization policy.
 *
 * Core ships the mechanism (view specs, the render backbone, renderView);
 * this extension ships the policy — the templates and which md files get
 * written where. It is the reference for `.kb/extensions/*.ts` modules:
 * same shape, same loading path, just registered from inside the package.
 *
 * Registered as `ext.docs.materialize` / `ext.docs.check` and the templates
 * `ext.docs.todos` / `ext.docs.rules`; the bare ids `docs.materialize`,
 * `docs.check`, `todos` and `rules` stay as aliases so pre-commit, existing
 * callers and existing view specs keep working.
 *
 * Handlers are Effect-native (`effect`) — no Promise nest under registry.
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

type DocsEnv = KbCtx | FileSystem | TemplateRegistry;

function mapDocsFs(err: unknown, message: string): DocsError {
  return new DocsError(
    "internal",
    `${message}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

export const docsMaterializeEffect = Effect.fn("ext.docs.materialize")(function* (
  input: z.infer<typeof viewInput>,
): Effect.fn.Return<z.infer<typeof materializeOutput>, DocsError, DocsEnv> {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const views = yield* loadViewsEffect(ctx.root, input.view);
  const written: { view: string; output: string }[] = [];
  for (const view of views) {
    const content = yield* renderViewEffect(view);
    const path = join(ctx.root, view.spec.output);
    yield* fs
      .makeDirectory(dirname(path), { recursive: true })
      .pipe(Effect.mapError((err) => mapDocsFs(err, `mkdir ${dirname(path)}`)));
    yield* fs
      .writeFileString(path, content)
      .pipe(Effect.mapError((err) => mapDocsFs(err, `write ${path}`)));
    written.push({ view: view.name, output: view.spec.output });
  }
  return { written };
});

export const docsCheckEffect = Effect.fn("ext.docs.check")(function* (
  input: z.infer<typeof viewInput>,
): Effect.fn.Return<z.infer<typeof checkOutput>, DocsError, DocsEnv> {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const views = yield* loadViewsEffect(ctx.root, input.view);
  const results: z.infer<typeof checkOutput>["views"] = [];
  for (const view of views) {
    const expected = yield* renderViewEffect(view);
    const path = join(ctx.root, view.spec.output);
    const status = yield* fs.readFileString(path).pipe(
      Effect.map((actual) => (actual === expected ? ("clean" as const) : ("stale" as const))),
      Effect.catch(() => Effect.succeed("missing" as const)),
    );
    results.push({ view: view.name, output: view.spec.output, status });
  }
  return {
    clean: results.every((r) => r.status === "clean"),
    views: results,
  };
});

const actions: ExtensionAction[] = [
  {
    id: "materialize",
    title: "Materialize docs",
    description: "Run view specs from .kb/views (all, or one by name) and write generated markdown",
    mode: "apply",
    inputSchema: viewInput,
    outputSchema: materializeOutput,
    aliases: ["docs.materialize"],
    effect: docsMaterializeEffect,
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
    effect: docsCheckEffect,
  },
];

const templates: ExtensionTemplate[] = [
  { id: "todos", aliases: ["todos"], template: todos },
  { id: "rules", aliases: ["rules"], template: rules },
];

export const docsActions = actions;
export const docsTemplates = templates;
export { rules } from "./rules.ts";
export { todos } from "./todos.ts";
