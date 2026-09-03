import { dirname, join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx } from "../src/context.ts";
import type { ExtensionAction } from "../src/extensions.ts";
import type { KbNode, NodeId } from "../src/foundation/model.ts";
import {
  DocsError,
  loadViewsEffect,
  renderText,
  renderViewEffect,
  templates,
  type TemplateContext,
} from "../src/operations/docs/index.ts";
import type { ActionEffectHandler } from "../src/shared/contracts.ts";

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

type DocsEnv = KbCtx | FileSystem;

function mapDocsFs(err: unknown, message: string): DocsError {
  return new DocsError(
    "internal",
    `${message}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

export const docsMaterializeEffect = Effect.fn("ext.docs.materialize")(
  function* (
    input: z.infer<typeof viewInput>,
  ): Effect.fn.Return<z.infer<typeof materializeOutput>, DocsError, DocsEnv> {
    const ctx = yield* KbCtx;
    const fs = yield* FileSystem;
    const views = yield* loadViewsEffect(ctx.root, input.view);
    const written: { view: string; output: string }[] = [];
    for (const view of views) {
      const content = yield* renderViewEffect(view);
      const path = join(ctx.root, view.spec.output);
      yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
        Effect.mapError((err) => mapDocsFs(err, `mkdir ${dirname(path)}`)),
      );
      yield* fs.writeFileString(path, content).pipe(
        Effect.mapError((err) => mapDocsFs(err, `write ${path}`)),
      );
      written.push({ view: view.name, output: view.spec.output });
    }
    return { written };
  },
);

export const docsCheckEffect = Effect.fn("ext.docs.check")(
  function* (
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
        Effect.map((actual) =>
          actual === expected ? ("clean" as const) : ("stale" as const),
        ),
        Effect.catch(() => Effect.succeed("missing" as const)),
      );
      results.push({ view: view.name, output: view.spec.output, status });
    }
    return {
      clean: results.every((r) => r.status === "clean"),
      views: results,
    };
  },
);

/* ------------------------------------------------------------------ *
 * The `rules` template — policy, so it lives with the policy that asks
 * for it rather than in core's template table.
 * ------------------------------------------------------------------ */

/** Strongest enforcement first, so `prose` rows (nothing checks them) sink. */
const ENFORCEMENT_ORDER = ["hook", "ci", "harness", "tsc", "lint", "prose"];

function enforcementRank(value: string): number {
  const i = ENFORCEMENT_ORDER.indexOf(value);
  return i >= 0 ? i : ENFORCEMENT_ORDER.length;
}

function typeRefIds(node: KbNode): NodeId[] {
  return (node.props["sys.f.type"] ?? [])
    .filter((pv) => pv.t === "ref")
    .map((pv) => pv.v as NodeId);
}

/** Ids of tag nodes whose text is `name` (a tag is a node typed `sys.tag`). */
function tagIdsNamed(ctx: TemplateContext, name: string): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const [id, node] of ctx.nodes) {
    if (node.text === name && typeRefIds(node).includes("sys.tag")) ids.add(id);
  }
  return ids;
}

function nodesTagged(ctx: TemplateContext, tagIds: Set<NodeId>): KbNode[] {
  const out: KbNode[] = [];
  for (const [, node] of ctx.nodes) {
    if (typeRefIds(node).some((ref) => tagIds.has(ref))) out.push(node);
  }
  return out;
}

/** First value of `field` on `node`, refs resolved to the target's text. */
function propText(
  ctx: TemplateContext,
  node: KbNode,
  field: string,
): string | undefined {
  const fieldId = ctx.fieldIdByName(field);
  const value = fieldId === undefined ? undefined : node.props[fieldId]?.[0];
  if (value === undefined) return undefined;
  if (value.t === "ref") {
    return ctx.nodes.get(value.v as NodeId)?.text ?? String(value.v);
  }
  return renderText(String(value.v), ctx);
}

/** Markdown table cells are single-line and `|` terminates one. */
function cell(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  return value.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/g, " ");
}

/**
 * `#rule` nodes as a table with an honest enforcement column, then the
 * `#gap` nodes. Rows: `[[nodeId], …]` — the gaps come from the graph, so
 * one view renders the whole rules index.
 */
export function rules(rows: unknown[][], ctx: TemplateContext): string {
  const ruleIds = [
    ...new Set(rows.map((r) => r[0]).filter((v): v is string => typeof v === "string")),
  ];
  const ruleNodes = ruleIds
    .map((id) => ctx.nodes.get(id))
    .filter((n): n is KbNode => n !== undefined)
    .sort(
      (a, b) =>
        enforcementRank(propText(ctx, a, "enforcement") ?? "") -
          enforcementRank(propText(ctx, b, "enforcement") ?? "") ||
        a.text.localeCompare(b.text),
    );

  const lines = [
    "# Rules",
    "",
    "Every rule that governs this repo, with its one home and what actually",
    "checks it. `enforcement` is honest: **`prose` means nothing checks it** —",
    "`gate` names the check that will.",
    "",
    "## Rules",
    "",
    "| Rule | Home | Scope | Principle | Enforcement | Gate |",
    "|---|---|---|---|---|---|",
  ];
  if (ruleNodes.length === 0) {
    lines.push("| _no rules recorded_ | — | — | — | — | — |");
  }
  for (const node of ruleNodes) {
    lines.push(
      `| ${cell(renderText(node.text, ctx))} | ${cell(propText(ctx, node, "home"))} | ` +
        `${cell(propText(ctx, node, "scope"))} | ${cell(propText(ctx, node, "principle"))} | ` +
        `${cell(propText(ctx, node, "enforcement"))} | ${cell(propText(ctx, node, "gate"))} |`,
    );
  }

  const gapNodes = nodesTagged(ctx, tagIdsNamed(ctx, "gap")).sort(
    (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id),
  );
  lines.push("", "## Gaps", "");
  if (gapNodes.length === 0) {
    lines.push("_No gaps recorded._");
  }
  for (const node of gapNodes) {
    lines.push(`### ${renderText(node.text, ctx)}`, "");
    for (const field of ["expected", "current", "impact", "closes", "rule"]) {
      const value = propText(ctx, node, field);
      if (value !== undefined && value !== "") {
        lines.push(`- **${field}** — ${value.replaceAll(/\s*\n\s*/g, " ")}`);
      }
    }
    lines.push(`- **node** — \`${node.id}\``, "");
  }

  return lines.join("\n");
}

// GAP [[01M1M08VXGJ5RTQJ3AJNK12G79]] — core exposes no template-registration
// seam, so this extension writes its template into core's table at load.
templates["rules"] = rules;

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
    effect: docsMaterializeEffect as ActionEffectHandler,
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
    effect: docsCheckEffect as ActionEffectHandler,
  },
];

export default actions;
