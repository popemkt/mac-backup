import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx } from "@kb/contracts";
import type { ActionDefinition } from "@kb/contracts";
import { DomainError, domainError, present } from "@kb/model";
import { DocsError, GENERATED_HEADER, loadViewsEffect, renderViewEffect } from "./docs/docs.ts";

type RenderError = DomainError | DocsError;
type RenderEnv = KbCtx | FileSystem;

/** Map unknown render failures; DomainError must be a runtime import for instanceof. */
export function mapRenderErr(err: unknown): RenderError {
  if (err instanceof DocsError) return err;
  if (err instanceof DomainError) return err;
  return domainError("internal", err instanceof Error ? err.message : String(err));
}

/**
 * Shared render backbone: named view (query + template) -> md or html.
 * One layer feeds three surfaces: docs materializer (md, via renderView),
 * the web UI's rendered-view panel (html), and MCP Apps `ui://` resources
 * (html). Adding an "app" is adding a template + view, nothing structural.
 */

export type RenderFormat = "md" | "html";

export interface RenderedView {
  name: string;
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

/**
 * Render a saved view (.kb/views/<name>.json) as md (materializer bytes,
 * including the generated header) or as a self-contained html page.
 */
export const renderNamedViewEffect = Effect.fn("render.namedView")(function* (
  viewName: string,
  format: RenderFormat,
): Effect.fn.Return<RenderedView, RenderError, RenderEnv> {
  const ctx = yield* KbCtx;
  const views = yield* loadViewsEffect(ctx.root, viewName);
  const view = views[0];
  if (!view) {
    return yield* Effect.fail(
      new DocsError("not_found", `view not found: ${viewName}`, { viewName }),
    );
  }
  const md = yield* renderViewEffect(view);
  if (format === "md") {
    return { name: viewName, format, content: md };
  }
  const body = md.replace(GENERATED_HEADER, "").trim();
  const html = [
    `<!doctype html><meta charset="utf-8"><title>kb: ${escapeHtml(viewName)}</title>`,
    `<body style="${HTML_SHELL_STYLE}">`,
    mdToHtml(body),
    "</body>",
  ].join("\n");
  return { name: viewName, format, content: html };
});

export const listViewNamesEffect = Effect.fn("render.listViews")(function* (): Effect.fn.Return<
  string[],
  RenderError,
  RenderEnv
> {
  const ctx = yield* KbCtx;
  const views = yield* loadViewsEffect(ctx.root);
  return views.map((v) => v.name).toSorted();
});

// ── registry actions: the render backbone exposed over /api/action ──────

export const renderViewDef = {
  id: "render.view",
  title: "Render view",
  description: "Render a saved view (.kb/views/<name>.json) to html or md and return the content",
  mode: "read" as const,
  inputSchema: z.object({
    name: z.string().min(1),
    format: z.enum(["html", "md"]).default("html"),
  }),
  outputSchema: z.object({
    name: z.string(),
    format: z.enum(["html", "md"]),
    content: z.string(),
  }),
} satisfies ActionDefinition;

export const renderViewsDef = {
  id: "render.views",
  title: "List views",
  description: "List saved view names available to render.view",
  mode: "read" as const,
  inputSchema: z.object({}),
  outputSchema: z.object({ views: z.array(z.string()) }),
} satisfies ActionDefinition;

export const renderViewActionEffect = Effect.fn("render.view")(function* (
  input: z.infer<typeof renderViewDef.inputSchema>,
): Effect.fn.Return<RenderedView, RenderError, RenderEnv> {
  return yield* renderNamedViewEffect(input.name, input.format);
});

export const renderViewsActionEffect = Effect.fn("render.views")(function* (): Effect.fn.Return<
  { views: string[] },
  RenderError,
  RenderEnv
> {
  return { views: yield* listViewNamesEffect() };
});
