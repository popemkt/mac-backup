import { Context, Layer } from "effect";
import type { KbNode, NodeId } from "@kb/model";

/**
 * Render templates: named functions (query rows → markdown). No
 * template-language dependency — a docs view node (`sys.f.view.template`)
 * references a template by id, and the registry resolves it.
 *
 * Templates are policy, so core ships none: they arrive through the
 * extension contract exactly like actions do, and the registry namespaces
 * them `ext.<file>.<template>` with optional bare-id aliases.
 * Every template must be deterministic — same rows + nodes, same bytes.
 */
export interface TemplateContext {
  nodes: Map<NodeId, KbNode>;
  /** Unique-text lookup among sys.field nodes; undefined if absent or ambiguous. */
  fieldIdByName(name: string): NodeId | undefined;
}

export type TemplateFn = (rows: unknown[][], ctx: TemplateContext) => string;

/**
 * Render-backbone text helper. Templates themselves are policy and live in
 * extensions; resolving `[[id|label]]` mentions against the graph is
 * mechanism, so it ships beside {@link TemplateContext} and is offered to
 * template authors.
 */
const MENTION_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** Render [[id|label]] as label, [[id]] as the target node's text (or the id). */
export function renderText(text: string, ctx: TemplateContext): string {
  return text.replace(MENTION_RE, (_m, id: string, label?: string) => {
    if (label !== undefined && label.length > 0) return label;
    return ctx.nodes.get(id.trim())?.text ?? id.trim();
  });
}

export interface ExtensionTemplate {
  /** Local id; the registry namespaces it as `ext.<file>.<id>`. */
  id: string;
  /** Extra top-level ids this template also answers to (compat shims). */
  aliases?: readonly string[];
  template: TemplateFn;
}

/** Resolved templates for a kb root, keyed by namespaced id and by alias. */
export class TemplateRegistry extends Context.Service<
  TemplateRegistry,
  ReadonlyMap<string, TemplateFn>
>()("kb/TemplateRegistry") {}

export function templateRegistryLayer(
  templates: ReadonlyMap<string, TemplateFn>,
): Layer.Layer<TemplateRegistry> {
  return Layer.succeed(TemplateRegistry, templates);
}
