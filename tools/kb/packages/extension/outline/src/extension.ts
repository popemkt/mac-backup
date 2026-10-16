/**
 * The outline family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The outline is the default editing mode, so it is a
 * required family: a store cannot switch it off (`extension.switch` refuses
 * it), and its declaration provides the default view type (`defaultView`),
 * the view a node opens in when it names none. The declaration is the one
 * home of the family's name and views; the bundled seed folds it, and both
 * hosts' entries are {@link outlinePlugin}: the server's directly, the page's
 * as a child of `@kb/outline-ui`'s entry.
 *
 * Its view keys are `@kb/views`' (`outline.ts`): every frame view's page is
 * the outline at its frame (`frameViewKey`), and the collection views are
 * another family's, which may not reach this package.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { OutlineListView, OutlineSnippetView, OutlineView } from "@kb/views";

export const outlineExtension = defineExtension({
  name: "outline",
  label: "Outline",
  defaultView: OutlineView,
  views: [viewDef(OutlineView), viewDef(OutlineListView), viewDef(OutlineSnippetView)],
});

/** The outline family's shared plugin: its declaration's views, on either host. */
export function outlinePlugin(): Plugin {
  return declarationPlugin(outlineExtension);
}
