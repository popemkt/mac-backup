/**
 * The view catalog as a point (DESIGN.md → Extension families → the view
 * catalog is a point): each plugin that provides a view contributes its
 * {@link ViewDef} to {@link ViewKeyPoint} under the view's id, and the
 * {@link ViewCatalog} service is the one reading of what was contributed.
 * The server provides it from its registry's kernel; the page derives it from
 * `kb.manifest.views`, so both list only what the server loaded.
 */
import { Context } from "effect";
import { Point } from "@kb/plugin";
import type { ViewCatalogOf, ViewKey } from "@kb/views";

/** One view a family provides: its key, which names its option in the seed. */
export interface ViewDef<P> {
  readonly key: ViewKey<P>;
}

/** Every view a loaded plugin provides, by view id. */
export const ViewKeyPoint = Point<ViewDef<unknown>>()("kb.views");

/** The views the host's loaded plugins provide: what `view.propose`, `render.view` and `kb.manifest` read. */
export class ViewCatalog extends Context.Service<ViewCatalog, ViewCatalogOf<ViewDef<unknown>>>()(
  "kb/ViewCatalog",
) {}
