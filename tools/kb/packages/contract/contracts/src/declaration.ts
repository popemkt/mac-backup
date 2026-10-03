/**
 * A family declares itself once (DESIGN.md → Extension families): its name,
 * how it is labelled, the system nodes it seeds and the views it provides.
 * The seed fold reads the declarations of the bundled list
 * (`bundledSeed()`), and each host's entry plugin is built from the same
 * declaration, so the seed, the catalog and the name cannot differ between
 * hosts.
 */
import type { KbNode } from "@kb/model";
import type { ViewKey } from "@kb/views";

/** One view a family provides: its key, which names its option in the seed. */
export interface ViewDef<P> {
  readonly key: ViewKey<P>;
}

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
