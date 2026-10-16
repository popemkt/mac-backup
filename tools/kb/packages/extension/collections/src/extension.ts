/**
 * The collections family's declaration and its shared plugin (DESIGN.md →
 * Extension families). A collection view lays a frame's rows out as a node
 * set (a table, a board, cards) inside the outline, which hosts the frame
 * and edits its rows. The family is optional and on by default: switched
 * off, a frame whose view node names one of its views shows that it cannot
 * be shown here, and its view nodes stay. Both hosts' entries are
 * {@link collectionsPlugin}: the server's directly, the page's as a child of
 * `@kb/collections-ui`'s entry.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { CollectionBoardView, CollectionCardsView, CollectionTableView } from "./view.ts";

export const collectionsExtension = defineExtension({
  name: "collections",
  label: "Collections",
  optional: { byDefault: "on" },
  views: [viewDef(CollectionTableView), viewDef(CollectionBoardView), viewDef(CollectionCardsView)],
});

/** The collections family's shared plugin: its declaration's views, on either host. */
export function collectionsPlugin(): Plugin {
  return declarationPlugin(collectionsExtension);
}
