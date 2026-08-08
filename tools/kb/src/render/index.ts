import type { KbContext } from "../context.ts";
import {
  GENERATED_HEADER,
  loadViews,
  renderView,
} from "../operations/docs/index.ts";

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
      const level = h[1]!.length;
      out.push(`<h${level}>${escapeHtml(h[2]!)}</h${level}>`);
    } else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(li[1]!)}</li>`);
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
export async function renderNamedView(
  ctx: KbContext,
  viewName: string,
  format: RenderFormat,
): Promise<RenderedView> {
  const [view] = await loadViews(ctx.root, viewName);
  const md = await renderView(ctx, view!);
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
}

export async function listViewNames(ctx: KbContext): Promise<string[]> {
  const views = await loadViews(ctx.root);
  return views.map((v) => v.name).sort();
}
