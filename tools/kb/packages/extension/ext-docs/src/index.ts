import { dirname, join } from "node:path";
import { Effect, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx, ReadInvoke, extensionPlugin } from "@kb/contracts";
import type { ExtensionAction, ExtensionTemplate } from "@kb/contracts";
import { docsExtension } from "@kb/docs";
import { type DomainError, domainError } from "@kb/model";
import { type DocsView, docsViewNamed, docsViewsOf } from "@kb/views";
import { rules } from "./rules.ts";
import { todos } from "./todos.ts";

/**
 * Bundled example extension: repo-doc materialization policy.
 *
 * Core ships the mechanism (docs view nodes, which ones a graph holds, and
 * the render backbone behind `render.view`); this extension ships the policy —
 * the templates and which md files get written where. A docs view's bytes
 * are the backbone's, reached as every surface reaches it: `render.view`,
 * called through the host's `ReadInvoke`. It is the reference for
 * `.kb/extensions/*.ts` modules: same shape, same loading path, just
 * registered from inside the package.
 *
 * Registered as `ext.docs.materialize` / `ext.docs.check` and the templates
 * `ext.docs.todos` / `ext.docs.rules`; the bare ids `docs.materialize`,
 * `docs.check`, `todos` and `rules` stay as aliases so pre-commit, existing
 * callers and existing docs views keep working.
 *
 * Handlers are Effect-native (`effect`) — no Promise nest under registry.
 */

const viewInput = z.object({
  view: z.string().optional(),
});

/** One line for each docs view node that cannot be read as one; the rest are still done. */
const warningsSchema = z.array(z.string());

export const materializeOutput = z.object({
  written: z.array(z.object({ view: z.string(), output: z.string() })),
  warnings: warningsSchema,
});

export const checkOutput = z.object({
  clean: z.boolean(),
  views: z.array(
    z.object({
      view: z.string(),
      output: z.string(),
      status: z.enum(["clean", "stale", "missing"]),
    }),
  ),
  warnings: warningsSchema,
});

type DocsEnv = KbCtx | FileSystem;

/**
 * The docs views an action runs over: the one it names, which must be one, or
 * every one that can be read, with a warning for each that cannot.
 */
const selectedViews = Effect.fn("ext.docs.views")(function* (
  input: z.infer<typeof viewInput>,
): Effect.fn.Return<
  { views: readonly DocsView[]; warnings: readonly string[] },
  DomainError,
  KbCtx
> {
  const { nodes } = yield* KbCtx;
  if (input.view === undefined) return docsViewsOf(nodes);
  const named = docsViewNamed(nodes, input.view);
  if (Result.isSuccess(named)) return { views: [named.success], warnings: [] };
  const { code, message, details } = named.failure;
  return yield* domainError(code, message, details);
});

/** What `render.view` returns that a docs action reads: the view's markdown. */
const renderedSchema = z.object({ content: z.string() });

/**
 * A docs view's file content — the generated header and its template's
 * output — as `render.view` renders it as md, the same bytes every surface
 * gets. A failed render fails this action the same way.
 */
const renderedView = Effect.fn("ext.docs.render")(function* (
  view: DocsView,
): Effect.fn.Return<string, DomainError> {
  const invoke = yield* ReadInvoke;
  if (invoke === null)
    return yield* domainError("internal", "rendering a docs view needs the host's ReadInvoke");
  const receipt = yield* invoke({ id: "render.view", input: { name: view.name, format: "md" } });
  if (receipt.status === "failed") {
    const code = receipt.code === "unknown_action" ? "internal" : receipt.code;
    return yield* domainError(code, receipt.message, receipt.details);
  }
  const rendered = renderedSchema.safeParse(receipt.output);
  if (!rendered.success)
    return yield* domainError("internal", `render.view gave no content for view ${view.name}`);
  return rendered.data.content;
});

function mapDocsFs(err: unknown, message: string): DomainError {
  return domainError("internal", `${message}: ${err instanceof Error ? err.message : String(err)}`);
}

export const docsMaterializeEffect = Effect.fn("ext.docs.materialize")(function* (
  input: z.infer<typeof viewInput>,
): Effect.fn.Return<z.infer<typeof materializeOutput>, DomainError, DocsEnv> {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const { views, warnings } = yield* selectedViews(input);
  const written: { view: string; output: string }[] = [];
  for (const view of views) {
    const content = yield* renderedView(view);
    const path = join(ctx.root, view.spec.output);
    yield* fs
      .makeDirectory(dirname(path), { recursive: true })
      .pipe(Effect.mapError((err) => mapDocsFs(err, `mkdir ${dirname(path)}`)));
    yield* fs
      .writeFileString(path, content)
      .pipe(Effect.mapError((err) => mapDocsFs(err, `write ${path}`)));
    written.push({ view: view.name, output: view.spec.output });
  }
  return { written, warnings: [...warnings] };
});

export const docsCheckEffect = Effect.fn("ext.docs.check")(function* (
  input: z.infer<typeof viewInput>,
): Effect.fn.Return<z.infer<typeof checkOutput>, DomainError, DocsEnv> {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const { views, warnings } = yield* selectedViews(input);
  const results: z.infer<typeof checkOutput>["views"] = [];
  for (const view of views) {
    const expected = yield* renderedView(view);
    const path = join(ctx.root, view.spec.output);
    const status = yield* fs.readFileString(path).pipe(
      Effect.map((actual) => (actual === expected ? ("clean" as const) : ("stale" as const))),
      Effect.orElseSucceed(() => "missing" as const),
    );
    results.push({ view: view.name, output: view.spec.output, status });
  }
  return {
    clean: results.every((r) => r.status === "clean"),
    views: results,
    warnings: [...warnings],
  };
});

const actions: ExtensionAction[] = [
  {
    id: "materialize",
    title: "Materialize docs",
    description: "Render the docs views (all, or one by name) and write the generated markdown",
    mode: { kind: "write" },
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
    mode: { kind: "read" },
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

/** The docs family's server entry: `ext.docs.*`, with its bare legacy aliases. */
export const docsPlugin = extensionPlugin({ name: docsExtension.name, actions, templates });
export { rules } from "./rules.ts";
export { todos } from "./todos.ts";
