/**
 * A family declares itself once (DESIGN.md → Extension families): its name,
 * how it is labelled, the system nodes it seeds and the views it provides.
 * The seed fold reads the declarations of the bundled list
 * (`bundledSeed()`), and each host's entry plugin is built from the same
 * declaration ({@link declarationPlugin}), so the seed, the catalog and the
 * name cannot differ between hosts.
 */
import { Effect } from "effect";
import type { KbNode } from "@kb/model";
import { definePlugin, type Plugin } from "@kb/plugin";
import { ViewKeyPoint, type ViewDef } from "./view-catalog.ts";

export interface ExtensionDeclaration {
  /** The family's name: the one home of it, which its plugins and its manifest row read. */
  readonly name: string;
  readonly label: string;
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
