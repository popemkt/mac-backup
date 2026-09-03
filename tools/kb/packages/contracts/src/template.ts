import { Context, Layer } from "effect";
import type { KbNode, NodeId } from "@kb/model";

/**
 * Render templates: named functions (query rows → markdown). No
 * template-language dependency — a view spec (`.kb/views/<name>.json`)
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
