import type { TemplateContext } from "@kb/contracts";

/**
 * Render-backbone text helper. Templates themselves are policy and live in
 * extensions; resolving `[[id|label]]` mentions against the graph is
 * mechanism, so it ships with core and is offered to template authors.
 */
const MENTION_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** Render [[id|label]] as label, [[id]] as the target node's text (or the id). */
export function renderText(text: string, ctx: TemplateContext): string {
  return text.replace(MENTION_RE, (_m, id: string, label?: string) => {
    if (label !== undefined && label.length > 0) return label;
    return ctx.nodes.get(id.trim())?.text ?? id.trim();
  });
}
