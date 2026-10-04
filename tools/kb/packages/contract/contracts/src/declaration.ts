/**
 * A family declares itself once (DESIGN.md → Extension families): its name,
 * how it is labelled, the system nodes it seeds and the views it provides.
 * The seed fold reads the declarations of the bundled list
 * (`bundledSeed()`), and each host's entry plugin is built from the same
 * declaration ({@link declarationPlugin}), so the seed, the catalog and the
 * name cannot differ between hosts.
 */
import { Context, Effect } from "effect";
import { z } from "zod";
import type { KbNode } from "@kb/model";
import { definePlugin, type Plugin } from "@kb/plugin";
import { ViewKeyPoint, type ViewDef } from "./view-catalog.ts";

export interface ExtensionDeclaration {
  /** The family's name: the one home of it, which its plugins and its manifest row read. */
  readonly name: string;
  readonly label: string;
  /**
   * Off until the person switches it on. Whether it is on is the server's
   * decision, never the browser's: the registry loads an optional family
   * only while it is on, and `kb.manifest.extensions` reports it either way.
   */
  readonly optional?: boolean;
  /**
   * The system nodes the family seeds, under frozen ids. Only a bundled
   * family's declaration is folded into the seed; a host or repository
   * plugin contributes none.
   */
  readonly seed?: (at: string) => readonly KbNode[];
  /** The views the family provides; the seed derives each one's option node from its key. */
  readonly views?: readonly ViewDef<unknown>[];
}

/** A family's declaration, as written in its shared package. */
export function defineExtension(declaration: ExtensionDeclaration): ExtensionDeclaration {
  return declaration;
}

/**
 * What both hosts load of a declaration: its views, each contributed to
 * {@link ViewKeyPoint} under its view id. A view id already carries its
 * namespace (`<namespace>.<local id>`), so the plugin sits in the root
 * namespace. A host's entry plugin loads it as a child, or loads it as is.
 */
export function declarationPlugin(declaration: ExtensionDeclaration): Plugin {
  return definePlugin({
    name: declaration.name,
    namespace: "",
    apply: (ctx) =>
      Effect.forEach(
        declaration.views ?? [],
        (view) => ctx.contribute(ViewKeyPoint, { id: view.key.id, value: view }),
        { discard: true },
      ),
  });
}

/**
 * A family as a host composes it: the declaration that names it, and the
 * plugin that host loads for it. The server's bundled families and the
 * `kb ui` host's own extensions (the agent) are both this shape, so both
 * report through {@link extensionRow}.
 */
export interface ExtensionEntry {
  readonly declaration: ExtensionDeclaration;
  readonly entry: Plugin;
}

/**
 * One extension as a host reports it (`kb.manifest.extensions`): what the
 * page follows. `enabled` says the host holds it loaded; `source` is
 * `bundled`, `host` (composed by `kb ui`) or a repository extension's path.
 */
export const ExtensionRowSchema = z.object({
  name: z.string(),
  label: z.string(),
  optional: z.boolean(),
  enabled: z.boolean(),
  source: z.string(),
});

export type ExtensionRow = z.infer<typeof ExtensionRowSchema>;

/** A declaration's row, as the host that composes it from `source` reports it. */
export function extensionRow(
  declaration: ExtensionDeclaration,
  source: string,
  enabled: boolean,
): ExtensionRow {
  return {
    name: declaration.name,
    label: declaration.label,
    optional: declaration.optional === true,
    enabled,
    source,
  };
}

/** The extensions the host composes, loaded or not: what `kb.manifest` reports. */
export class ExtensionCatalog extends Context.Service<ExtensionCatalog, readonly ExtensionRow[]>()(
  "kb/ExtensionCatalog",
) {}
