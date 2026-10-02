import { Effect } from "effect";
import { z } from "zod";
import {
  KbCtx,
  type ActionDefinition,
  type SavedQueries,
  type TemplateRegistry,
} from "@kb/contracts";
import {
  DomainError,
  docsViewNameOf,
  domainError,
  isDocsView,
  isViewNode,
  present,
  viewOptionOf,
} from "@kb/model";
import { DocsMarkdownView, catalogKeyOf } from "@kb/views";
import {
  DocsError,
  GENERATED_HEADER,
  docsViewEffect,
  docsViewsEffect,
  renderViewEffect,
} from "./docs/docs.ts";
import { hostOf, viewMarkdown, viewTitleOf } from "./view-markdown.ts";

type RenderError = DomainError | DocsError;
type RenderEnv = KbCtx | SavedQueries | TemplateRegistry;

/** Map unknown render failures; DomainError must be a runtime import for instanceof. */
export function mapRenderErr(err: unknown): RenderError {
  if (err instanceof DocsError) return err;
  if (err instanceof DomainError) return err;
  return domainError("internal", err instanceof Error ? err.message : String(err));
}

/**
 * Shared render backbone: a view node -> md or html (a docs view through its
 * query and template, any other view node as its markdown).
 * One layer feeds the docs materializer (md, via renderView), `render.view`
 * on every surface, and MCP Apps `ui://` resources (html).
 */

export type RenderFormat = "md" | "html";

export interface RenderedView {
  /** A docs view's name, else the view node's title. */
  name: string;
  /** The view node rendered. */
  id: string;
  /** The view it shows (`docs.markdown`, `outline.board`, …). */
  view: string;
  format: RenderFormat;
  content: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Minimal deterministic md -> html (headings, lists, paragraphs) for
 * template output; templates emit simple markdown by contract. */
function mdToHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^-\s+(.*)$/.exec(line);
    if (!li && inList) {
      out.push("</ul>");
      inList = false;
    }
    if (h) {
      const level = present(h[1], "heading marks").length;
      out.push(`<h${level}>${escapeHtml(present(h[2], "heading text"))}</h${level}>`);
    } else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(present(li[1], "list text"))}</li>`);
    } else if (line.length > 0) {
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const HTML_SHELL_STYLE =
  "font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.5";

/** A page holding rendered markdown, titled `title`. */
function htmlPage(title: string, md: string): string {
  return [
    `<!doctype html><meta charset="utf-8"><title>kb: ${escapeHtml(title)}</title>`,
    `<body style="${HTML_SHELL_STYLE}">`,
    mdToHtml(md),
    "</body>",
  ].join("\n");
}

/**
 * Which view a render asks for: a docs view by the name it goes by, or any
 * view node by its id, shown for `host` (by default the one node naming it).
 */
export type ViewRef =
  | { readonly name: string; readonly id?: undefined }
  | { readonly id: string; readonly name?: undefined; readonly host?: string };

/** A docs view, by its name: md is the materializer's bytes, generated header included. */
const renderDocsViewEffect = Effect.fn("render.docsView")(function* (
  name: string,
  format: RenderFormat,
): Effect.fn.Return<RenderedView, RenderError, RenderEnv> {
  const view = yield* docsViewEffect(name);
  const md = yield* renderViewEffect(view);
  const content = format === "md" ? md : htmlPage(name, md.replace(GENERATED_HEADER, "").trim());
  return { name, id: view.id, view: DocsMarkdownView.id, format, content };
});

/**
 * Render a view node as md or as a self-contained html page: the one path
 * `render.view` and MCP's `ui://kb/view/*` resources share. A docs view
 * renders through its template, whether it is asked for by name or by id;
 * any other view node renders as its markdown (`viewMarkdown`).
 */
export const renderViewNodeEffect = Effect.fn("render.viewNode")(function* (
  ref: ViewRef,
  format: RenderFormat,
): Effect.fn.Return<RenderedView, RenderError, RenderEnv> {
  if (ref.name !== undefined) return yield* renderDocsViewEffect(ref.name, format);
  const ctx = yield* KbCtx;
  const node = ctx.index.getNode(ref.id);
  if (node === undefined)
    return yield* domainError("not_found", `view node not found: ${ref.id}`, { id: ref.id });
  if (!isViewNode(node))
    return yield* domainError("invalid_input", `${ref.id} is no view node (it has no sys.f.view)`, {
      id: ref.id,
    });
  if (isDocsView(node)) return yield* renderDocsViewEffect(docsViewNameOf(node), format);
  const option = viewOptionOf(node);
  const key = option === null ? null : catalogKeyOf(option);
  const md = viewMarkdown(ctx, node, hostOf(ctx, node, ref.host ?? null));
  const name = viewTitleOf(node, key);
  return {
    name,
    id: node.id,
    view: key?.id ?? option ?? "",
    format,
    content: format === "md" ? md : htmlPage(name, md),
  };
});

export const listViewNamesEffect = Effect.fn("render.listViews")(function* (): Effect.fn.Return<
  string[],
  RenderError,
  RenderEnv
> {
  const { views } = yield* docsViewsEffect();
  return views.map((v) => v.name).toSorted();
});

/**
 * Every view a surface can offer to render: the docs views by name, then
 * every other view node by id, in id order.
 */
export const listViewRefsEffect = Effect.fn("render.listViewRefs")(function* (): Effect.fn.Return<
  ViewRef[],
  RenderError,
  RenderEnv
> {
  const ctx = yield* KbCtx;
  const names = yield* listViewNamesEffect();
  const nodes = ctx.nodes
    .filter((node) => isViewNode(node) && !isDocsView(node))
    .map((node) => node.id)
    .toSorted();
  return [...names.map((name) => ({ name })), ...nodes.map((id) => ({ id }))];
});

// ── registry actions: the render backbone exposed over /api/action ──────

export const renderViewDef = {
  id: "render.view",
  title: "Render view",
  description:
    "Render a view to html or md and return the content: a docs view by `name`, or any view node by `id` (exactly one), shown for `host` (by default the one node naming it). Markdown is the text-only form: the view, its settings, and the nodes it shows.",
  mode: { kind: "read" } as const,
  inputSchema: z
    .object({
      name: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      host: z.string().min(1).optional(),
      // Absent or null is html: some MCP clients send an omitted optional as null.
      format: z.enum(["html", "md"]).nullable().default("html"),
    })
    .refine((input) => (input.name === undefined) !== (input.id === undefined), {
      message: "exactly one of name and id",
    }),
  outputSchema: z.object({
    name: z.string(),
    id: z.string(),
    view: z.string(),
    format: z.enum(["html", "md"]),
    content: z.string(),
  }),
} satisfies ActionDefinition;

export const renderViewsDef = {
  id: "render.views",
  title: "List views",
  description: "List the docs view names available to render.view",
  mode: { kind: "read" } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({ views: z.array(z.string()) }),
} satisfies ActionDefinition;

export const renderViewActionEffect = Effect.fn("render.view")(function* (
  input: z.infer<typeof renderViewDef.inputSchema>,
): Effect.fn.Return<RenderedView, RenderError, RenderEnv> {
  const format = input.format ?? "html";
  if (input.id !== undefined)
    return yield* renderViewNodeEffect(
      input.host === undefined ? { id: input.id } : { id: input.id, host: input.host },
      format,
    );
  return yield* renderViewNodeEffect({ name: input.name ?? "" }, format);
});

export const renderViewsActionEffect = Effect.fn("render.views")(function* (): Effect.fn.Return<
  { views: string[] },
  RenderError,
  RenderEnv
> {
  return { views: yield* listViewNamesEffect() };
});
